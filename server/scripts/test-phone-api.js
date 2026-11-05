// Integration test of the phone rules through the real HTTP API.
// Usage (against a THROWAWAY database, never production):
//   (fresh DB each run: DROP DATABASE IF EXISTS vision_tax_phonetest;)  DB_NAME=vision_tax_phonetest node scripts/migrate.js
//   DB_NAME=vision_tax_phonetest PORT=4100 node src/index.js &
//   DB_NAME=vision_tax_phonetest BASE=http://localhost:4100 node scripts/test-phone-api.js
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:4100';
const { pool } = require('../src/db');
const PW = 'Str0ng!Passw0rd';
let pass = 0; let fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const post = async (path, body, headers = {}) => {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ') };
};
const reg = (n, phone, country, extra = {}) => post('/api/auth/register', { firstName: 'T', lastName: n, email: `${n}@phonetest.example`, phone, country, password: PW, ...extra });
const storedPhone = async (n) => { const [rows] = await pool.query('SELECT phone FROM users WHERE email = ?', [`${n}@phonetest.example`]); return rows[0] && rows[0].phone; };

(async () => {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
  assert.ok(/test/i.test(db), 'refusing to run: database name must contain "test" (got ' + db + ')');

  console.log('Registration');
  const cases = [
    ['in1', '+91 9876543210', undefined, '+919876543210'], ['in2', '9876543211', 'IN', '+919876543211'],
    ['us1', '+1 2125551234', undefined, '+12125551234'], ['us2', '(415) 555-2671', 'US', '+14155552671'],
    ['uk1', '+44 7911 123456', undefined, '+447911123456'], ['ae1', '+971 501234567', undefined, '+971501234567'],
    ['au1', '+61 412345678', undefined, '+61412345678'], ['au2', '0412 345 679', 'AU', '+61412345679'],
  ];
  for (const [n, p, c, want] of cases) {
    await t(`register ${p}${c ? ' [' + c + ']' : ''} -> ${want}`, async () => {
      const r = await reg(n, p, c); assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      assert.strictEqual(await storedPhone(n), want);
    });
  }
  await t('invalid number rejected with message', async () => { const r = await reg('bad1', '12345', 'IN'); assert.strictEqual(r.status, 400); assert.match(r.body.error, /too short/i); });
  await t('missing country code rejected', async () => { const r = await reg('bad2', '9876543299', undefined); assert.strictEqual(r.status, 400); assert.match(r.body.error, /Select your country/); });
  await t('legacy page payload (countryCode + local digits) still works', async () => {
    const r = await post('/api/auth/register', { firstName: 'T', lastName: 'old', email: 'old@phonetest.example', countryCode: '+91', phone: '9123456780', password: PW });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.strictEqual(await storedPhone('old'), '+919123456780');
  });
  await t('legacy "+1-ca" dial option no longer corrupts the number', async () => {
    const r = await post('/api/auth/register', { firstName: 'T', lastName: 'ca', email: 'ca@phonetest.example', countryCode: '+1-ca', phone: '6045551234', password: PW });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.strictEqual(await storedPhone('ca'), '+16045551234');
  });
  await t('duplicate of a legacy row stored WITHOUT "+" is detected', async () => {
    await pool.query("INSERT INTO users (first_name,last_name,email,phone,password_hash,role) VALUES ('L','egacy','legacy@phonetest.example','919000000001','x','user')");
    const r = await reg('dupe', '+91 9000000001'); assert.strictEqual(r.status, 409);
  });
  await t('same number twice -> 409', async () => { const r = await reg('dupe2', '+91 98765 43210'); assert.strictEqual(r.status, 409); });

  console.log('Login + filings');
  let cookie;
  await t('login works', async () => { const r = await post('/api/auth/login', { email: 'in1@phonetest.example', password: PW }); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); cookie = r.cookie; });
  let filingId;
  const year = new Date().getFullYear();
  const filing = async (contact, country) => {
    const fd = new FormData(); fd.append('name', 'Test return'); fd.append('type', 'W2'); fd.append('year', String(year));
    fd.append('contact', contact); if (country) fd.append('contactCountry', country);
    fd.append('files', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
    const res = await fetch(BASE + '/api/user/filings', { method: 'POST', headers: { cookie }, body: fd });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  await t('filing with +44 number accepted + stored E.164', async () => {
    const r = await filing('+44 7911 123456'); assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const [[row]] = await pool.query('SELECT id, contact FROM filings ORDER BY id DESC LIMIT 1'); filingId = row.id; assert.strictEqual(row.contact, '+447911123456');
  });
  await t('filing with national number + contactCountry=IN', async () => { const r = await filing('98765 43210', 'IN'); assert.strictEqual(r.status, 201, JSON.stringify(r.body)); });
  await t('filing with invalid number rejected', async () => { const r = await filing('123', 'IN'); assert.strictEqual(r.status, 400); });
  await t('filing without country and without + rejected', async () => { const r = await filing('9876543210'); assert.strictEqual(r.status, 400); assert.match(r.body.error, /Select your country/); });
  const put = (body) => fetch(BASE + `/api/user/filings/${filingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  await t('edit filing: change to UAE number', async () => {
    const r = await put({ name: 'Test return', type: 'W2', year, contact: '050 123 4567', contactCountry: 'AE' }); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const [[row]] = await pool.query('SELECT contact FROM filings WHERE id=?', [filingId]); assert.strictEqual(row.contact, '+971501234567');
  });
  await t('edit filing: legacy unreadable contact left untouched still saves other fields', async () => {
    await pool.query('UPDATE filings SET contact=? WHERE id=?', ['+4412345678', filingId]);
    const r = await put({ name: 'Renamed', type: 'W2', year, contact: '+4412345678' }); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const [[row]] = await pool.query('SELECT name, contact FROM filings WHERE id=?', [filingId]); assert.strictEqual(row.name, 'Renamed'); assert.strictEqual(row.contact, '+4412345678');
  });
  await t('edit filing: changing to an invalid number rejected', async () => { const r = await put({ name: 'Renamed', type: 'W2', year, contact: '+44 123' }); assert.strictEqual(r.status, 400); });

  console.log('Payments (guest order): phone rule applies before the gateway; currency untouched');
  const order = (phone, country) => post('/api/payments/order', { plan: 'student-nr', name: 'Test User', email: 'p@phonetest.example', phone, country, method: 'card' });
  await t('invalid phone -> phone error', async () => { const r = await order('12', 'US'); assert.strictEqual(r.status, 400); assert.match(r.body.error, /phone|short|number/i); });
  await t('valid +971 phone passes phone validation (any error is not a phone error)', async () => { const r = await order('+971 501234567'); assert.ok(!/phone number|country code|too (short|long)/i.test(r.body.error || ''), r.body.error); });
  await t('public config still reports INR', async () => { const j = await (await fetch(BASE + '/api/public/config')).json(); assert.strictEqual(j.currency, 'INR'); });

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
