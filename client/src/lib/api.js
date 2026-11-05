export const FILING_TYPES = ['W2', 'W2G', '1099-B', '1099-DIV', '1099-G', '1099-INT', '1099-MISC', '1099-NEC', '1098', 'K1', 'Other'];
export const ALLOWED_EXT = ['txt', 'docx', 'pdf', 'rtf', 'xml', 'json', 'csv'];
export const MAX_FILE_MB = 5;
export const MAX_FILES = 10;
export const STATUS_LABEL = { pending: 'Pending', ongoing: 'In Progress', drafted: 'Drafted', completed: 'Completed' };
// Mirrors the server's TRANSITIONS table (the server is the authority; this only shapes the UI).
export const TRANSITIONS = { pending: ['ongoing'], ongoing: ['drafted', 'completed'], drafted: ['ongoing', 'completed'], completed: [] };

// Mirrors server normalizePhone(). The active market (IN while testing, US at launch) comes from the server's
// PHONE_REGION via /api/public/config, so there is a single switch. Other +country codes are kept as E.164.
const PHONE_REGIONS = {
  US: { cc: '1', label: 'U.S.', example: '(212) 555-1234', valid: (n) => /^[2-9]\d{2}[2-9]\d{6}$/.test(n), hint: 'area code and exchange cannot start with 0 or 1' },
  IN: { cc: '91', label: 'Indian mobile', example: '98765 43210', valid: (n) => /^[6-9]\d{9}$/.test(n), hint: 'it must start with 6, 7, 8 or 9' },
};
export function normalizePhone(raw, region = 'US') {
  const R = PHONE_REGIONS[region] || PHONE_REGIONS.US;
  const s = String(raw || '').trim();
  if (!s) return { error: 'Contact number is required.' };
  if (!/^\+?[\d\s\-().]+$/.test(s)) return { error: 'Phone number may contain only digits, spaces, dashes, dots and parentheses.' };
  const digits = s.replace(/\D/g, '');
  let national;
  if (s.startsWith('+')) {
    if (!digits.startsWith(R.cc)) {
      return digits.length >= 8 && digits.length <= 15 ? { value: `+${digits}` } : { error: 'Enter a valid international number, e.g. +44 20 7946 0958.' };
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

// Active phone market + placeholder, fetched once from the server.
let configPromise = null;
export function loadPublicConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/public/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('config'))))
      .catch(() => { configPromise = null; return { phoneRegion: 'US', phonePlaceholder: '+1 (212) 555-1234' }; });
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
