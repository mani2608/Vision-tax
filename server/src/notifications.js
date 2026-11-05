const { pool } = require('./db');

// "₹5,000" / "₹1,499.50" for messages (amounts are stored in paise).
const inr = (paise) => {
  const r = paise / 100;
  return '₹' + r.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 });
};
const METHOD_LABEL = { card: 'Card', upi: 'UPI', netbanking: 'Netbanking', wallet: 'Wallet', emi: 'EMI', qr: 'QR Code', paylater: 'Pay Later' };
const methodLabel = (m) => METHOD_LABEL[String(m || '').toLowerCase()] || (m ? String(m) : 'Online');

// Everything a notification needs about one payment, joined from the ledger. Works inside a transaction (conn).
async function paymentContext(paymentId, conn = pool) {
  const [[p]] = await conn.query(
    `SELECT p.id, p.amount_paise, p.currency, p.method, p.source, p.utr, p.razorpay_payment_id, p.reference_code,
            COALESCE(p.verified_at, p.reviewed_at, p.updated_at) AS paidAt,
            u.id AS userId, u.first_name AS firstName, CONCAT(u.first_name,' ',u.last_name) AS clientName, u.email AS clientEmail,
            f.id AS filingId, f.name AS filingName, f.type AS filingType, f.filing_year AS filingYear
       FROM payments p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN filings f ON f.id = p.filing_id
      WHERE p.id = ?`,
    [paymentId]
  );
  return p || null;
}

// INSERT IGNORE + UNIQUE(dedupe_key): repeating the same event (webhook retry, double click) never adds a second row.
async function add(n, conn = pool) {
  await conn.query(
    'INSERT IGNORE INTO notifications (audience, user_id, type, title, message, data, payment_id, reference_code, dedupe_key) VALUES (?,?,?,?,?,?,?,?,?)',
    [n.audience, n.userId || null, n.type, n.title, n.message.slice(0, 500), JSON.stringify(n.data || {}), n.paymentId || null, n.reference || null, n.key]
  );
}

const detail = (c) => ({
  clientName: c.clientName, clientEmail: c.clientEmail, filingId: c.filingId, filing: c.filingType || c.filingName,
  filingName: c.filingName, filingYear: c.filingYear, reference: c.reference_code, amount: inr(c.amount_paise),
  method: methodLabel(c.method), razorpayPaymentId: c.razorpay_payment_id || null, utr: c.utr || null,
  paidAt: c.paidAt, status: 'Successful',
});

// Called ONCE per payment, when (and only when) the payment becomes verified-successful.
async function notifyPaymentSuccess(paymentId, conn = pool) {
  const c = await paymentContext(paymentId, conn);
  if (!c || !c.reference_code) return; // plain homepage plan payments have no client dashboard to notify
  const d = detail(c);
  const what = `${c.filingType || c.filingName}${c.filingYear ? ` (${c.filingYear})` : ''}`;
  await add({
    audience: 'admin', type: 'payment_received', title: 'Payment received', paymentId, reference: c.reference_code, data: d, key: `pay-ok:${paymentId}:admin`,
    message: `Payment received successfully! ${c.firstName || c.clientName} has completed the ${inr(c.amount_paise)} payment for filing ${what} using reference ${c.reference_code}.`,
  }, conn);
  if (c.userId) {
    await add({
      audience: 'user', userId: c.userId, type: 'payment_success', title: 'Payment received', paymentId, reference: c.reference_code, data: d, key: `pay-ok:${paymentId}:user`,
      message: `Your payment has been received successfully for your completed filing. ${what} · ${inr(c.amount_paise)} · ${methodLabel(c.method)} · reference ${c.reference_code}.`,
    }, conn);
  }
}

// Manual QR/UPI: the client says they paid. Admin must verify; this is explicitly NOT a success notification.
async function notifyManualSubmitted(paymentId, conn = pool) {
  const c = await paymentContext(paymentId, conn);
  if (!c) return;
  const what = `${c.filingType || c.filingName}${c.filingYear ? ` (${c.filingYear})` : ''}`;
  await add({
    audience: 'admin', type: 'payment_submitted', title: 'Payment awaiting verification', paymentId, reference: c.reference_code,
    data: { ...detail(c), status: 'Submitted - awaiting verification' }, key: `pay-sub:${paymentId}:admin`,
    message: `${c.clientName} says they paid ${inr(c.amount_paise)} by ${methodLabel(c.method)} for ${what} (reference ${c.reference_code}, transaction ref ${c.utr}). Check your bank/UPI statement, then verify or reject it in Payment History.`,
  }, conn);
}

async function notifyManualRejected(paymentId, conn = pool) {
  const c = await paymentContext(paymentId, conn);
  if (!c || !c.userId) return;
  await add({
    audience: 'user', userId: c.userId, type: 'payment_rejected', title: 'Payment could not be verified', paymentId, reference: c.reference_code,
    data: { ...detail(c), status: 'Rejected' }, key: `pay-rej:${paymentId}:user`,
    message: `We could not verify your ${inr(c.amount_paise)} ${methodLabel(c.method)} payment for reference ${c.reference_code}. Please check the transaction reference and submit it again, or contact us.`,
  }, conn);
}

async function notifyReferenceCreated(ref, filing, conn = pool) {
  await add({
    audience: 'user', userId: ref.userId, type: 'payment_requested', title: 'Payment requested', reference: ref.code,
    data: { reference: ref.code, amount: inr(ref.paise), filing: filing.type || filing.name, filingYear: filing.year, expiresAt: ref.expiresAt }, key: `ref-new:${ref.code}:user`,
    message: `A payment of ${inr(ref.paise)} is requested for your completed filing ${filing.type || filing.name} (${filing.year}). Reference ${ref.code}.`,
  }, conn);
}

// The same reference was paid twice (two Razorpay orders both captured). The money is real, so it is recorded;
// the admin is told so the extra payment can be refunded in the Razorpay dashboard.
async function notifyDuplicate(paymentId, conn = pool) {
  const c = await paymentContext(paymentId, conn);
  if (!c) return;
  await add({
    audience: 'admin', type: 'payment_duplicate', title: 'Duplicate payment - refund needed', paymentId, reference: c.reference_code, data: detail(c), key: `pay-dup:${paymentId}:admin`,
    message: `Reference ${c.reference_code} was already paid, but a second payment of ${inr(c.amount_paise)} (${c.razorpay_payment_id || 'manual'}) was also received. Refund the extra payment.`,
  }, conn);
}

module.exports = { inr, methodLabel, notifyPaymentSuccess, notifyManualSubmitted, notifyManualRejected, notifyReferenceCreated, notifyDuplicate };
