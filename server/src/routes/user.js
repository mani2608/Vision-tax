const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool, audit } = require('../db');
const { config } = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { receiveFiles, removeFiles } = require('../middleware/upload');
const { effectiveStatusSql } = require('../references');
const { USER_EDITABLE, listParams, like, attachFiles, asyncRoute, validateFilingInput, filingDetails } = require('../lib');

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
  // Final copies are only visible to the client once the filing is Completed (same rule as the download route).
  res.json({ rows: withFiles.map((r) => ({ ...r, files: r.files.filter((f) => f.kind !== 'final' || r.status === 'completed'), editable: USER_EDITABLE.includes(r.status) })), total });
}

// "View My Filings" lists only filings whose payment is still pending / unpaid. A filing counts as paid when the database holds
// a successful payment for it or a payment reference that has been marked paid. Nothing is deleted: paid filings stay in the
// database and remain available under Payments and the Final Copy page. `files` here are the final copies (Completed only).
const UNPAID_SQL = ` AND NOT EXISTS (SELECT 1 FROM payments pm WHERE pm.filing_id = f.id AND pm.status = 'successful')
  AND NOT EXISTS (SELECT 1 FROM payment_references pr WHERE pr.filing_id = f.id AND pr.status = 'paid')`;
router.get('/filings', asyncRoute(async (req, res) => {
  try { await filingList(req, res, { extraWhere: UNPAID_SQL, kinds: ['final'] }); } catch (e) {
    // payments not migrated yet: nothing can be paid, so every filing is unpaid
    if (/ER_NO_SUCH_TABLE|ER_BAD_FIELD_ERROR/.test(e.code || '') && !res.headersSent) return filingList(req, res, { extraWhere: '', kinds: ['final'] });
    throw e;
  }
}));

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
  const [withFiles] = await attachFiles([f], ['upload']);
  res.json({ filing: { ...withFiles, editable: USER_EDITABLE.includes(f.status) } });
}));

// Everything on record for ONE of the signed-in client's own filings (other clients' ids simply return 404).
router.get('/filings/:id/details', asyncRoute(async (req, res) => {
  const d = await filingDetails(Number(req.params.id), req.user.id);
  if (!d) return res.status(404).json({ error: 'Filing not found.' });
  res.json({ filing: d });
}));

// Delete one of the client's own filings (Pending / Ongoing only, same rule as editing). Database rows go in one
// transaction; the stored files are removed from disk only after the commit succeeds.
router.delete('/filings/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const conn = await pool.getConnection();
  let stored = [];
  try {
    await conn.beginTransaction();
    const [[f]] = Number.isInteger(id) && id > 0
      ? await conn.query('SELECT id, status FROM filings WHERE id = ? AND user_id = ? FOR UPDATE', [id, req.user.id])
      : [[]];
    if (!f) throw httpError(404, 'Filing not found.');
    if (!USER_EDITABLE.includes(f.status)) throw httpError(409, 'Completed filings cannot be deleted. Please contact support.');
    [stored] = await conn.query('SELECT stored_name FROM filing_files WHERE filing_id = ?', [f.id]);
    await conn.query('DELETE FROM filings WHERE id = ?', [f.id]); // files, history and download logs cascade
    await audit(req.user.id, 'filing.delete', 'filing', f.id, `${stored.length} file(s)`, req.ip, conn);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: 'This filing has payment records and cannot be deleted.' });
    throw e;
  } finally {
    conn.release();
  }
  for (const r of stored) if (/^[a-f0-9]{32}\.[a-z]{3,4}$/.test(r.stored_name)) fs.unlink(path.join(config.uploadDir, r.stored_name), () => {});
  res.json({ ok: true, message: 'Filing deleted.' });
}));

// Edit the details of an existing filing (same validation as submission). Completed filings are read-only.
router.put('/filings/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
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
    // Same rules as submission. A contact number saved earlier and left untouched is kept as-is, so records
    // created under older rules can still have their other details edited.
    const parsed = validateFilingInput(req.body, f.contact);
    if (parsed.error) { await conn.rollback(); return res.status(400).json({ error: parsed.error }); }
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

// Remove one uploaded document (used when the client saves an edit after pressing the cross). A filing must keep at least
// one document, and Completed filings are read-only.
router.delete('/files/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
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
    if (!USER_EDITABLE.includes(row.status)) throw httpError(409, 'This filing is completed, so its documents can no longer be removed.');
    const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM filing_files WHERE filing_id = ? AND kind = 'upload'", [row.filing_id]);
    if (n <= 1) throw httpError(400, 'A filing must keep at least one document. Choose a replacement instead.');
    oldName = row.stored_name;
    await conn.query('DELETE FROM filing_files WHERE id = ?', [row.id]);
    await conn.query('UPDATE filings SET updated_at = NOW() WHERE id = ?', [row.filing_id]);
    await audit(req.user.id, 'file.remove', 'file', row.id, `filing ${row.filing_id}`, req.ip, conn);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    if (e.http) return res.status(e.http).json({ error: e.message });
    throw e;
  } finally {
    conn.release();
  }
  if (oldName && /^[a-f0-9]{32}\.[a-z]{3,4}$/.test(oldName)) fs.unlink(path.join(config.uploadDir, oldName), () => {});
  res.json({ ok: true, message: 'Document removed.' });
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

// Complete payment history of the signed-in client (never anyone else's). Two sources are merged:
//  - payments: every attempt that was actually submitted (successful / pending verification / failed / cancelled / refunded)
//  - payment references that have no submitted payment yet (still open = pending, expired or cancelled)
// so a requested-but-unpaid amount is visible as "Pending" without any duplicate record being created.
router.get('/payments', asyncRoute(async (req, res) => {
  const p = listParams(req, { date: 'x.date', amount: 'x.amountPaise', status: 'x.status', code: 'x.txn', type: 'x.filingType', year: 'x.filingYear' }, 'date');
  const eff = effectiveStatusSql('r');
  const union = `
    SELECT CONCAT('p', p.id) AS id, p.reference_code AS reference, COALESCE(p.razorpay_payment_id, p.utr, p.reference_code) AS txn,
           p.amount_paise AS amountPaise, p.method AS method, p.source AS source, CAST(p.status AS CHAR) AS status, p.failure_reason AS failureReason,
           COALESCE(p.verified_at, p.reviewed_at, p.created_at) AS date, f.type AS filingType, f.filing_year AS filingYear, f.name AS filingName,
           0 AS payable, NULL AS expiresAt, NULL AS note
      FROM payments p LEFT JOIN filings f ON f.id = p.filing_id WHERE p.user_id = ? AND p.status <> 'created'
    UNION ALL
    SELECT CONCAT('r', r.code), r.code, r.code, r.amount_paise, NULL, NULL, CAST(CASE WHEN ${eff} = 'open' THEN 'pending' ELSE ${eff} END AS CHAR), NULL,
           r.created_at, f.type, f.filing_year, f.name, CASE WHEN ${eff} = 'open' THEN 1 ELSE 0 END, r.expires_at, r.note
      FROM payment_references r JOIN filings f ON f.id = r.filing_id
     WHERE r.user_id = ? AND NOT EXISTS (SELECT 1 FROM payments pm WHERE pm.reference_code = r.code AND pm.status <> 'created')`;
  const args = [req.user.id, req.user.id];
  let where = '1=1';
  if (p.q) { where += ' AND (x.reference LIKE ? OR x.txn LIKE ? OR x.filingName LIKE ? OR x.filingType LIKE ? OR x.filingYear LIKE ?)'; args.push(...Array(5).fill(like(p.q))); }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM (${union}) x WHERE ${where}`, args);
  const [rows] = await pool.query(`SELECT x.* FROM (${union}) x WHERE ${where} ORDER BY ${p.order} LIMIT ? OFFSET ?`, [...args, p.limit, p.offset]);
  res.json({ rows: rows.map((r) => ({ ...r, payable: Number(r.payable) === 1 })), total });
}));

module.exports = router;
