export const FILING_TYPES = ['W2', 'W2G', '1099-B', '1099-DIV', '1099-G', '1099-INT', '1099-MISC', '1099-NEC', '1098', 'K1', 'Other'];
export const ALLOWED_EXT = ['txt', 'docx', 'pdf', 'rtf', 'xml', 'json', 'csv'];
export const MAX_FILE_MB = 10;
export const MAX_FILES = 10;
export const STATUS_LABEL = { pending: 'Pending', ongoing: 'In Progress', drafted: 'Drafted', completed: 'Completed' };

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

// Thin fetch wrapper: JSON in/out, FormData passthrough, session cookie included.
export async function api(path, { method = 'GET', body, signal } = {}) {
  const init = { method, credentials: 'same-origin', cache: 'no-store', signal, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(`/api${path}`, init); } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Request failed.', res.status, data.code);
  return data;
}

export const downloadUrl = (fileId) => `/api/files/${fileId}/download`;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');
export function fmtDateTime(v) { // 18-Jun-2025 11:30 AM
  const d = new Date(v); if (isNaN(d)) return '';
  const h = d.getHours() % 12 || 12;
  return `${p2(d.getDate())}-${MON[d.getMonth()]}-${d.getFullYear()} ${p2(h)}:${p2(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}
export function fmtSql(v) { // 2026-08-23 17:31:22
  const d = new Date(v); if (isNaN(d)) return '';
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
export const fmtSize = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || 'U';
