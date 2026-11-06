export const FILING_TYPES = ['W2', 'W2G', '1099-B', '1099-DIV', '1099-G', '1099-INT', '1099-MISC', '1099-NEC', '1098', 'K1', 'Other'];
export const ALLOWED_EXT = ['txt', 'docx', 'pdf', 'rtf', 'xml', 'json', 'csv'];
export const MAX_FILE_MB = 5;
// Filing years offered in the dropdown: the API accepts FIRST_FILING_YEAR up to next year. Change the first year here
// to widen or narrow the list; the list itself always follows the current calendar year.
export const FIRST_FILING_YEAR = 2000;
export function filingYears(keep) {
  const out = [];
  for (let y = new Date().getFullYear() + 1; y >= FIRST_FILING_YEAR; y--) out.push(String(y));
  const k = keep && String(keep); // an existing record's year is always selectable, even if outside the range
  if (k && /^\d{4}$/.test(k) && !out.includes(k)) out.push(k);
  return out;
}
export const MAX_FILES = 10;
export const STATUS_LABEL = { pending: 'Pending', ongoing: 'In Progress', drafted: 'Drafted', completed: 'Completed' };
// Mirrors the server's TRANSITIONS table (the server is the authority; this only shapes the UI).
export const TRANSITIONS = { pending: ['ongoing'], ongoing: ['drafted', 'completed'], drafted: ['ongoing', 'completed'], completed: [] };

// International phone handling (libphonenumber data) is shared with the API: see public/assets/js/phone-core.js.
import VTPhone from '../../public/assets/js/phone-core.js';
export { VTPhone };
// Readable form of a stored number, e.g. "+919876543210" -> "+91 98765 43210". Unreadable values are shown unchanged.
export const fmtPhone = (v) => VTPhone.format(v);

// Display-only settings from the server. defaultCountry just pre-selects the phone country; every country is accepted.
let configPromise = null;
export function loadPublicConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/public/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('config'))))
      .catch(() => { configPromise = null; return { defaultCountry: 'US' }; });
  }
  return configPromise;
}

// Shared by file pickers: returns an error string or ''.
export function fileProblem(f) {
  const ext = f.name.split('.').pop().toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return `"${f.name}" is not an allowed file type (${ALLOWED_EXT.join(', ')}).`;
  if (f.size === 0) return `"${f.name}" is empty.`;
  if (f.size > MAX_FILE_MB * 1024 * 1024) return `"${f.name}" is ${(f.size / 1024 / 1024).toFixed(1)} MB. The maximum is ${MAX_FILE_MB} MB per document.`;
  return '';
}

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
