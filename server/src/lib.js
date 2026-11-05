const { pool } = require('./db');
const { config } = require('./config');

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

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const validators = {
  email: (s) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 190,
  phoneDigits: (s) => /^\d{7,15}$/.test(s),
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

// Phone rules for the primary market, chosen with PHONE_REGION in server/.env (IN while testing, US for launch).
// Numbers are normalised to E.164 ("+91XXXXXXXXXX" / "+1XXXXXXXXXX"). An explicit other country code (+44 ...) is
// still accepted as generic E.164 so international users are not locked out.
const PHONE_REGIONS = {
  US: { cc: '1', label: 'U.S.', example: '(212) 555-1234', valid: (n) => /^[2-9]\d{2}[2-9]\d{6}$/.test(n), hint: 'area code and exchange cannot start with 0 or 1' },
  IN: { cc: '91', label: 'Indian mobile', example: '98765 43210', valid: (n) => /^[6-9]\d{9}$/.test(n), hint: 'it must start with 6, 7, 8 or 9' },
};

// Returns { value } or { error }.
function normalizePhone(raw, region = config.phoneRegion) {
  const R = PHONE_REGIONS[region] || PHONE_REGIONS.US;
  const s = String(raw || '').trim();
  if (!s) return { error: 'Contact number is required.' };
  if (!/^\+?[\d\s\-().]+$/.test(s)) return { error: 'Phone number may contain only digits, spaces, dashes, dots and parentheses.' };
  const digits = s.replace(/\D/g, '');
  let national;
  if (s.startsWith('+')) {
    if (!digits.startsWith(R.cc)) {
      return digits.length >= 8 && digits.length <= 15
        ? { value: `+${digits}` }
        : { error: 'Enter a valid international number, e.g. +44 20 7946 0958.' };
    }
    national = digits.slice(R.cc.length);
  } else {
    national = digits;
    if (region === 'IN') {
      if (national.length === 12 && national.startsWith('91')) national = national.slice(2);
      else if (national.length === 11 && national.startsWith('0')) national = national.slice(1);
    } else if (national.length === 11 && national.startsWith('1')) national = national.slice(1);
  }
  if (national.length !== 10) return { error: `Enter a valid 10-digit ${R.label} number, e.g. ${R.example}.` };
  if (!R.valid(national)) return { error: `Enter a valid ${R.label} number (${R.hint}).` };
  return { value: `+${R.cc}${national}` };
}

// One rule set for creating AND editing a filing. Returns { error } or { value }.
function validateFilingInput(b = {}) {
  const name = String(b.name || '').trim();
  const type = String(b.type || '').trim();
  const year = parseInt(b.year, 10);
  const thisYear = new Date().getFullYear();
  if (!name || name.length > 150) return { error: 'Filing name is required (150 characters max).' };
  if (!FILING_TYPES.includes(type)) return { error: 'Select a valid filing type.' };
  if (!/^\d{4}$/.test(String(b.year).trim()) || !(year >= 2000 && year <= thisYear + 1)) return { error: 'Enter a valid filing year.' };
  const phone = normalizePhone(b.contact);
  if (phone.error) return { error: phone.error };
  return { value: { name, type, year, contact: phone.value } };
}

module.exports = { FILING_TYPES, STATUSES, TRANSITIONS, USER_EDITABLE, listParams, like, attachFiles, asyncRoute, validators, normalizePhone, validateFilingInput, PHONE_REGIONS };
