const express = require('express');
const { pool, audit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { receiveFiles, removeFiles } = require('../middleware/upload');
const { STATUSES, listParams, like, attachFiles, asyncRoute } = require('../lib');

const router = express.Router();
router.use(requireAuth(), requireRole('admin'));

const GROUPS = { pending: ['pending'], ongoing: ['ongoing', 'drafted'], completed: ['completed'] };

router.get('/summary', asyncRoute(async (_req, res) => {
  const [rows] = await pool.query('SELECT status, COUNT(*) AS n FROM filings GROUP BY status');
  const n = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const [[{ users }]] = await pool.query("SELECT COUNT(*) AS users FROM users WHERE role = 'user'");
  const [recent] = await pool.query(
    `SELECT f.id, f.name, f.type, f.filing_year AS year, f.status, f.submitted_at AS submittedAt,
            CONCAT(u.first_name,' ',u.last_name) AS userName
       FROM filings f JOIN users u ON u.id = f.user_id ORDER BY f.submitted_at DESC, f.id DESC LIMIT 6`
  );
  res.json({
    pending: n.pending || 0,
    inProgress: (n.ongoing || 0) + (n.drafted || 0),
    completed: n.completed || 0,
    users,
    recent,
  });
}));

router.get('/filings', asyncRoute(async (req, res) => {
  const group = GROUPS[req.query.group];
  if (!group) return res.status(400).json({ error: 'group must be pending, ongoing or completed.' });
  const p = listParams(req, { name: 'f.name', type: 'f.type', year: 'f.filing_year', contact: 'f.contact', status: 'f.status', submitted: 'f.submitted_at' }, 'submitted');
  let where = 'f.status IN (?)';
  const args = [group];
  const term = p.q || p.name;
  if (term) {
    where += " AND (f.name LIKE ? OR f.type LIKE ? OR f.filing_year LIKE ? OR f.contact LIKE ? OR CONCAT(u.first_name,' ',u.last_name) LIKE ?)";
    args.push(...Array(5).fill(like(term)));
  }
  const from = `FROM filings f JOIN users u ON u.id = f.user_id WHERE ${where}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}`, args);
  const [rows] = await pool.query(
    `SELECT f.id, f.name, f.type, f.filing_year AS year, f.contact, f.status, f.submitted_at AS submittedAt,
            CONCAT(u.first_name,' ',u.last_name) AS userName, u.email AS userEmail
       ${from} ORDER BY ${p.order} LIMIT ? OFFSET ?`,
    [...args, p.limit, p.offset]
  );
  res.json({ rows: await attachFiles(rows, ['upload', 'draft', 'final']), total });
}));

router.get('/filings/:id/history', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT h.from_status AS fromStatus, h.to_status AS toStatus, h.note, h.created_at AS at,
            CONCAT(u.first_name,' ',u.last_name) AS by_name
       FROM filing_status_history h JOIN users u ON u.id = h.changed_by WHERE h.filing_id = ? ORDER BY h.id`,
    [Number(req.params.id) || 0]
  );
  res.json({ rows });
}));

async function lockFiling(conn, id) {
  const [[f]] = await conn.query('SELECT id, user_id, status FROM filings WHERE id = ? FOR UPDATE', [id]);
  return f;
}

async function storeFiles(conn, filingId, kind, files, adminId) {
  for (const f of files) {
    await conn.query(
      'INSERT INTO filing_files (filing_id, kind, stored_name, original_name, mime_type, size_bytes, uploaded_by) VALUES (?,?,?,?,?,?,?)',
      [filingId, kind, f.filename, f.originalname.slice(0, 255), f.mimetype, f.size, adminId]
    );
  }
}

async function withFiling(req, res, fn) {
  const id = Number(req.params.id);
  const files = req.files || [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const filing = Number.isInteger(id) && id > 0 ? await lockFiling(conn, id) : null;
    if (!filing) {
      await conn.rollback();
      removeFiles(files);
      return res.status(404).json({ error: 'Filing not found.' });
    }
    const out = await fn(conn, filing);
    await conn.commit();
    res.json({ ok: true, ...out });
  } catch (e) {
    await conn.rollback();
    removeFiles(files);
    if (e.http) return res.status(e.http).json({ error: e.message });
    throw e;
  } finally {
    conn.release();
  }
}
const httpError = (http, message) => Object.assign(new Error(message), { http });

// Uploading a draft moves a pending/ongoing filing to "drafted"
router.post('/filings/:id/draft', receiveFiles(), asyncRoute((req, res) =>
  withFiling(req, res, async (conn, filing) => {
    if (filing.status === 'completed') throw httpError(409, 'This filing is already completed.');
    await storeFiles(conn, filing.id, 'draft', req.files, req.user.id);
    if (filing.status !== 'drafted') {
      await conn.query("UPDATE filings SET status = 'drafted' WHERE id = ?", [filing.id]);
      await conn.query('INSERT INTO filing_status_history (filing_id, from_status, to_status, changed_by, note) VALUES (?,?,?,?,?)',
        [filing.id, filing.status, 'drafted', req.user.id, 'Draft uploaded']);
    }
    await audit(req.user.id, 'filing.draft_upload', 'filing', filing.id, `${req.files.length} file(s)`, req.ip, conn);
    return { status: 'drafted' };
  })
));

// Final files are stored now but only released to the user once status is "completed"
router.post('/filings/:id/final', receiveFiles(), asyncRoute((req, res) =>
  withFiling(req, res, async (conn, filing) => {
    await storeFiles(conn, filing.id, 'final', req.files, req.user.id);
    await audit(req.user.id, 'filing.final_upload', 'filing', filing.id, `${req.files.length} file(s)`, req.ip, conn);
    return { status: filing.status };
  })
));

router.patch('/filings/:id/status', asyncRoute((req, res) =>
  withFiling(req, res, async (conn, filing) => {
    const to = String((req.body || {}).status || '');
    const note = String((req.body || {}).note || '').slice(0, 255) || null;
    if (!STATUSES.includes(to)) throw httpError(400, 'Invalid status.');
    if (to === filing.status) throw httpError(400, 'Filing already has that status.');
    const count = async (kind) => (await conn.query('SELECT COUNT(*) AS n FROM filing_files WHERE filing_id = ? AND kind = ?', [filing.id, kind]))[0][0].n;
    if (to === 'drafted' && !(await count('draft'))) throw httpError(400, 'Upload a draft copy before marking the filing as drafted.');
    if (to === 'completed' && !(await count('final'))) throw httpError(400, 'Upload the final copy before marking the filing as completed.');
    await conn.query('UPDATE filings SET status = ? WHERE id = ?', [to, filing.id]);
    await conn.query('INSERT INTO filing_status_history (filing_id, from_status, to_status, changed_by, note) VALUES (?,?,?,?,?)',
      [filing.id, filing.status, to, req.user.id, note]);
    await audit(req.user.id, 'filing.status', 'filing', filing.id, `${filing.status} -> ${to}`, req.ip, conn);
    return { status: to };
  })
));

router.get('/users', asyncRoute(async (req, res) => {
  const p = listParams(req, {
    name: "CONCAT(u.first_name,' ',u.last_name)", email: 'u.email', phone: 'u.phone',
    year: 'year', registered: 'u.created_at',
  }, 'registered');
  const args = [];
  let where = "u.role = 'user'";
  if (p.q) {
    where += " AND (CONCAT(u.first_name,' ',u.last_name) LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)";
    args.push(like(p.q), like(p.q), like(p.q));
  }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users u WHERE ${where}`, args);
  const [rows] = await pool.query(
    `SELECT u.id, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS name, u.email, u.phone,
            (SELECT GROUP_CONCAT(DISTINCT f.filing_year ORDER BY f.filing_year SEPARATOR ', ') FROM filings f WHERE f.user_id = u.id) AS year,
            u.created_at AS registeredAt
       FROM users u WHERE ${where} ORDER BY ${p.order} LIMIT ? OFFSET ?`,
    [...args, p.limit, p.offset]
  );
  res.json({ rows, total });
}));

module.exports = router;
