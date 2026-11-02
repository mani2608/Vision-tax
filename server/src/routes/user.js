const express = require('express');
const { pool, audit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { receiveFiles, removeFiles } = require('../middleware/upload');
const { FILING_TYPES, listParams, like, attachFiles, asyncRoute } = require('../lib');

const router = express.Router();
router.use(requireAuth(), requireRole('user'));

router.get('/summary', asyncRoute(async (req, res) => {
  const id = req.user.id;
  const [[r]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM file_downloads WHERE user_id = ?) AS downloads,
       (SELECT COUNT(*) FROM filings WHERE user_id = ?) AS uploads,
       (SELECT COUNT(*) FROM filing_files ff JOIN filings f ON f.id = ff.filing_id
          WHERE f.user_id = ? AND ff.kind = 'draft') AS drafts,
       (SELECT COUNT(*) FROM filing_files ff JOIN filings f ON f.id = ff.filing_id
          WHERE f.user_id = ? AND ff.kind = 'final' AND f.status = 'completed') AS finals`,
    [id, id, id, id]
  );
  const [recent] = await pool.query(
    `SELECT id, name, type, filing_year AS year, status, submitted_at AS submittedAt
       FROM filings WHERE user_id = ? ORDER BY submitted_at DESC, id DESC LIMIT 5`,
    [id]
  );
  res.json({ downloads: r.downloads, uploads: r.uploads, drafts: r.drafts, finals: r.finals, recent });
}));

// "Download Tax Information Form": one row per file the user has on record
router.get('/forms', asyncRoute(async (req, res) => {
  const p = listParams(req, { category: 'f.type', year: 'f.filing_year', submitted: 'ff.created_at', file: 'ff.original_name' }, 'submitted');
  const where = 'f.user_id = ? AND ff.kind = \'upload\'' + (p.q ? ' AND (f.type LIKE ? OR f.filing_year LIKE ? OR ff.original_name LIKE ?)' : '');
  const args = [req.user.id, ...(p.q ? [like(p.q), like(p.q), like(p.q)] : [])];
  const from = 'FROM filing_files ff JOIN filings f ON f.id = ff.filing_id WHERE ' + where;
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total ' + from, args);
  const [rows] = await pool.query(
    `SELECT ff.id, f.type AS category, f.filing_year AS year, ff.created_at AS submittedAt, ff.original_name AS fileName ${from} ORDER BY ${p.order} LIMIT ? OFFSET ?`,
    [...args, p.limit, p.offset]
  );
  res.json({ rows, total });
}));

async function filingList(req, res, { extraWhere, kinds }) {
  const p = listParams(req, { name: 'f.name', type: 'f.type', year: 'f.filing_year', contact: 'f.contact', submitted: 'f.submitted_at' }, 'submitted');
  let where = 'f.user_id = ? ' + extraWhere;
  const args = [req.user.id];
  const term = p.q || p.name;
  if (term) {
    where += ' AND (f.name LIKE ? OR f.type LIKE ? OR f.filing_year LIKE ? OR f.contact LIKE ?)';
    args.push(like(term), like(term), like(term), like(term));
  }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM filings f WHERE ${where}`, args);
  const [rows] = await pool.query(
    `SELECT f.id, f.name, f.type, f.filing_year AS year, f.contact, f.status, f.submitted_at AS submittedAt
       FROM filings f WHERE ${where} ORDER BY ${p.order} LIMIT ? OFFSET ?`,
    [...args, p.limit, p.offset]
  );
  res.json({ rows: await attachFiles(rows, kinds), total });
}

router.get('/filings', asyncRoute((req, res) => filingList(req, res, { extraWhere: '', kinds: ['upload'] })));

router.get('/drafts', asyncRoute((req, res) => filingList(req, res, {
  extraWhere: "AND EXISTS (SELECT 1 FROM filing_files d WHERE d.filing_id = f.id AND d.kind = 'draft')",
  kinds: ['draft'],
})));

// Final copies are released only once the admin marks the filing Completed
router.get('/finals', asyncRoute((req, res) => filingList(req, res, {
  extraWhere: "AND f.status = 'completed' AND EXISTS (SELECT 1 FROM filing_files d WHERE d.filing_id = f.id AND d.kind = 'final')",
  kinds: ['final'],
})));

router.post('/filings', receiveFiles(), asyncRoute(async (req, res) => {
  const files = req.files;
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const type = String(b.type || '').trim();
  const year = parseInt(b.year, 10);
  const contact = String(b.contact || '').trim();
  const thisYear = new Date().getFullYear();

  let error = null;
  if (!name || name.length > 150) error = 'Filing name is required.';
  else if (!FILING_TYPES.includes(type)) error = 'Select a valid filing type.';
  else if (!(year >= 2000 && year <= thisYear + 1)) error = 'Enter a valid filing year.';
  else if (!/^\+?[\d\s\-().]{7,20}$/.test(contact)) error = 'Enter a valid contact number.';
  if (error) { removeFiles(files); return res.status(400).json({ error }); }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      "INSERT INTO filings (user_id, name, type, filing_year, contact, status) VALUES (?,?,?,?,?,'pending')",
      [req.user.id, name, type, year, contact]
    );
    for (const f of files) {
      await conn.query(
        "INSERT INTO filing_files (filing_id, kind, stored_name, original_name, mime_type, size_bytes, uploaded_by) VALUES (?, 'upload', ?, ?, ?, ?, ?)",
        [r.insertId, f.filename, f.originalname.slice(0, 255), f.mimetype, f.size, req.user.id]
      );
    }
    await conn.query('INSERT INTO filing_status_history (filing_id, from_status, to_status, changed_by, note) VALUES (?, NULL, ?, ?, ?)', [r.insertId, 'pending', req.user.id, 'Submitted']);
    await audit(req.user.id, 'filing.create', 'filing', r.insertId, `${files.length} file(s)`, req.ip, conn);
    await conn.commit();
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (e) {
    await conn.rollback();
    removeFiles(files);
    throw e;
  } finally {
    conn.release();
  }
}));

module.exports = router;
