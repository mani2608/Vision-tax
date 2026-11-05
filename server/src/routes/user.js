const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool, audit } = require('../db');
const { config } = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { receiveFiles, removeFiles } = require('../middleware/upload');
const { effectiveStatusSql } = require('../references');
const { USER_EDITABLE, listParams, like, attachFiles, asyncRoute, validateFilingInput } = require('../lib');

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
  const withFiles = await attachFiles(rows, kinds);
  res.json({ rows: withFiles.map((r) => ({ ...r, editable: USER_EDITABLE.includes(r.status) })), total });
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

const USER_UPLOAD = { maxBytes: config.userMaxFileBytes };
const httpError = (http, message) => Object.assign(new Error(message), { http });

// Single filing, with an `editable` flag the UI uses to show/hide Edit Filing.
router.get('/filings/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const [[f]] = Number.isInteger(id) && id > 0
    ? await pool.query(
      'SELECT id, name, type, filing_year AS year, contact, status, submitted_at AS submittedAt FROM filings WHERE id = ? AND user_id = ?',
      [id, req.user.id])
    : [[]];
  if (!f) return res.status(404).json({ error: 'Filing not found.' });
  res.json({ filing: { ...f, editable: USER_EDITABLE.includes(f.status) } });
}));

// Edit the details of an existing filing (same validation as submission). Completed filings are read-only.
router.put('/filings/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const parsed = validateFilingInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[f]] = Number.isInteger(id) && id > 0
      ? await conn.query('SELECT id, name, type, filing_year, contact, status FROM filings WHERE id = ? AND user_id = ? FOR UPDATE', [id, req.user.id])
      : [[]];
    if (!f) { await conn.rollback(); return res.status(404).json({ error: 'Filing not found.' }); }
    if (!USER_EDITABLE.includes(f.status)) {
      await conn.rollback();
      return res.status(409).json({ error: 'This filing is completed and can no longer be edited. Please contact support for changes.' });
    }
    const v = parsed.value;
    const changed = [];
    if (v.name !== f.name) changed.push('name');
    if (v.type !== f.type) changed.push('type');
    if (v.year !== f.filing_year) changed.push('year');
    if (v.contact !== f.contact) changed.push('contact');
    if (!changed.length) { await conn.rollback(); return res.json({ ok: true, unchanged: true, message: 'No changes to save.' }); }
    // Same row is updated in place: the admin lists read from `filings`, so they show the new values immediately.
    await conn.query('UPDATE filings SET name = ?, type = ?, filing_year = ?, contact = ? WHERE id = ?', [v.name, v.type, v.year, v.contact, f.id]);
    await conn.query('INSERT INTO filing_status_history (filing_id, from_status, to_status, changed_by, note) VALUES (?,?,?,?,?)',
      [f.id, f.status, f.status, req.user.id, `Details edited by client (${changed.join(', ')})`]);
    await audit(req.user.id, 'filing.edit', 'filing', f.id, `fields: ${changed.join(', ')}`, req.ip, conn);
    await conn.commit();
    res.json({ ok: true, message: 'Filing updated successfully.' });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

// Replace one previously uploaded document. The new file is stored first; the old file is removed from disk
// only after the database row points at the new one, so a failure never leaves the record without a file.
router.put('/files/:id', receiveFiles({ ...USER_UPLOAD, maxCount: 1 }), asyncRoute(async (req, res) => {
  const files = req.files;
  const id = Number(req.params.id);
  const file = files[0];
  const conn = await pool.getConnection();
  let oldName = null;
  try {
    await conn.beginTransaction();
    const [[row]] = Number.isInteger(id) && id > 0
      ? await conn.query(
        `SELECT ff.id, ff.filing_id, ff.stored_name, f.status
           FROM filing_files ff JOIN filings f ON f.id = ff.filing_id
          WHERE ff.id = ? AND ff.kind = 'upload' AND f.user_id = ? FOR UPDATE`, [id, req.user.id])
      : [[]];
    if (!row) throw httpError(404, 'Document not found.');
    if (!USER_EDITABLE.includes(row.status)) throw httpError(409, 'This filing is completed, so its documents can no longer be replaced.');
    oldName = row.stored_name;
    await conn.query(
      'UPDATE filing_files SET stored_name = ?, original_name = ?, mime_type = ?, size_bytes = ?, uploaded_by = ?, created_at = NOW() WHERE id = ?',
      [file.filename, file.originalname.slice(0, 255), file.mimetype, file.size, req.user.id, row.id]);
    await conn.query('UPDATE filings SET updated_at = NOW() WHERE id = ?', [row.filing_id]);
    await audit(req.user.id, 'file.replace', 'file', row.id, `filing ${row.filing_id}`, req.ip, conn);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    removeFiles(files); // discard the new upload; the existing record and file are untouched
    if (e.http) return res.status(e.http).json({ error: e.message });
    throw e;
  } finally {
    conn.release();
  }
  if (oldName && /^[a-f0-9]{32}\.[a-z]{3,4}$/.test(oldName)) fs.unlink(path.join(config.uploadDir, oldName), () => {});
  res.json({ ok: true, message: 'Document replaced successfully.', file: { id, name: file.originalname } });
}));

router.post('/filings', receiveFiles(USER_UPLOAD), asyncRoute(async (req, res) => {
  const files = req.files;
  const parsed = validateFilingInput(req.body);
  if (parsed.error) { removeFiles(files); return res.status(400).json({ error: parsed.error }); }
  const { name, type, year, contact } = parsed.value;

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

// ---- Payments: the signed-in client's own payment references and history (never anyone else's) ----------
router.get('/payment-references', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT r.code, r.amount_paise AS amountPaise, r.note, ${effectiveStatusSql('r')} AS status, r.expires_at AS expiresAt, r.created_at AS createdAt, r.paid_at AS paidAt,
            f.id AS filingId, f.name AS filingName, f.type AS filingType, f.filing_year AS filingYear, f.status AS filingStatus,
            p.method AS paidMethod, p.source AS paidSource, p.razorpay_payment_id AS razorpayPaymentId,
            (SELECT COUNT(*) FROM payments m WHERE m.reference_code = r.code AND m.source = 'manual' AND m.status = 'pending') AS awaitingVerification
       FROM payment_references r
       JOIN filings f ON f.id = r.filing_id
       LEFT JOIN payments p ON p.id = r.paid_payment_id
      WHERE r.user_id = ? ORDER BY r.created_at DESC, r.code LIMIT 100`,
    [req.user.id]
  );
  res.json({ rows: rows.map((r) => ({ ...r, awaitingVerification: Number(r.awaitingVerification) > 0 })) });
}));

router.get('/payments', asyncRoute(async (req, res) => {
  const p = listParams(req, { date: 'p.created_at', amount: 'p.amount_paise', status: 'p.status', code: 'p.reference_code' }, 'date');
  const args = [req.user.id];
  let where = "p.user_id = ? AND p.status <> 'created'";
  if (p.q) { where += ' AND (p.reference_code LIKE ? OR f.name LIKE ? OR f.type LIKE ?)'; args.push(...Array(3).fill(like(p.q))); }
  const from = 'FROM payments p LEFT JOIN filings f ON f.id = p.filing_id';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from} WHERE ${where}`, args);
  const [rows] = await pool.query(
    `SELECT p.id, p.reference_code AS reference, p.amount_paise AS amountPaise, p.currency, p.method, p.source, p.status,
            p.razorpay_payment_id AS razorpayPaymentId, p.failure_reason AS failureReason, p.created_at AS createdAt,
            COALESCE(p.verified_at, p.reviewed_at) AS paidAt, f.name AS filingName, f.type AS filingType, f.filing_year AS filingYear
       ${from} WHERE ${where} ORDER BY ${p.order} LIMIT ? OFFSET ?`,
    [...args, p.limit, p.offset]
  );
  res.json({ rows, total });
}));

module.exports = router;
