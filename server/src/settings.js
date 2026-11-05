const { pool } = require('./db');

// Key/value site settings (QR code file, UPI ID). A missing key means "not configured".
async function getSettings(keys, conn = pool) {
  const [rows] = await conn.query('SELECT setting_key AS k, setting_value AS v, updated_at AS at FROM site_settings WHERE setting_key IN (?)', [keys]);
  return Object.fromEntries(rows.map((r) => [r.k, { value: r.v, at: r.at }]));
}

async function setSetting(key, value, userId, conn = pool) {
  await conn.query(
    'INSERT INTO site_settings (setting_key, setting_value, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by), updated_at = NOW()',
    [key, value, userId]
  );
}

const deleteSettings = (keys, conn = pool) => conn.query('DELETE FROM site_settings WHERE setting_key IN (?)', [keys]);

// Public shape used by the homepage and the admin screens. Never exposes server paths.
async function paymentInfo(conn = pool) {
  const s = await getSettings(['qr_file', 'upi_id'], conn);
  return {
    // Version = the stored file's unique random name, so every replacement yields a new URL (no stale QR in any cache).
    qr: s.qr_file ? { url: `/api/public/payment-qr?v=${s.qr_file.value.slice(0, 12)}` } : null,
    upi: s.upi_id ? s.upi_id.value : null,
  };
}

// UPI ID format: handle@provider, e.g. name@okbank. Format only: it does not prove the ID is active or ours.
const UPI_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}@[a-zA-Z][a-zA-Z0-9]{1,31}$/;
function validateUpi(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { error: 'UPI ID is required.' };
  if (/\s/.test(s)) return { error: 'UPI ID must not contain spaces.' };
  if (!s.includes('@')) return { error: 'UPI ID must look like name@bank.' };
  if (!UPI_RE.test(s)) return { error: 'Enter a valid UPI ID (letters, numbers, dot, dash or underscore, then @bank), e.g. visiontax@okhdfcbank.' };
  return { value: s };
}

module.exports = { getSettings, setSetting, deleteSettings, paymentInfo, validateUpi };
