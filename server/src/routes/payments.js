// Razorpay (TEST mode) checkout for the public "Pay Now" form. Currency is always INR.
// Success is never taken from the browser: a payment becomes "successful" only after the signature is verified AND
// Razorpay itself reports the payment as captured for the exact amount/currency of the order (or a signed webhook says so).
const crypto = require('crypto');
const express = require('express');
const Razorpay = require('razorpay');
const rateLimit = require('express-rate-limit');
const { pool, audit } = require('../db');
const { config } = require('../config');
const { asyncRoute, validators, normalizePhone } = require('../lib');
const { PLANS } = require('../plans');
const { requireAuth } = require('../middleware/auth');
const notify = require('../notifications');
const { REF_RE, effectiveStatusSql, unpayableReason, rupees, parsePaise } = require('../references');

const router = express.Router();
const CURRENCY = 'INR';
const MIN_PAISE = 100;            // Rs 1
const MAX_PAISE = 50_000_000;     // Rs 5,00,000
const ONLINE_METHODS = ['card'];
const MANUAL_METHODS = ['zelle', 'paypal'];

const ORDER_RE = /^order_[A-Za-z0-9]{6,40}$/;
const PAY_RE = /^pay_[A-Za-z0-9]{6,40}$/;

let client = null;
function razorpay() {
  const { keyId, keySecret } = config.razorpay;
  if (!keyId || !keySecret) return null;
  if (!client) client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return client;
}
const notConfigured = (res) => res.status(503).json({ error: 'Online payments are not available right now. Please try again later or use a manual payment option.' });

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const limiter = (limit) => rateLimit({ windowMs: 10 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please wait a few minutes and try again.' } });

const MESSAGES = {
  created: 'Payment not completed yet.',
  pending: 'Your payment is being verified. This can take a few moments. Use "Check payment status" to see the latest result.',
  successful: 'Payment successful. Thank you!',
  failed: 'Your payment failed. You have not been charged for a failed payment. Please try again.',
  cancelled: 'Payment cancelled. No payment was taken.',
  refunded: 'This payment has been refunded.',
};
const view = (row) => ({
  status: row.status,
  message: MESSAGES[row.status],
  reason: row.status === 'failed' ? row.failure_reason : null,
  orderId: row.razorpay_order_id,
  reference: row.status === 'successful' || row.status === 'refunded' || row.status === 'pending' ? row.razorpay_payment_id : null,
  amount: (row.amount_paise / 100).toFixed(2),
  currency: row.currency,
});

// Applies a Razorpay payment entity to our order row. Idempotent: safe to call from verify, status polling and webhooks.
async function applyPayment(orderId, entity) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query('SELECT * FROM payments WHERE razorpay_order_id = ? FOR UPDATE', [orderId]);
    if (!row) { await conn.rollback(); return null; }
    if (row.status === 'successful' || row.status === 'refunded') { await conn.commit(); return row; } // never downgrade or re-process
    if (entity.order_id !== orderId) { await conn.rollback(); return row; }

    let status; let reason = null; let verifiedAt = null;
    if (Number(entity.amount) !== row.amount_paise || entity.currency !== row.currency) {
      status = 'failed'; reason = 'Payment amount or currency did not match the order.';
    } else if (entity.status === 'captured') {
      status = 'successful'; verifiedAt = new Date();
    } else if (entity.status === 'failed') {
      status = 'failed'; reason = String(entity.error_description || 'Payment failed.').slice(0, 255);
    } else {
      status = 'pending'; // created / authorized: not yet confirmed
    }
    await conn.query(
      'UPDATE payments SET status = ?, razorpay_payment_id = ?, method = ?, verified_at = ?, failure_reason = ? WHERE id = ?',
      [status, entity.id, entity.method ? String(entity.method).slice(0, 30) : row.method, verifiedAt, reason, row.id]
    );
    if (status === 'successful') {
      await audit(null, 'payment.success', 'payment', row.id, `${row.amount_paise} ${row.currency}`, null, conn);
      // The linked reference becomes Paid (once) and can never be used again. If it was already paid by a different
      // payment, this one is a duplicate: the money is real so it is recorded, and the admin is told to refund it.
      const [r] = await conn.query(
        "UPDATE payment_references SET status = 'paid', paid_at = NOW(), paid_payment_id = ? WHERE razorpay_order_id = ? AND status IN ('open','pending','expired')",
        [row.id, orderId]
      );
      if (!r.affectedRows && row.reference_code) {
        const [[ref]] = await conn.query('SELECT paid_payment_id FROM payment_references WHERE code = ?', [row.reference_code]);
        if (ref && ref.paid_payment_id && ref.paid_payment_id !== row.id) {
          await audit(null, 'payment.duplicate', 'payment', row.id, row.reference_code, null, conn);
          await notify.notifyDuplicate(row.id, conn);
        }
      }
      if (row.reference_code) await notify.notifyPaymentSuccess(row.id, conn);
    } else if (row.reference_code) {
      // pending locks the reference while we wait for Razorpay; a failed attempt makes it payable again
      await conn.query("UPDATE payment_references SET status = ? WHERE code = ? AND status IN ('open','pending') AND razorpay_order_id = ?", [status === 'pending' ? 'pending' : 'open', row.reference_code, orderId]);
    }
    await conn.commit();
    return { ...row, status, razorpay_payment_id: entity.id, failure_reason: reason };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

const getRow = async (orderId) => (ORDER_RE.test(String(orderId || '')) ? (await pool.query('SELECT * FROM payments WHERE razorpay_order_id = ?', [orderId]))[0][0] : null);

const normRef = (s) => String(s || '').trim().toUpperCase();
// Looks up an admin-created payment reference that can still be paid. Returns the row or null.
async function openReference(code) {
  if (!REF_RE.test(code)) return null;
  // Only legacy references (not tied to a client) can be used on the public form. Client references are paid from the
  // signed-in client's dashboard, so a leaked code is useless to anyone else.
  const [[ref]] = await pool.query(`SELECT r.*, ${effectiveStatusSql('r')} AS effective FROM payment_references r WHERE r.code = ? AND r.user_id IS NULL`, [code]);
  if (!ref || ref.effective !== 'open') return null;
  return ref;
}

// Public price list for the form (display only: the server recomputes the amount on every order).
router.get('/plans', (_req, res) => {
  res.json({
    currency: CURRENCY,
    plans: Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, { label: p.label, amount: p.paise === null ? null : rupees(p.paise) }])),
  });
});

// Amount for an admin-created reference (custom invoices). Generic 404 so codes cannot be probed for status.
router.get('/reference/:code', limiter(30), asyncRoute(async (req, res) => {
  const ref = await openReference(normRef(req.params.code));
  if (!ref) return res.status(404).json({ error: 'This payment reference is invalid or has expired.' });
  res.json({ amount: rupees(ref.amount_paise), note: ref.note });
}));

// 1) Create an order. The amount ALWAYS comes from the server (plan price list or admin-created reference);
//    a browser-supplied amount is only compared against it and rejected if it differs.
router.post('/order', limiter(30), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const method = String(b.method || 'card');
  if (MANUAL_METHODS.includes(method)) return res.status(400).json({ error: `${method === 'zelle' ? 'Zelle' : 'PayPal'} is a manual payment option and is not available for online checkout.` });
  if (!ONLINE_METHODS.includes(method)) return res.status(400).json({ error: 'Select a supported payment method.' });
  const plan = String(b.plan || '');
  if (!Object.hasOwn(PLANS, plan)) return res.status(400).json({ error: 'Select a valid filing plan.' });

  let paise; let reference = null;
  if (PLANS[plan].paise === null) {
    const code = normRef(b.reference);
    if (!code) return res.status(400).json({ error: 'Custom payments need a payment reference from Vision-Tax. Please contact us to get one.' });
    reference = await openReference(code);
    if (!reference) return res.status(400).json({ error: 'This payment reference is invalid or has expired.' });
    if (reference.razorpay_order_id) { // an earlier attempt must not be in flight or already paid
      const [[prev]] = await pool.query('SELECT status FROM payments WHERE razorpay_order_id = ?', [reference.razorpay_order_id]);
      if (prev && (prev.status === 'successful' || prev.status === 'pending')) return res.status(409).json({ error: 'A payment for this reference is already in progress or completed.' });
    }
    paise = reference.amount_paise;
  } else {
    paise = PLANS[plan].paise;
  }
  if (b.amount !== undefined && b.amount !== null && String(b.amount).trim() !== '' && parsePaise(b.amount) !== paise) {
    return res.status(400).json({ error: 'The amount does not match the approved price for this plan. Please refresh the page and try again.' });
  }
  if (paise < MIN_PAISE || paise > MAX_PAISE) return res.status(400).json({ error: 'This payment amount is not supported online. Please contact us.' });
  const name = String(b.name || '').trim();
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Enter your full name.' });
  const email = String(b.email || '').trim().toLowerCase();
  if (!validators.email(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const phone = normalizePhone(b.phone, b.country);
  if (phone.error) return res.status(400).json({ error: phone.error });

  const rz = razorpay();
  if (!rz) return notConfigured(res);

  let order;
  try {
    order = await rz.orders.create({
      amount: paise,
      currency: CURRENCY,
      receipt: `vt_${Date.now()}`,
      notes: { plan, payer_email: email, ...(reference ? { reference: reference.code } : {}) },
    });
  } catch (e) {
    console.error('Razorpay order creation failed:', e && e.statusCode, e && e.error && e.error.description);
    return res.status(502).json({ error: 'Could not start the payment. Please try again in a moment.' });
  }
  await pool.query(
    "INSERT INTO payments (plan, amount_paise, currency, payer_name, payer_email, payer_phone, razorpay_order_id, method, status) VALUES (?,?,?,?,?,?,?,?, 'created')",
    [plan, paise, CURRENCY, name, email, phone.value, order.id, method]
  );
  if (reference) await pool.query('UPDATE payment_references SET razorpay_order_id = ? WHERE code = ?', [order.id, reference.code]);
  res.status(201).json({
    orderId: order.id,
    amount: paise,
    currency: CURRENCY,
    keyId: config.razorpay.keyId, // public key id only; the secret never leaves the server
    description: PLANS[plan].label,
    prefill: { name, email, contact: phone.value },
  });
}));

// 2) The browser reports the checkout result; we verify the signature and confirm with Razorpay before trusting it.
router.post('/verify', limiter(60), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const orderId = String(b.razorpay_order_id || '');
  const paymentId = String(b.razorpay_payment_id || '');
  const signature = String(b.razorpay_signature || '');
  if (!ORDER_RE.test(orderId) || !PAY_RE.test(paymentId) || !signature) return res.status(400).json({ error: 'Invalid payment details.' });
  const rz = razorpay();
  if (!rz) return notConfigured(res);
  const row = await getRow(orderId);
  if (!row) return res.status(404).json({ error: 'Payment not found.' });
  if (!safeEqual(hmac(config.razorpay.keySecret, `${orderId}|${paymentId}`), signature)) {
    console.warn('Payment signature mismatch for', orderId);
    return res.status(400).json({ error: 'Payment verification failed. If money was deducted, it will be refunded automatically.' });
  }
  let entity;
  try {
    entity = await rz.payments.fetch(paymentId);
    if (entity.status === 'authorized') {
      try { entity = await rz.payments.capture(paymentId, entity.amount, entity.currency); } catch { /* auto-capture may have run already */ }
    }
  } catch (e) {
    // Signature is valid but we cannot confirm amount/capture right now: keep it pending; the webhook/status check finishes it.
    console.error('Razorpay payment fetch failed:', e && e.statusCode);
    await pool.query("UPDATE payments SET status = 'pending', razorpay_payment_id = ? WHERE id = ? AND status IN ('created','failed','cancelled')", [paymentId, row.id]);
    return res.json(view({ ...row, status: 'pending', razorpay_payment_id: paymentId }));
  }
  const updated = await applyPayment(orderId, entity);
  res.json(view(updated || row));
}));

// Asks Razorpay what really happened to this order and records it. This is the ONLY way (besides the signed
// webhook and signature-verified /verify) a payment's status changes: nothing here trusts the browser.
// Returns { row, checked } where checked=false means Razorpay could not be reached.
async function syncOrder(row) {
  const rz = razorpay();
  if (!rz || !['created', 'pending', 'failed'].includes(row.status)) return { row, checked: Boolean(rz) };
  try {
    const list = await rz.orders.fetchPayments(row.razorpay_order_id);
    const items = (list && list.items) || [];
    const best = items.find((p) => p.status === 'captured') || items.find((p) => p.status === 'authorized') || items[items.length - 1];
    return { row: best ? (await applyPayment(row.razorpay_order_id, best)) || row : row, checked: true };
  } catch (e) {
    console.error('Razorpay status sync failed:', e && e.statusCode);
    return { row, checked: false };
  }
}

// 3) Checkout says a payment attempt failed. The browser's claim is NOT trusted: we ask Razorpay, and only a failed
//    payment that Razorpay itself reports flips the record to "failed" (the signed webhook does the same).
router.post('/failure', limiter(60), asyncRoute(async (req, res) => {
  const row = await getRow((req.body || {}).razorpay_order_id);
  if (!row) return res.status(404).json({ error: 'Payment not found.' });
  res.json(view((await syncOrder(row)).row));
}));

// 4) The user closed the checkout window. Marked "cancelled" only if Razorpay confirms no payment was attempted/made.
router.post('/cancel', limiter(60), asyncRoute(async (req, res) => {
  const row = await getRow((req.body || {}).razorpay_order_id);
  if (!row) return res.status(404).json({ error: 'Payment not found.' });
  const synced = await syncOrder(row);
  if (synced.checked && synced.row.status === 'created') {
    await pool.query("UPDATE payments SET status = 'cancelled' WHERE id = ? AND status = 'created'", [row.id]);
  }
  res.json(view((await getRow(row.razorpay_order_id)) || synced.row));
}));

// 5) "Check payment status": re-asks Razorpay when we are not yet sure.
router.get('/status/:orderId', limiter(120), asyncRoute(async (req, res) => {
  const row = await getRow(req.params.orderId);
  if (!row) return res.status(404).json({ error: 'Payment not found.' });
  res.json(view((await syncOrder(row)).row));
}));

// ---- Client payment references (signed-in clients paying an admin-created, fixed-amount reference) --------------
// The amount is read from the reference row; nothing the browser sends can change it.
const clientOnly = [requireAuth(), (req, res, next) => (req.user.role === 'user' ? next() : res.status(403).json({ error: 'Only clients can pay a payment reference.' }))];

// Loads a reference that belongs to this client (anything else is a generic 404, so codes cannot be probed).
async function ownReference(code, userId, conn = pool, lock = false) {
  if (!REF_RE.test(code)) return null;
  const [[ref]] = await conn.query(
    `SELECT r.*, ${effectiveStatusSql('r')} AS effective, f.name AS filing_name, f.type AS filing_type, f.filing_year, f.status AS filing_status
       FROM payment_references r JOIN filings f ON f.id = r.filing_id
      WHERE r.code = ? AND r.user_id = ? ${lock ? 'FOR UPDATE' : ''}`,
    [code, userId]
  );
  return ref || null;
}
const NOT_FOUND_REF = { error: 'Payment reference not found.' };
const payerOf = (u) => ({ name: `${u.first_name} ${u.last_name || ''}`.trim().slice(0, 100), email: u.email, phone: String(u.phone || '').slice(0, 24) });
const amountTampered = (b, paise) => b.amount !== undefined && b.amount !== null && String(b.amount).trim() !== '' && parsePaise(b.amount) !== paise;

// 1) Create the Razorpay order for exactly the saved amount.
router.post('/my/:code/order', ...clientOnly, limiter(30), asyncRoute(async (req, res) => {
  const code = normRef(req.params.code);
  const b = req.body || {};
  if (b.method !== undefined && String(b.method) !== 'card') return res.status(400).json({ error: 'Only card payments use online checkout.' });
  const ref = await ownReference(code, req.user.id);
  if (!ref) return res.status(404).json(NOT_FOUND_REF);
  const blocked = unpayableReason(ref.effective);
  if (blocked) return res.status(blocked.code).json({ error: blocked.error });
  if (ref.filing_status !== 'completed') return res.status(400).json({ error: 'This filing is not completed.' });
  // A browser-supplied amount is never used; if one is sent and differs, treat it as tampering.
  if (amountTampered(b, ref.amount_paise)) return res.status(400).json({ error: 'The amount does not match this payment reference.' });
  if (ref.amount_paise < MIN_PAISE || ref.amount_paise > MAX_PAISE) return res.status(400).json({ error: 'This payment amount is not supported online. Please contact us.' });
  const rz = razorpay();
  if (!rz) return notConfigured(res);

  let order;
  try {
    order = await rz.orders.create({
      amount: ref.amount_paise,
      currency: CURRENCY,
      receipt: `vt_${Date.now()}`,
      notes: { reference: ref.code, filing_id: String(ref.filing_id), client_id: String(req.user.id) },
    });
  } catch (e) {
    console.error('Razorpay order creation failed:', e && e.statusCode, e && e.error && e.error.description);
    return res.status(502).json({ error: 'Could not start the payment. Please try again in a moment.' });
  }

  const payer = payerOf(req.user);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const locked = await ownReference(code, req.user.id, conn, true); // re-check under lock: it may have been paid meanwhile
    const again = locked && unpayableReason(locked.effective);
    if (!locked || again) { await conn.rollback(); return res.status(again ? again.code : 404).json(again ? { error: again.error } : NOT_FOUND_REF); }
    await conn.query(
      `INSERT INTO payments (plan, amount_paise, currency, payer_name, payer_email, payer_phone, razorpay_order_id, method, status, reference_code, user_id, filing_id, source)
       VALUES ('reference',?,?,?,?,?,?, 'card', 'created', ?,?,?, 'razorpay')`,
      [ref.amount_paise, CURRENCY, payer.name, payer.email, payer.phone, order.id, ref.code, req.user.id, ref.filing_id]
    );
    await conn.query('UPDATE payment_references SET razorpay_order_id = ? WHERE code = ?', [order.id, ref.code]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }

  const digits = payer.phone.replace(/\D/g, '');
  res.status(201).json({
    orderId: order.id,
    amount: ref.amount_paise,
    currency: CURRENCY,
    keyId: config.razorpay.keyId,
    description: `${ref.filing_type || ref.filing_name} ${ref.filing_year} - ${ref.code}`,
    prefill: { name: payer.name, email: payer.email, ...(/^\d{10,15}$/.test(digits) ? { contact: `+${digits}` } : {}) },
  });
}));

// 2) Manual QR / UPI payment: the client reports a transaction reference. This does NOT mark anything paid: the
//    payment stays "pending" (submitted) until an administrator checks the bank/UPI statement and verifies it.
router.post('/my/:code/manual', ...clientOnly, limiter(20), asyncRoute(async (req, res) => {
  const code = normRef(req.params.code);
  const b = req.body || {};
  const method = String(b.method || '');
  if (!['qr', 'upi'].includes(method)) return res.status(400).json({ error: 'Choose QR Code or UPI.' });
  const utr = String(b.utr || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{8,30}$/.test(utr)) return res.status(400).json({ error: 'Enter the transaction / UTR reference from your payment app (8-30 letters or digits).' });
  const payer = payerOf(req.user);
  const conn = await pool.getConnection();
  let paymentId;
  try {
    await conn.beginTransaction();
    const ref = await ownReference(code, req.user.id, conn, true);
    if (!ref) { await conn.rollback(); return res.status(404).json(NOT_FOUND_REF); }
    if (amountTampered(b, ref.amount_paise)) { await conn.rollback(); return res.status(400).json({ error: 'The amount does not match this payment reference.' }); }
    const blocked = unpayableReason(ref.effective);
    if (blocked) { await conn.rollback(); return res.status(blocked.code).json({ error: blocked.error }); }
    if (ref.filing_status !== 'completed') { await conn.rollback(); return res.status(400).json({ error: 'This filing is not completed.' }); }
    const [ins] = await conn.query(
      `INSERT INTO payments (plan, amount_paise, currency, payer_name, payer_email, payer_phone, razorpay_order_id, method, status, reference_code, user_id, filing_id, source, utr)
       VALUES ('reference',?,?,?,?,?, NULL, ?, 'pending', ?,?,?, 'manual', ?)`,
      [ref.amount_paise, CURRENCY, payer.name, payer.email, payer.phone, method, ref.code, req.user.id, ref.filing_id, utr]
    );
    paymentId = ins.insertId;
    await conn.query("UPDATE payment_references SET status = 'pending' WHERE code = ?", [ref.code]);
    await audit(req.user.id, 'payment.manual_submitted', 'payment', paymentId, `${ref.code} ${method}`, req.ip, conn);
    await notify.notifyManualSubmitted(paymentId, conn);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That transaction reference has already been submitted.' });
    throw e;
  } finally { conn.release(); }
  res.status(201).json({ ok: true, status: 'pending', message: 'Thank you. Your payment has been submitted and is awaiting verification by Vision-Tax. It will be marked paid only after it is confirmed.' });
}));

// Webhook: mounted in index.js with the RAW body (the signature is computed over the exact bytes Razorpay sent).
async function webhook(req, res) {
  const secret = config.razorpay.webhookSecret;
  if (!secret) return res.status(503).json({ error: 'Webhook not configured.' });
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!safeEqual(hmac(secret, raw), req.get('x-razorpay-signature'))) return res.status(400).json({ error: 'Invalid signature.' });

  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Malformed body.' }); }
  const pay = event.payload && event.payload.payment && event.payload.payment.entity;
  const eventId = String(req.get('x-razorpay-event-id') || `${event.event}:${(pay && pay.id) || ''}:${event.created_at || ''}`).slice(0, 100);

  const [[seen]] = await pool.query('SELECT 1 AS s FROM payment_webhook_events WHERE event_id = ?', [eventId]);
  if (seen) return res.json({ ok: true, duplicate: true });

  if (['payment.captured', 'payment.authorized', 'payment.failed', 'order.paid'].includes(event.event) && pay && pay.order_id) {
    await applyPayment(pay.order_id, pay);
  } else if (event.event === 'refund.processed') {
    const refund = event.payload && event.payload.refund && event.payload.refund.entity;
    if (refund && refund.payment_id) {
      // Only a full refund flips the record; partial refunds leave the payment marked successful.
      await pool.query("UPDATE payments SET status = 'refunded' WHERE razorpay_payment_id = ? AND status = 'successful' AND amount_paise <= ?", [refund.payment_id, Number(refund.amount) || 0]);
    }
  }
  await pool.query('INSERT IGNORE INTO payment_webhook_events (event_id, event_type) VALUES (?,?)', [eventId, String(event.event || '').slice(0, 60)]);
  res.json({ ok: true });
}

module.exports = { router, webhook: asyncRoute(webhook) };
