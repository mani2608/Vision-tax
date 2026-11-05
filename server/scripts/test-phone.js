// Run: node scripts/test-phone.js   (no database needed)
// Verifies the international phone rules and that the browser and API copies of the parser are identical.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverCopy = path.join(__dirname, '..', 'src', 'phone-core.js');
const clientCopy = path.join(__dirname, '..', '..', 'client', 'public', 'assets', 'js', 'phone-core.js');
if (fs.existsSync(clientCopy)) {
  assert.strictEqual(fs.readFileSync(serverCopy, 'utf8').replace(/\r\n/g, '\n'), fs.readFileSync(clientCopy, 'utf8').replace(/\r\n/g, '\n'),
    'server/src/phone-core.js and client/public/assets/js/phone-core.js must be identical');
}

process.env.PHONE_REGION = ''; // no default country: numbers without a country code must name one
const { normalizePhone, validateFilingInput } = require('../src/lib');
const P = require('../src/phone-core');

let pass = 0; let fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const ok = (raw, country, e164) => () => { const r = normalizePhone(raw, country); assert.ok(!r.error, r.error); assert.strictEqual(r.value, e164); };
const bad = (raw, country, re) => () => { const r = normalizePhone(raw, country); assert.ok(r.error, 'expected an error'); if (re) assert.match(r.error, re); };

console.log('Valid numbers');
t('India +91 9876543210', ok('+91 9876543210', undefined, '+919876543210'));
t('India 9876543210 with IN selected', ok('9876543210', 'IN', '+919876543210'));
t('India 09876543210 (trunk 0) with IN', ok('09876543210', 'IN', '+919876543210'));
t('USA +1 2125551234', ok('+1 2125551234', undefined, '+12125551234'));
t('USA (212) 555-1234 with US', ok('(212) 555-1234', 'US', '+12125551234'));
t('USA 212-555-1234 with US', ok('212-555-1234', 'US', '+12125551234'));
t('UK mobile +44 7911 123456', ok('+44 7911 123456', undefined, '+447911123456'));
t('UK 07911 123456 with GB', ok('07911 123456', 'GB', '+447911123456'));
t('UAE +971 501234567', ok('+971 501234567', undefined, '+971501234567'));
t('UAE 050 123 4567 with AE', ok('050 123 4567', 'AE', '+971501234567'));
t('Australia +61 412345678', ok('+61 412345678', undefined, '+61412345678'));
t('Australia 0412 345 678 with AU', ok('0412 345 678', 'AU', '+61412345678'));
t('Germany +49 1512 3456789', ok('+49 1512 3456789', undefined, '+4915123456789'));
t('Singapore +65 8123 4567', ok('+65 8123 4567', undefined, '+6581234567'));
t('00 prefix: 0091 9876543210', ok('0091 9876543210', undefined, '+919876543210'));
t('spaces/hyphens/parentheses: +1 (212) 555-1234', ok('+1 (212) 555-1234', undefined, '+12125551234'));
t('dots: +91.98765.43210', ok('+91.98765.43210', undefined, '+919876543210'));
t('explicit +code wins over selected country', ok('+91 9876543210', 'US', '+919876543210'));
t('lowercase country code accepted', ok('9876543210', 'in', '+919876543210'));

console.log('Invalid numbers');
t('too short for India', bad('12345', 'IN', /too short/));
t('too long', bad('+91 98765432101234', undefined, /too long/));
t('letters', bad('98765abcde', 'IN', /only digits/));
t('empty', bad('', 'IN', /required/));
t('missing country code and no country', bad('9876543210', undefined, /Select your country/));
t('unknown country code +999', bad('+999 123456', undefined, /not recognised/));
t('all-zero number is not valid for India', bad('0000000000', 'IN'));
t('US area code starting with 0', bad('(012) 555-1234', 'US'));
t('invalid country argument ignored => missing-country error', bad('9876543210', 'ZZ', /Select your country/));

console.log('Formatting / legacy data');
t('format E.164 for display', () => assert.strictEqual(P.format('+919876543210'), '+91 98765 43210'));
t('legacy bare-digit rows still display', () => assert.strictEqual(P.format('919876543210'), '+91 98765 43210'));
t('unreadable legacy value shown unchanged', () => assert.strictEqual(P.format('0000000000'), '0000000000'));
t('split for edit form', () => { const s = P.split('+971501234567'); assert.strictEqual(s.country, 'AE'); assert.strictEqual(s.callingCode, '971'); });
t('country list is global', () => { const c = P.countries(); assert.ok(c.length > 230); assert.ok(['IN', 'US', 'GB', 'AE', 'AU'].every((i) => c.some((x) => x.iso === i))); });

console.log('Filing validation');
const base = { name: '2025 Return', type: 'W2', year: String(new Date().getFullYear()) };
t('filing accepts international contact', () => { const r = validateFilingInput({ ...base, contact: '+44 7911 123456' }); assert.ok(!r.error, r.error); assert.strictEqual(r.value.contact, '+447911123456'); });
t('filing uses contactCountry', () => { const r = validateFilingInput({ ...base, contact: '9876543210', contactCountry: 'IN' }); assert.strictEqual(r.value.contact, '+919876543210'); });
t('filing rejects bad contact', () => assert.ok(validateFilingInput({ ...base, contact: '123' , contactCountry: 'IN' }).error));
t('untouched legacy contact is preserved on edit', () => { const r = validateFilingInput({ ...base, contact: '+4412345678' }, '+4412345678'); assert.ok(!r.error); assert.strictEqual(r.value.contact, '+4412345678'); });
t('changed contact is validated even on edit', () => assert.ok(validateFilingInput({ ...base, contact: '+4412345679' }, '+4412345678').error));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
