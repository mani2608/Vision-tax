const { pool } = require('./db');
const { config } = require('./config');
const phone = require('./phone-core');

const FILING_TYPES = ['W2', 'W2G', '1099-B', '1099-DIV', '1099-G', '1099-INT', '1099-MISC', '1099-NEC', '1098', 'K1', 'Other'];
const STATUSES = ['pending', 'ongoing', 'drafted', 'completed'];

// Parses ?page&limit&q&sort&dir. `sortMap` maps public sort keys to safe SQL expressions.
function listParams(req, sortMap, defaultSort) {
  const limit = [10, 25, 50, 100].includes(Number(req.query.limit)) ? Number(req.query.limit) : 10;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const sortExpr = sortMap[req.query.sort] || sortMap[defaultSort];
  const dir = String(req.query.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const q = String(req.query.q || '').trim().slice(0, 100);
  const name = String(req.query.name || '').trim().slice(0, 100);
  return { limit, page, offset: (page - 1) * limit, order: `${sortExpr} ${dir}, 1 ASC`, q, name };
}

const like = (s) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

// Attaches `files` (array of {id, name, kind}) to filing rows, restricted to `kinds`.
async function attachFiles(rows, kinds, conn = pool) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const [files] = await conn.query(
    'SELECT id, filing_id, kind, original_name AS name FROM filing_files WHERE filing_id IN (?) AND kind IN (?) ORDER BY id',
    [ids, kinds]
  );
  const byFiling = new Map(ids.map((i) => [i, []]));
  for (const f of files) byFiling.get(f.filing_id).push({ id: f.id, name: f.name, kind: f.kind });
  return rows.map((r) => ({ ...r, files: byFiling.get(r.id) }));
}

// Full record of ONE filing for the details popup. `ownerId` (users) restricts the lookup to their own filing;
// admins pass null. Users never see final copies before the filing is Completed, matching the download rule.
async function filingDetails(id, ownerId = null) {
  if (!Number.isInteger(id) || id < 1) return null;
  const [[f]] = await pool.query(
    `SELECT f.id, f.name, f.type, f.filing_year AS year, f.contact, f.status, f.submitted_at AS submittedAt, f.updated_at AS updatedAt,
            f.user_id AS userId, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS userName, u.email AS userEmail, u.phone AS userPhone
       FROM filings f JOIN users u ON u.id = f.user_id WHERE f.id = ?${ownerId ? ' AND f.user_id = ?' : ''}`,
    ownerId ? [id, ownerId] : [id]
  );
  if (!f) return null;
  const [files] = await pool.query(
    `SELECT ff.id, ff.kind, ff.original_name AS name, ff.size_bytes AS size, ff.created_at AS createdAt,
            TRIM(CONCAT(up.first_name,' ',up.last_name)) AS uploadedBy
       FROM filing_files ff LEFT JOIN users up ON up.id = ff.uploaded_by WHERE ff.filing_id = ? ORDER BY ff.id`, [id]);
  const visible = files.filter((x) => !ownerId || x.kind !== 'final' || f.status === 'completed');
  const [history] = await pool.query(
    `SELECT h.from_status AS fromStatus, h.to_status AS toStatus, h.note, h.created_at AS at
       FROM filing_status_history h WHERE h.filing_id = ? ORDER BY h.id`, [id]);
  return { ...f, editable: USER_EDITABLE.includes(f.status), files: visible, history };
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const validators = {
  email: (s) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 190,
  strongPassword: (s) => s.length >= 8 && s.length <= 128 && /[A-Z]/.test(s) && /[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s),
};

// Status changes an admin may make. Anything not listed here is rejected by the API.
// Uploading documents never changes status; only an explicit, confirmed transition does.
const TRANSITIONS = {
  pending: ['ongoing'],
  ongoing: ['drafted', 'completed'],
  drafted: ['ongoing', 'completed'],
  completed: [], // Completed is a final status: no reopening through the normal workflow.
};
// Users may edit their own filing details only while it is still being worked on.
// ('drafted' is shown to admins inside the Ongoing section, so it counts as ongoing here.)
const USER_EDITABLE = ['pending', 'ongoing', 'drafted'];

// International phone handling lives in phone-core.js (libphonenumber data, shared with the browser).
// normalizePhone(raw, country) returns { value: '+E164', display, country } or { error }.
// `country` (ISO code such as 'IN') is only used for numbers typed WITHOUT a country code; when the client sends
// none, config.phoneRegion (PHONE_REGION) is used purely as a default, never as a restriction.
function normalizePhone(raw, country) {
  const r = phone.parse(raw, phone.isCountry(country) ? country : config.phoneRegion);
  return r.ok ? { value: r.e164, display: r.international, country: r.country } : { error: r.error };
}

// One rule set for creating AND editing a filing. Returns { error } or { value }.
function validateFilingInput(b = {}, existingContact = null) {
  const name = String(b.name || '').trim();
  const type = String(b.type || '').trim();
  const year = parseInt(b.year, 10);
  const thisYear = new Date().getFullYear();
  if (!name || name.length > 150) return { error: 'Filing name is required (150 characters max).' };
  if (!FILING_TYPES.includes(type)) return { error: 'Select a valid filing type.' };
  if (!/^\d{4}$/.test(String(b.year).trim()) || !(year >= 2000 && year <= thisYear + 1)) return { error: 'Enter a valid filing year.' };
  if (existingContact && String(b.contact || '').trim() === existingContact) {
    return { value: { name, type, year, contact: existingContact } };
  }
  const contact = normalizePhone(b.contact, b.contactCountry);
  if (contact.error) return { error: contact.error };
  return { value: { name, type, year, contact: contact.value } };
}

module.exports = { filingDetails, FILING_TYPES, STATUSES, TRANSITIONS, USER_EDITABLE, listParams, like, attachFiles, asyncRoute, validators, normalizePhone, validateFilingInput };
