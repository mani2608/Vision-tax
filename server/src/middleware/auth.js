const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { config } = require('../config');
const { pool } = require('../db');

const COOKIE = 'vt_session';

function issueSession(res, user, remember) {
  const jti = crypto.randomBytes(16).toString('hex');
  const seconds = remember ? 7 * 24 * 3600 : 8 * 3600;
  const token = jwt.sign({ sub: user.id, role: user.role, jti }, config.jwtSecret, { expiresIn: seconds });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    // "Remember me" off => session cookie that ends with the browser session
    ...(remember ? { maxAge: seconds * 1000 } : {}),
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/' });
}

function readToken(req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

// opts.allowPasswordChange: let a user flagged must_change_password through (me / change-password / logout)
function requireAuth(opts = {}) {
  return async (req, res, next) => {
    try {
      const claims = readToken(req);
      if (!claims) return res.status(401).json({ error: 'Please sign in.' });
      const [[revoked]] = await pool.query('SELECT 1 AS r FROM revoked_tokens WHERE jti = ?', [claims.jti]);
      if (revoked) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
      const [[user]] = await pool.query(
        'SELECT id, first_name, last_name, email, phone, role, status, must_change_password FROM users WHERE id = ?',
        [claims.sub]
      );
      if (!user || user.status !== 'active') return res.status(401).json({ error: 'Account unavailable.' });
      if (user.must_change_password && !opts.allowPasswordChange) {
        return res.status(403).json({ error: 'You must change your password first.', code: 'PASSWORD_CHANGE_REQUIRED' });
      }
      req.user = user;
      req.claims = claims;
      next();
    } catch (e) {
      next(e);
    }
  };
}

const requireRole = (role) => (req, res, next) =>
  req.user && req.user.role === role ? next() : res.status(403).json({ error: 'Forbidden.' });

module.exports = { issueSession, clearSession, requireAuth, requireRole, readToken };
