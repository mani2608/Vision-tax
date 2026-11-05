const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool, audit } = require('../db');
const { issueSession, clearSession, requireAuth, readToken } = require('../middleware/auth');
const { asyncRoute, validators, normalizePhone } = require('../lib');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

// Dummy hash so unknown emails cost the same time as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const publicUser = (u) => ({
  id: u.id,
  name: `${u.first_name} ${u.last_name}`.trim(),
  firstName: u.first_name,
  email: u.email,
  role: u.role,
  mustChangePassword: !!u.must_change_password,
});

router.post('/register', authLimiter, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const firstName = String(b.firstName || '').trim();
  const lastName = String(b.lastName || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  // Preferred: `phone` as typed (or already E.164) plus `country` (ISO code of the selected country).
  // Older cached pages send a dial code in `countryCode` and the local digits in `phone`; still understood.
  let rawPhone = String(b.phone || '').trim();
  const legacyCode = String(b.countryCode || '').split('-')[0].replace(/\D/g, '');
  if (!b.country && legacyCode && !/^(\+|00)/.test(rawPhone)) rawPhone = `+${legacyCode}${rawPhone}`;
  const password = String(b.password || '');

  const errors = {};
  if (!firstName || firstName.length > 80) errors.firstName = 'First name is required.';
  if (lastName.length > 80) errors.lastName = 'Last name is too long.';
  if (!validators.email(email)) errors.email = 'Enter a valid email address.';
  const parsedPhone = normalizePhone(rawPhone, b.country);
  if (parsedPhone.error) errors.phone = parsedPhone.error;
  if (!validators.strongPassword(password)) errors.password = 'Use 8+ characters with an uppercase letter, a number and a symbol.';
  if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], errors });

  // Stored as E.164 (+<country code><number>), so the same number in different countries cannot collide.
  const phone = parsedPhone.value;
  // Accounts created before E.164 storage hold the same number without the leading '+': that is a duplicate too.
  const [[dupe]] = await pool.query('SELECT id FROM users WHERE phone IN (?, ?) LIMIT 1', [phone, phone.slice(1)]);
  if (dupe) return res.status(409).json({ error: 'An account with this phone number already exists.' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const [r] = await pool.query(
      "INSERT INTO users (first_name,last_name,email,phone,password_hash,role) VALUES (?,?,?,?,?,'user')",
      [firstName, lastName, email, phone, hash]
    );
    await audit(r.insertId, 'user.register', 'user', r.insertId, null, req.ip);
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      const field = /email/.test(e.message) ? 'email' : 'phone number';
      return res.status(409).json({ error: `An account with this ${field} already exists.` });
    }
    throw e;
  }
}));

router.post('/login', authLimiter, asyncRoute(async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const [[user]] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || user.status !== 'active') {
    await audit(user ? user.id : null, 'auth.login_failed', 'user', user ? user.id : null, null, req.ip);
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  issueSession(res, user, !!req.body.remember);
  await audit(user.id, 'auth.login', 'user', user.id, null, req.ip);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', asyncRoute(async (req, res) => {
  const claims = readToken(req);
  if (claims) {
    await pool.query('INSERT IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, FROM_UNIXTIME(?))', [claims.jti, claims.exp]);
    pool.query('DELETE FROM revoked_tokens WHERE expires_at < NOW()').catch(() => {});
    await audit(claims.sub, 'auth.logout', 'user', claims.sub, null, req.ip);
  }
  clearSession(res);
  res.json({ ok: true });
}));

router.get('/me', requireAuth({ allowPasswordChange: true }), (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/change-password', authLimiter, requireAuth({ allowPasswordChange: true }), asyncRoute(async (req, res) => {
  const current = String((req.body || {}).currentPassword || '');
  const next = String((req.body || {}).newPassword || '');
  const [[row]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(current, row.password_hash))) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (!validators.strongPassword(next)) return res.status(400).json({ error: 'Use 8+ characters with an uppercase letter, a number and a symbol.' });
  if (next === current) return res.status(400).json({ error: 'New password must differ from the current one.' });
  const hash = await bcrypt.hash(next, 12);
  await pool.query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, req.user.id]);
  await audit(req.user.id, 'auth.password_changed', 'user', req.user.id, null, req.ip);
  res.json({ ok: true });
}));

module.exports = router;
