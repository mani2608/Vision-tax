const { pool } = require('./db');

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

module.exports = { FILING_TYPES, STATUSES, listParams, like, attachFiles, asyncRoute, validators };
