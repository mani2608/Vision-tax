const express = require('express');
const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const { getSettings, setSetting, deleteSettings, paymentInfo, validateUpi } = require('../settings');
const { pool, audit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { receiveFiles, removeFiles } = require('../middleware/upload');
const { newRefCode, effectiveStatusSql, parsePaise } = require('../references');
const { notifyPaymentSuccess, notifyManualRejected, notifyReferenceCreated } = require('../notifications');
const { STATUSES, TRANSITIONS, listParams, like, attachFiles, asyncRoute, filingDetails } = require('../lib');

const router = express.Router();
router.use(requireAuth(), requireRole('admin'));

const ADMIN_UPLOAD = { maxBytes: config.userMaxFileBytes };
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
            f.user_id AS userId, CONCAT(u.first_name,' ',u.last_name) AS userName, u.email AS userEmail
       ${from} ORDER BY ${p.order} LIMIT ? OFFSET ?`,
    [...args, p.limit, p.offset]
  );
  const out = await attachFiles(rows, ['upload', 'draft', 'final']);
  if (req.query.group === 'completed' && out.length) {
    let refs = [];
    try {
      [refs] = await pool.query(
      `SELECT r.filing_id AS filingId, r.code, r.amount_paise AS amountPaise, ${effectiveStatusSql('r')} AS status, r.expires_at AS expiresAt, r.note
         FROM payment_references r WHERE r.filing_id IN (?) ORDER BY r.created_at DESC, r.code DESC`,
        [out.map((r) => r.id)]
      );
    } catch (e) { if (!/ER_NO_SUCH_TABLE|ER_BAD_FIELD_ERROR/.test(e.code || "")) throw e; } // payments not migrated yet: no references to show
    for (const r of out) r.refs = refs.filter((x) => x.filingId === r.id);
  }
  res.json({ rows: out, total });
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

// Full record of one filing (client contact, every document kind, status history) for the details popup.
router.get('/filings/:id/details', asyncRoute(async (req, res) => {
  const d = await filingDetails(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Filing not found.' });
  res.json({ filing: d });
}));

// Client profile plus all of that client's filings (used when a name is clicked on the All Users page).
router.get('/users/:id/details', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const [[u]] = Number.isInteger(id) && id > 0
    ? await pool.query("SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name, email, phone, created_at AS registeredAt FROM users WHERE id = ? AND role = 'user'", [id])
    : [[]];
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const [filings] = await pool.query(
    'SELECT id, name, type, filing_year AS year, status, submitted_at AS submittedAt FROM filings WHERE user_id = ? ORDER BY submitted_at DESC, id DESC', [id]);
  res.json({ user: u, filings });
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

// Uploading a draft only stores the files. Status changes happen exclusively via PATCH /filings/:id/status.
router.post('/filings/:id/draft', receiveFiles(ADMIN_UPLOAD), asyncRoute((req, res) =>
  withFiling(req, res, async (conn, filing) => {
    if (filing.status === 'completed') throw httpError(409, 'This filing is already completed.');
    await storeFiles(conn, filing.id, 'draft', req.files, req.user.id);
    await audit(req.user.id, 'filing.draft_upload', 'filing', filing.id, `${req.files.length} file(s)`, req.ip, conn);
    return { status: filing.status };
  })
));

// Final files are stored now but only released to the user once status is "completed"
router.post('/filings/:id/final', receiveFiles(ADMIN_UPLOAD), asyncRoute((req, res) =>
  withFiling(req, res, async (conn, filing) => {
    if (filing.status === 'pending') throw httpError(409, 'Start processing first: the upload file is added once the filing is ongoing.');
    await storeFiles(conn, filing.id, 'final', req.files, req.user.id);
    await audit(req.user.id, 'filing.final_upload', 'filing', filing.id, `${req.files.length} file(s)`, req.ip, conn);
    return { status: filing.status };
  })
));

// ---- Edit / delete a document the admin uploaded (Draft File or Upload File). Client-uploaded documents are never touched.
// Same rules as uploading: draft files are frozen once the filing is Completed. The new file is stored first and the old
// one is unlinked only after the commit, so a failure never leaves the record without a file.
const STORED_RE = /^[a-f0-9]{32}\.[a-z]{3,4}$/;
const unlinkStored = (name) => { if (name && STORED_RE.test(name)) fs.unlink(path.join(config.uploadDir, name), () => {}); };

async function lockAdminFile(conn, id) {
  const [[row]] = Number.isInteger(id) && id > 0
    ? await conn.query(
      `SELECT ff.id, ff.filing_id, ff.kind, ff.stored_name, f.status
         FROM filing_files ff JOIN filings f ON f.id = ff.filing_id
        WHERE ff.id = ? AND ff.kind IN ('draft','final') FOR UPDATE`, [id])
    : [[]];
  if (!row) throw httpError(404, 'Document not found.');
  if (row.kind === 'draft' && row.status === 'completed') throw httpError(409, 'This filing is already completed, so its draft documents are locked.');
  return row;
}

router.put('/files/:id', receiveFiles({ ...ADMIN_UPLOAD, maxCount: 1 }), asyncRoute(async (req, res) => {
  const files = req.files;
  const file = files[0];
  const id = Number(req.params.id);
  const conn = await pool.getConnection();
  let oldName = null;
  try {
    await conn.beginTransaction();
    const row = await lockAdminFile(conn, id);
    oldName = row.stored_name;
    await conn.query(
      'UPDATE filing_files SET stored_name = ?, original_name = ?, mime_type = ?, size_bytes = ?, uploaded_by = ?, created_at = NOW() WHERE id = ?',
      [file.filename, file.originalname.slice(0, 255), file.mimetype, file.size, req.user.id, row.id]);
    await conn.query('UPDATE filings SET updated_at = NOW() WHERE id = ?', [row.filing_id]);
    await audit(req.user.id, 'file.admin_replace', 'file', row.id, `filing ${row.filing_id} ${row.kind}`, req.ip, conn);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    removeFiles(files);
    if (e.http) return res.status(e.http).json({ error: e.message });
    throw e;
  } finally {
    conn.release();
  }
  unlinkStored(oldName);
  res.json({ ok: true, message: 'Document replaced.', file: { id, name: file.originalname } });
}));

router.delete('/files/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const conn = await pool.getConnection();
  let oldName = null;
  try {
    await conn.beginTransaction();
    const row = await lockAdminFile(conn, id);
    // Do not strip a document the current status depends on.
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM filing_files WHERE filing_id = ? AND kind = ?', [row.filing_id, row.kind]);
    if (n <= 1 && row.kind === 'final' && row.status === 'completed') throw httpError(409, 'A completed filing must keep its Upload File. Replace it instead.');
    if (n <= 1 && row.kind === 'draft' && row.status === 'drafted') throw httpError(409, 'A drafted filing must keep its draft document. Replace it instead.');
    oldName = row.stored_name;
    await conn.query('DELETE FROM filing_files WHERE id = ?', [row.id]);
    await conn.query('UPDATE filings SET updated_at = NOW() WHERE id = ?', [row.filing_id]);
    await audit(req.user.id, 'file.admin_delete', 'file', row.id, `filing ${row.filing_id} ${row.kind}`, req.ip, conn);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    if (e.http) return res.status(e.http).json({ error: e.message });
    throw e;
  } finally {
    conn.release();
  }
  unlinkStored(oldName);
  res.json({ ok: true, message: 'Document deleted.' });
}));

router.patch('/filings/:id/status', asyncRoute((req, res) =>
  withFiling(req, res, async (conn, filing) => {
    const to = String((req.body || {}).status || '');
    const note = String((req.body || {}).note || '').slice(0, 255) || null;
    const b = req.body || {};
    if (b.confirm !== true) throw httpError(400, 'This status change must be explicitly confirmed.');
    if (!STATUSES.includes(to)) throw httpError(400, 'Invalid status.');
    // Stale-screen / double-click guard: the client says which status it believes the filing has.
    if (b.from !== undefined && b.from !== filing.status) {
      throw httpError(409, `This filing is now "${filing.status}". Refresh the page and try again.`);
    }
    // Saving the status a working filing already has is a harmless no-op (still validated above); Completed never is.
    if (to === filing.status && ['ongoing', 'drafted'].includes(to)) return { status: to, unchanged: true };
    if (to === filing.status) throw httpError(409, 'Filing already has that status.');
    if (!(TRANSITIONS[filing.status] || []).includes(to)) {
      throw httpError(400, `A filing cannot move from "${filing.status}" to "${to}".`);
    }
    const count = async (kind) => (await conn.query('SELECT COUNT(*) AS n FROM filing_files WHERE filing_id = ? AND kind = ?', [filing.id, kind]))[0][0].n;
    // A filing only moves forward once the admin has uploaded the file for the client (the upload itself never moves it).
    if (filing.status === 'pending' && to === 'ongoing' && !(await count('draft'))) throw httpError(400, 'Upload a document for the client before starting processing.');
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

// ---- Payment QR code & UPI ID (shown on the public homepage) --------------------------------------
const QR_MAX_BYTES = 2 * 1024 * 1024;
const removeStored = (name) => {
  if (name && /^[a-f0-9]{32}\.[a-z]{3,4}$/.test(name)) fs.unlink(path.join(config.uploadDir, name), () => {});
};

router.get('/payment-settings', asyncRoute(async (_req, res) => res.json(await paymentInfo())));

// Upload a new QR code, or replace the active one. The old file is deleted only after the new one is saved.
router.post('/qr', receiveFiles({ images: true, maxBytes: QR_MAX_BYTES, maxCount: 1, emptyMessage: 'Please choose a QR code image (PNG, JPG or WebP) to upload.' }), asyncRoute(async (req, res) => {
  const file = req.files[0];
  const conn = await pool.getConnection();
  let old = null;
  try {
    await conn.beginTransaction();
    const cur = await getSettings(['qr_file'], conn);
    old = cur.qr_file && cur.qr_file.value;
    await setSetting('qr_file', file.filename, req.user.id, conn);
    await setSetting('qr_mime', file.mimetype, req.user.id, conn);
    await audit(req.user.id, old ? 'qr.replace' : 'qr.upload', 'setting', null, null, req.ip, conn);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    removeFiles(req.files);
    throw e;
  } finally {
    conn.release();
  }
  removeStored(old);
  res.json({ ok: true, replaced: Boolean(old), message: old ? 'QR code replaced.' : 'QR code saved.', ...(await paymentInfo()) });
}));

router.delete('/qr', asyncRoute(async (req, res) => {
  const cur = await getSettings(['qr_file']);
  if (!cur.qr_file) return res.status(404).json({ error: 'No QR code is configured.' });
  await deleteSettings(['qr_file', 'qr_mime']);
  await audit(req.user.id, 'qr.remove', 'setting', null, null, req.ip);
  removeStored(cur.qr_file.value);
  res.json({ ok: true, message: 'QR code removed.', ...(await paymentInfo()) });
}));

router.put('/upi', asyncRoute(async (req, res) => {
  const v = validateUpi((req.body || {}).upi);
  if (v.error) return res.status(400).json({ error: v.error });
  const had = Boolean((await getSettings(['upi_id'])).upi_id);
  await setSetting('upi_id', v.value, req.user.id);
  await audit(req.user.id, had ? 'upi.update' : 'upi.add', 'setting', null, v.value, req.ip);
  res.json({ ok: true, message: had ? 'UPI ID updated.' : 'UPI ID saved.', ...(await paymentInfo()) });
}));

router.delete('/upi', asyncRoute(async (req, res) => {
  if (!(await getSettings(['upi_id'])).upi_id) return res.status(404).json({ error: 'No UPI ID is configured.' });
  await deleteSettings(['upi_id']);
  await audit(req.user.id, 'upi.remove', 'setting', null, null, req.ip);
  res.json({ ok: true, message: 'UPI ID removed.', ...(await paymentInfo()) });
}));

// ---- Payment references: fixed-amount requests tied to ONE client and ONE Completed filing -----------------
const MIN_PAISE = 100;
const MAX_PAISE = 50_000_000;

// Searchable client picker: registered clients only (never admins), matched on name or email.
router.get('/clients', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const args = [];
  let where = "role = 'user' AND status = 'active'";
  if (q) { where += " AND (CONCAT(first_name,' ',last_name) LIKE ? OR email LIKE ?)"; args.push(like(q), like(q)); }
  const [rows] = await pool.query(
    `SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name, email FROM users WHERE ${where} ORDER BY first_name, last_name, id LIMIT 30`,
    args
  );
  res.json({ rows });
}));

// Completed filings of the chosen client (the only ones a reference can be created for).
router.get('/clients/:id/filings', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid client.' });
  const [rows] = await pool.query(
    `SELECT f.id, f.name, f.type, f.filing_year AS year,
            (SELECT COUNT(*) FROM payment_references r WHERE r.filing_id = f.id AND (r.status = 'pending' OR (r.status = 'open' AND (r.expires_at IS NULL OR r.expires_at >= NOW())))) AS activeRefs
       FROM filings f WHERE f.user_id = ? AND f.status = 'completed' ORDER BY f.filing_year DESC, f.id DESC`,
    [id]
  );
  res.json({ rows: rows.map((r) => ({ ...r, activeRefs: Number(r.activeRefs) })) });
}));

const REF_SELECT = `SELECT r.code AS id, r.code, r.amount_paise AS amountPaise, r.note, ${effectiveStatusSql('r')} AS status, r.expires_at AS expiresAt,
         r.created_at AS createdAt, r.paid_at AS paidAt, r.user_id AS userId, r.filing_id AS filingId,
         TRIM(CONCAT(u.first_name,' ',u.last_name)) AS clientName, u.email AS clientEmail,
         f.name AS filingName, f.type AS filingType, f.filing_year AS filingYear,
         p.method AS paidMethod, p.razorpay_payment_id AS razorpayPaymentId, p.source AS paidSource
    FROM payment_references r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN filings f ON f.id = r.filing_id
    LEFT JOIN payments p ON p.id = r.paid_payment_id`;

router.get('/payment-references', asyncRoute(async (req, res) => {
  const p = listParams(req, {
    created: 'r.created_at', code: 'r.code', client: "CONCAT(u.first_name,' ',u.last_name)", amount: 'r.amount_paise',
    status: effectiveStatusSql('r'), expires: 'r.expires_at', filing: 'f.name',
  }, 'created');
  const args = [];
  let where = '1=1';
  const status = String(req.query.status || '');
  const fid = Number(req.query.filingId);
  if (Number.isInteger(fid) && fid > 0) { where += ' AND r.filing_id = ?'; args.push(fid); }
  if (['open', 'pending', 'paid', 'expired', 'cancelled'].includes(status)) { where += ` AND ${effectiveStatusSql('r')} = ?`; args.push(status); }
  if (p.q) {
    where += " AND (r.code LIKE ? OR CONCAT(u.first_name,' ',u.last_name) LIKE ? OR u.email LIKE ? OR f.name LIKE ? OR f.type LIKE ? OR r.note LIKE ?)";
    args.push(...Array(6).fill(like(p.q)));
  }
  const from = 'FROM payment_references r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN filings f ON f.id = r.filing_id';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from} WHERE ${where}`, args);
  const [rows] = await pool.query(`${REF_SELECT} WHERE ${where} ORDER BY ${p.order} LIMIT ? OFFSET ?`, [...args, p.limit, p.offset]);
  res.json({ rows, total });
}));

router.post('/payment-references', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const userId = Number(b.userId);
  const filingId = Number(b.filingId);
  if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: 'Select a client.' });
  if (!Number.isInteger(filingId) || filingId < 1) return res.status(400).json({ error: 'Select a completed filing for this client.' });
  const paise = parsePaise(b.amount);
  if (paise === null) return res.status(400).json({ error: 'Enter a valid amount in INR (up to 2 decimal places).' });
  if (paise < MIN_PAISE || paise > MAX_PAISE) return res.status(400).json({ error: 'The amount must be between ₹1 and ₹5,00,000.' });
  const days = Number(b.days ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 90) return res.status(400).json({ error: 'Validity must be 1 to 90 days.' });
  const note = String(b.note || '').trim().slice(0, 190) || null;

  const conn = await pool.getConnection();
  let code; let expiresAt; let filing;
  try {
    await conn.beginTransaction();
    // Ownership and status are decided here, on the server, under a row lock - never trusted from the browser.
    const [[row]] = await conn.query(
      `SELECT f.id, f.user_id, f.name, f.type, f.filing_year AS year, f.status, u.role, u.status AS userStatus
         FROM filings f JOIN users u ON u.id = f.user_id WHERE f.id = ? FOR UPDATE`,
      [filingId]
    );
    if (!row || row.user_id !== userId || row.role !== 'user') { await conn.rollback(); return res.status(400).json({ error: 'That filing does not belong to the selected client.' }); }
    if (row.userStatus !== 'active') { await conn.rollback(); return res.status(400).json({ error: 'The selected client account is disabled.' }); }
    if (row.status !== 'completed') { await conn.rollback(); return res.status(400).json({ error: 'Payment references can only be created for Completed filings.' }); }
    const [[active]] = await conn.query(
      "SELECT COUNT(*) AS n FROM payment_references WHERE filing_id = ? AND (status = 'pending' OR (status = 'open' AND (expires_at IS NULL OR expires_at >= NOW())))",
      [filingId]
    );
    if (active.n > 0) { await conn.rollback(); return res.status(409).json({ error: 'This filing already has an active payment reference. Cancel it first or wait until it is paid or expires.' }); }

    code = newRefCode();
    await conn.query(
      'INSERT INTO payment_references (code, user_id, filing_id, amount_paise, note, expires_at, created_by) VALUES (?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ? DAY), ?)',
      [code, userId, filingId, paise, note, days, req.user.id]
    );
    const [[{ exp }]] = await conn.query('SELECT expires_at AS exp FROM payment_references WHERE code = ?', [code]);
    expiresAt = exp; filing = row;
    await audit(req.user.id, 'payment_reference.create', 'filing', filingId, `${code} ${paise} paise client ${userId}`, req.ip, conn);
    await notifyReferenceCreated({ code, userId, paise, expiresAt }, filing, conn);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  res.status(201).json({ ok: true, code, expiresAt, message: 'Payment reference created.' });
}));

// Cancel: only a reference that is still Open (not paid, not awaiting verification, not already expired).
router.delete('/payment-references/:code', asyncRoute(async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const [r] = await pool.query("UPDATE payment_references SET status = 'cancelled' WHERE code = ? AND status = 'open' AND (expires_at IS NULL OR expires_at >= NOW())", [code]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Reference not found or it can no longer be cancelled.' });
  await audit(req.user.id, 'payment_reference.cancel', 'setting', null, code, req.ip);
  res.json({ ok: true, message: 'Payment reference cancelled.' });
}));

// ---- Payment history (Razorpay + manual QR/UPI) -----------------------------------------------------
router.get('/payments', asyncRoute(async (req, res) => {
  const p = listParams(req, {
    date: 'p.created_at', client: "CONCAT(u.first_name,' ',u.last_name)", amount: 'p.amount_paise', status: 'p.status', method: 'p.method', code: 'p.reference_code',
  }, 'date');
  const args = [];
  let where = '1=1';
  const status = String(req.query.status || '');
  if (['created', 'pending', 'successful', 'failed', 'cancelled', 'refunded'].includes(status)) { where += ' AND p.status = ?'; args.push(status); }
  else where += " AND p.status <> 'created'"; // abandoned checkouts that never reached Razorpay are noise in the default view
  if (['razorpay', 'manual'].includes(String(req.query.source))) { where += ' AND p.source = ?'; args.push(req.query.source); }
  if (p.q) {
    where += " AND (p.reference_code LIKE ? OR CONCAT(u.first_name,' ',u.last_name) LIKE ? OR u.email LIKE ? OR p.payer_email LIKE ? OR p.razorpay_payment_id LIKE ? OR p.razorpay_order_id LIKE ? OR p.utr LIKE ? OR f.name LIKE ?)";
    args.push(...Array(8).fill(like(p.q)));
  }
  const from = 'FROM payments p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN filings f ON f.id = p.filing_id';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from} WHERE ${where}`, args);
  const [rows] = await pool.query(
    `SELECT p.id, p.reference_code AS reference, p.amount_paise AS amountPaise, p.currency, p.method, p.source, p.status, p.utr,
            p.razorpay_payment_id AS razorpayPaymentId, p.razorpay_order_id AS razorpayOrderId, p.failure_reason AS failureReason,
            p.review_note AS reviewNote, p.created_at AS createdAt, COALESCE(p.verified_at, p.reviewed_at) AS paidAt,
            COALESCE(NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)), ''), p.payer_name) AS clientName, COALESCE(u.email, p.payer_email) AS clientEmail,
            p.user_id AS userId, p.filing_id AS filingId, f.name AS filingName, f.type AS filingType, f.filing_year AS filingYear, p.plan
       ${from} WHERE ${where} ORDER BY ${p.order} LIMIT ? OFFSET ?`,
    [...args, p.limit, p.offset]
  );
  res.json({ rows, total });
}));

// Admin confirms that a manual QR/UPI payment really arrived (after checking the bank / UPI statement).
router.post('/payments/:id/verify', asyncRoute(async (req, res) => {
  if ((req.body || {}).confirm !== true) return res.status(400).json({ error: 'Confirmation is required to verify a payment.' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid payment.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[pay]] = await conn.query('SELECT * FROM payments WHERE id = ? FOR UPDATE', [id]);
    if (!pay || pay.source !== 'manual') { await conn.rollback(); return res.status(404).json({ error: 'Manual payment not found.' }); }
    if (pay.status !== 'pending') { await conn.rollback(); return res.status(409).json({ error: `This payment is already ${pay.status}.` }); }
    const [[ref]] = await conn.query('SELECT status, paid_payment_id FROM payment_references WHERE code = ? FOR UPDATE', [pay.reference_code]);
    if (!ref || ref.status === 'paid') { await conn.rollback(); return res.status(409).json({ error: 'This payment reference has already been paid.' }); }
    await conn.query("UPDATE payments SET status = 'successful', verified_at = NOW(), reviewed_by = ?, reviewed_at = NOW(), failure_reason = NULL WHERE id = ?", [req.user.id, id]);
    await conn.query("UPDATE payment_references SET status = 'paid', paid_at = NOW(), paid_payment_id = ? WHERE code = ?", [id, pay.reference_code]);
    await audit(req.user.id, 'payment.manual_verified', 'payment', id, pay.reference_code, req.ip, conn);
    await notifyPaymentSuccess(id, conn);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  res.json({ ok: true, message: 'Payment verified and marked as paid.' });
}));

router.post('/payments/:id/reject', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid payment.' });
  const note = String((req.body || {}).note || '').trim().slice(0, 255) || 'Payment could not be verified.';
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[pay]] = await conn.query('SELECT * FROM payments WHERE id = ? FOR UPDATE', [id]);
    if (!pay || pay.source !== 'manual') { await conn.rollback(); return res.status(404).json({ error: 'Manual payment not found.' }); }
    if (pay.status !== 'pending') { await conn.rollback(); return res.status(409).json({ error: `This payment is already ${pay.status}.` }); }
    await conn.query("UPDATE payments SET status = 'failed', failure_reason = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?", [note, note, req.user.id, id]);
    await conn.query("UPDATE payment_references SET status = 'open' WHERE code = ? AND status = 'pending'", [pay.reference_code]); // payable again
    await audit(req.user.id, 'payment.manual_rejected', 'payment', id, pay.reference_code, req.ip, conn);
    await notifyManualRejected(id, conn);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  res.json({ ok: true, message: 'Payment rejected. The client can submit it again.' });
}));

module.exports = router;
