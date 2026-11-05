// Payment reference helpers shared by the admin, client and payment routes.
const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const crypto = require('crypto');
const newRefCode = () => 'VT-' + Array.from(crypto.randomBytes(8), (b) => REF_CHARS[b % REF_CHARS.length]).join('');
const REF_RE = /^[A-Z0-9-]{6,24}$/;

// Status shown to people: an 'open' reference past its expiry date is 'expired'. (paid / pending / cancelled never change.)
// `alias` is the table alias of payment_references in the query.
const effectiveStatusSql = (alias = 'r') =>
  `(CASE WHEN ${alias}.status = 'open' AND ${alias}.expires_at IS NOT NULL AND ${alias}.expires_at < NOW() THEN 'expired' ELSE ${alias}.status END)`;

// Why a reference cannot be paid right now (null = payable). `ref.effective` comes from effectiveStatusSql.
function unpayableReason(effective) {
  switch (effective) {
    case 'open': return null;
    case 'paid': return { code: 409, error: 'This payment reference has already been paid.' };
    case 'pending': return { code: 409, error: 'A payment for this reference is already in progress or awaiting verification.' };
    case 'expired': return { code: 400, error: 'This payment reference has expired. Please contact Vision-Tax for a new one.' };
    case 'cancelled': return { code: 400, error: 'This payment reference has been cancelled.' };
    default: return { code: 400, error: 'This payment reference cannot be used.' };
  }
}

// Plain-rupee string, e.g. 150000 -> "1500.00"
const rupees = (paise) => (paise / 100).toFixed(2);

// "1499.50" -> 149950; null if not a plain INR amount (up to 7 digits, at most 2 decimals).
function parsePaise(v) {
  const s = String(v ?? '').trim();
  return /^\d{1,7}(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : null;
}

module.exports = { newRefCode, REF_RE, effectiveStatusSql, unpayableReason, rupees, parsePaise };
