// In-app notifications for both dashboards. A client only ever sees their own; admins see the admin audience.
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib');

const router = express.Router();
router.use(requireAuth());

// SQL restricting rows to the caller's audience. Parameterised: never built from request input.
const scope = (u) => (u.role === 'admin' ? { sql: "audience = 'admin'", args: [] } : { sql: "audience = 'user' AND user_id = ?", args: [u.id] });

router.get('/', asyncRoute(async (req, res) => {
  const s = scope(req.user);
  const [rows] = await pool.query(
    `SELECT id, type, title, message, data, reference_code AS reference, payment_id AS paymentId, read_at IS NOT NULL AS \`read\`, created_at AS createdAt
       FROM notifications WHERE ${s.sql} ORDER BY created_at DESC, id DESC LIMIT 30`,
    s.args
  );
  const [[{ unread }]] = await pool.query(`SELECT COUNT(*) AS unread FROM notifications WHERE ${s.sql} AND read_at IS NULL`, s.args);
  res.json({
    unread: Number(unread),
    rows: rows.map((r) => ({ ...r, read: Boolean(r.read), data: (() => { try { return JSON.parse(r.data || '{}'); } catch { return {}; } })() })),
  });
}));

router.get('/unread-count', asyncRoute(async (req, res) => {
  const s = scope(req.user);
  const [[{ unread }]] = await pool.query(`SELECT COUNT(*) AS unread FROM notifications WHERE ${s.sql} AND read_at IS NULL`, s.args);
  const [[latest]] = await pool.query(`SELECT id, message FROM notifications WHERE ${s.sql} AND read_at IS NULL ORDER BY id DESC LIMIT 1`, s.args);
  res.json({ unread: Number(unread), latest: latest || null });
}));

// Mark specific notifications (ids) or all of them as read - only within the caller's own scope.
router.post('/read', asyncRoute(async (req, res) => {
  const s = scope(req.user);
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100) : null;
  if (ids && ids.length) await pool.query(`UPDATE notifications SET read_at = NOW() WHERE ${s.sql} AND read_at IS NULL AND id IN (?)`, [...s.args, ids]);
  else if (!ids) await pool.query(`UPDATE notifications SET read_at = NOW() WHERE ${s.sql} AND read_at IS NULL`, s.args);
  const [[{ unread }]] = await pool.query(`SELECT COUNT(*) AS unread FROM notifications WHERE ${s.sql} AND read_at IS NULL`, s.args);
  res.json({ ok: true, unread: Number(unread) });
}));

module.exports = router;
