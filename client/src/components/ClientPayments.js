'use client';
import { useCallback, useEffect, useState } from 'react';
import DataTable from './DataTable';
import Modal from './Modal';
import { useToast } from './Shell';
import { api, fmtDateTime } from '@/lib/api';

export const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
export const money = (paise) => INR.format(paise / 100);
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const METHOD = { card: 'Card', upi: 'UPI', qr: 'QR Code', netbanking: 'Netbanking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay Later' };
export const methodName = (m) => METHOD[String(m || '').toLowerCase()] || m || '—';

const LABEL = { open: 'Open', pending: 'Pending', paid: 'Paid', expired: 'Expired', cancelled: 'Cancelled', successful: 'Successful', failed: 'Failed', refunded: 'Refunded', created: 'Not completed' };
export const PayBadge = ({ status }) => <span className={`badge pay-${status}`}>{LABEL[status] || status}</span>;

// ---- Razorpay Checkout loader (public script from Razorpay; the secret key never reaches the browser) ----------
let scriptPromise = null;
function loadCheckout() {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = () => { scriptPromise = null; reject(new Error('Could not load the secure checkout. Check your connection and try again.')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

// ---- Pay dialog: fixed amount, method chosen here, amount is never editable -------------------------------------
function PayDialog({ reference: ref, onClose, onChanged }) {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [method, setMethod] = useState('card');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [utr, setUtr] = useState('');
  const [result, setResult] = useState(null); // { kind: 'success'|'pending'|'failed'|'cancelled'|'submitted', message }
  const [orderId, setOrderId] = useState(null);

  useEffect(() => { api('/public/payment-info').then(setInfo).catch(() => setInfo({ qr: null, upi: null })); }, []);

  const amountText = money(ref.amountPaise);
  const done = Boolean(result && (result.kind === 'success' || result.kind === 'submitted' || result.kind === 'pending'));
  const finish = () => { onChanged(); onClose(); };

  async function payOnline() {
    setBusy(true); setError(''); setResult(null);
    try {
      await loadCheckout();
      const order = await api(`/payments/my/${encodeURIComponent(ref.code)}/order`, { method: 'POST', body: { method: 'card' } });
      setOrderId(order.orderId);
      let reported = false;
      const settle = async (path, body) => {
        try { return await api(path, { method: 'POST', body }); } catch (e) { return { status: 'pending', message: e.message }; }
      };
      const rz = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'Vision-Tax',
        description: order.description,
        prefill: order.prefill,
        theme: { color: '#7c3aed' },
        // Success is only a claim from the browser: the server re-checks the signature AND asks Razorpay.
        handler: async (resp) => {
          reported = true; setBusy(true);
          const v = await settle('/payments/verify', resp);
          setBusy(false);
          setResult({ kind: v.status === 'successful' ? 'success' : v.status === 'failed' ? 'failed' : 'pending', message: v.message, paymentId: v.reference });
          onChanged();
        },
        modal: {
          ondismiss: async () => {
            if (reported) return;
            const v = await settle('/payments/cancel', { razorpay_order_id: order.orderId });
            setBusy(false);
            if (v.status === 'successful') { setResult({ kind: 'success', message: v.message, paymentId: v.reference }); onChanged(); }
            else if (v.status === 'pending') setResult({ kind: 'pending', message: v.message });
            else setResult({ kind: 'cancelled', message: 'Payment cancelled. No payment was taken.' });
          },
        },
      });
      // The failure message shown comes from OUR server (which asks Razorpay), not from what the browser says.
      rz.on('payment.failed', async () => {
        const v = await settle('/payments/failure', { razorpay_order_id: order.orderId });
        if (v.status === 'failed') setResult({ kind: 'failed', message: v.message, reason: v.reason });
      });
      rz.open();
      setBusy(false);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  async function checkStatus() {
    if (!orderId) return;
    setBusy(true);
    try {
      const v = await api(`/payments/status/${orderId}`);
      setResult({ kind: v.status === 'successful' ? 'success' : v.status === 'failed' ? 'failed' : v.status === 'pending' ? 'pending' : 'cancelled', message: v.message, paymentId: v.reference });
      if (v.status === 'successful') onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function submitManual() {
    setBusy(true); setError('');
    try {
      const r = await api(`/payments/my/${encodeURIComponent(ref.code)}/manual`, { method: 'POST', body: { method, utr: utr.trim() } });
      setResult({ kind: 'submitted', message: r.message });
      toast('Payment submitted for verification.');
      onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const upiLink = info && info.upi ? `upi://pay?pa=${encodeURIComponent(info.upi)}&am=${(ref.amountPaise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(ref.code)}` : null;
  const ManualForm = (
    <div className="pay-manual">
      <p className="muted" style={{ margin: '12px 0 8px' }}>After paying <b>exactly {amountText}</b>, enter the transaction / UTR reference from your payment app. Your filing payment is marked <b>paid only after Vision-Tax verifies</b> it in the bank statement.</p>
      <div className="field" style={{ marginBottom: 10 }}>
        <label htmlFor="pay-utr">Transaction / UTR reference</label>
        <input id="pay-utr" className="input" value={utr} onChange={(e) => setUtr(e.target.value)} maxLength={30} placeholder="e.g. 412345678901" autoComplete="off" />
      </div>
      <button className="btn sm" onClick={submitManual} disabled={busy || utr.trim().length < 8}>{busy ? 'Submitting…' : 'I have paid - submit for verification'}</button>
    </div>
  );

  return (
    <Modal title="Pay for your filing" onClose={done ? finish : onClose} busy={busy}>
      <dl className="pay-summary">
        <div><dt>Filing</dt><dd>{ref.filingType || ref.filingName} · {ref.filingYear}</dd></div>
        <div><dt>Reference</dt><dd><strong>{ref.code}</strong></dd></div>
        <div><dt>Amount</dt><dd className="pay-amount" aria-label="Fixed payment amount">{amountText}</dd></div>
        <div><dt>Expires</dt><dd>{fmtDate(ref.expiresAt)}</dd></div>
        {ref.note && <div className="wide"><dt>Note</dt><dd>{ref.note}</dd></div>}
      </dl>
      <p className="muted" style={{ fontSize: '.8rem', margin: '4px 0 12px' }}><i className="fa-solid fa-lock" /> The amount is fixed by Vision-Tax and cannot be changed.</p>

      {result ? (
        <div className={`pay-result ${result.kind}`} role="status">
          <i className={`fa-solid ${result.kind === 'success' ? 'fa-circle-check' : result.kind === 'failed' ? 'fa-circle-xmark' : result.kind === 'cancelled' ? 'fa-ban' : 'fa-hourglass-half'}`} />
          <div>
            <strong>{{ success: 'Payment successful', failed: 'Payment failed', cancelled: 'Payment cancelled', pending: 'Payment being verified', submitted: 'Submitted for verification' }[result.kind]}</strong>
            <p>{result.message}</p>
            {result.reason && <p>Reason: {result.reason}</p>}
            {result.paymentId && <p>Payment ID: {result.paymentId}</p>}
          </div>
        </div>
      ) : (
        <>
          <div className="pay-methods" role="tablist" aria-label="Payment method">
            {[['qr', 'QR Code', 'fa-qrcode'], ['upi', 'UPI', 'fa-mobile-screen'], ['card', 'Debit / Credit Card', 'fa-credit-card'], ['zelle', 'Zelle', 'fa-building-columns'], ['paypal', 'PayPal', 'fa-brands fa-paypal']].map(([k, label, icon]) => (
              <button key={k} role="tab" aria-selected={method === k} className={method === k ? 'on' : ''} onClick={() => { setMethod(k); setError(''); }} disabled={busy}>
                <i className={`fa-solid ${icon}`} />{label}
              </button>
            ))}
          </div>

          {method === 'card' && (
            <div style={{ marginTop: 14 }}>
              <p className="muted" style={{ margin: '0 0 12px' }}>Secure online payment through Razorpay (INR, test mode on localhost).</p>
              <button className="btn" onClick={payOnline} disabled={busy}>{busy ? 'Please wait…' : `Pay ${amountText}`}</button>
            </div>
          )}

          {method === 'qr' && (
            <div style={{ marginTop: 14 }}>
              {!info && <p className="muted"><i className="fa-solid fa-spinner fa-spin" /> Loading…</p>}
              {info && info.qr && <div className="pay-qr"><img src={info.qr.url} alt="Payment QR code" /><p>Scan and pay exactly <b>{amountText}</b></p></div>}
              {info && !info.qr && <p className="muted"><i className="fa-solid fa-qrcode" /> The QR code is not available right now. Please use another method or contact us.</p>}
              {info && info.upi && <p className="muted" style={{ margin: '4px 0' }}>UPI ID: <b>{info.upi}</b></p>}
              {info && info.qr && ManualForm}
            </div>
          )}

          {method === 'upi' && (
            <div style={{ marginTop: 14 }}>
              {!info && <p className="muted"><i className="fa-solid fa-spinner fa-spin" /> Loading…</p>}
              {info && info.upi && (
                <>
                  <p style={{ margin: '0 0 6px' }}>Pay <b>{amountText}</b> to UPI ID</p>
                  <p className="pay-upi">{info.upi}</p>
                  <a className="btn outline sm" href={upiLink}><i className="fa-solid fa-mobile-screen" />Open UPI app ({amountText})</a>
                  {ManualForm}
                </>
              )}
              {info && !info.upi && <p className="muted">A UPI ID is not available right now. Please use another method or contact us.</p>}
            </div>
          )}

          {(method === 'zelle' || method === 'paypal') && (
            <p className="muted" style={{ marginTop: 14 }}><i className="fa-solid fa-circle-info" /> {method === 'zelle' ? 'Zelle' : 'PayPal'} is a manual payment option and is not available for online checkout. Please <a href="/contact.html">contact us</a> for payment instructions. Nothing is marked as paid until we confirm it.</p>
          )}
        </>
      )}

      {error && <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{error}</p>}
      <div className="modal-actions">
        {result && result.kind === 'pending' && orderId && <button className="btn outline sm" onClick={checkStatus} disabled={busy}>Check payment status</button>}
        {result && (result.kind === 'failed' || result.kind === 'cancelled') && <button className="btn sm" onClick={() => { setResult(null); setError(''); }}>Try again</button>}
        <button className="btn outline sm" onClick={done ? finish : onClose} disabled={busy}>{done ? 'Done' : 'Close'}</button>
      </div>
    </Modal>
  );
}

// ---- The client's payment references, grouped under their Completed filing ----------------------------------------
export function ReferenceCards({ refreshKey = 0, onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(null);
  const load = useCallback(() => api('/user/payment-references').then((d) => setRows(d.rows)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (error) return null; // payments not set up yet: the rest of the page keeps working
  if (!rows || rows.length === 0) return null;
  const groups = new Map();
  for (const r of rows) { if (!groups.has(r.filingId)) groups.set(r.filingId, { f: r, refs: [] }); groups.get(r.filingId).refs.push(r); }

  return (
    <section className="pay-section" aria-label="Payments for your completed filings">
      <h2 className="panel-title"><i className="fa-solid fa-credit-card" /> Payments for your completed filings</h2>
      {[...groups.values()].map(({ f, refs }) => (
        <div className="card pay-filing" key={f.filingId}>
          <div className="pay-filing-head">
            <strong>{f.filingType || f.filingName}</strong>
            <span className="chip">Filing year {f.filingYear}</span>
            <span className="badge completed">Completed</span>
          </div>
          {refs.map((r) => (
            <div className="pay-ref" key={r.code}>
              <div className="pay-ref-main">
                <div><span className="pay-ref-code">{r.code}</span> <PayBadge status={r.status} /></div>
                <div className="pay-ref-meta">
                  <span>Created {fmtDate(r.createdAt)}</span>
                  <span>{r.status === 'paid' ? `Paid ${fmtDate(r.paidAt)}${r.paidMethod ? ` · ${methodName(r.paidMethod)}` : ''}` : `Expires ${fmtDate(r.expiresAt)}`}</span>
                </div>
                {r.note && <div className="pay-ref-note">{r.note}</div>}
                {r.awaitingVerification && <div className="pay-ref-note"><i className="fa-solid fa-hourglass-half" /> Your payment was submitted and is awaiting verification.</div>}
              </div>
              <div className="pay-ref-side">
                <div className="pay-amount">{money(r.amountPaise)}</div>
                {r.status === 'open' && <button className="btn sm" onClick={() => setPaying(r)}><i className="fa-solid fa-lock" />Pay Now</button>}
              </div>
            </div>
          ))}
        </div>
      ))}
      {paying && <PayDialog reference={paying} onClose={() => setPaying(null)} onChanged={() => { load(); onChanged && onChanged(); }} />}
    </section>
  );
}

// ---- Client payment history (own payments only) -----------------------------------------------------------------------
// Every payment record of the signed-in client: pending, successful, failed, cancelled, refunded, plus requested references
// that have not been paid yet (shown as Pending / Expired / Cancelled). One compact row per record.
export function PaymentHistory({ refreshKey = 0 }) {
  const [paying, setPaying] = useState(null);
  const [bump, setBump] = useState(0);
  const columns = [
    { label: 'Filing Type', sort: 'type', render: (r) => (r.filingType ? <span className="chip">{r.filingType}</span> : '—') },
    { label: 'Filing Year', sort: 'year', render: (r) => r.filingYear || '—' },
    { label: 'Payment ID / Transaction ID', sort: 'code', render: (r) => <span className="txn" title={r.txn}>{r.txn || '—'}</span> },
    { label: 'Amount', sort: 'amount', render: (r) => <span className="nowrap">{money(r.amountPaise)}</span> },
    { label: 'Status', sort: 'status', render: (r) => <PayBadge status={r.status} /> },
    { label: 'Payment Date', sort: 'date', render: (r) => <span className="nowrap" title={r.failureReason || ''}>{r.date ? fmtDateTime(r.date) : '—'}</span> },
    { label: 'Action', render: (r) => (r.payable ? <button className="btn sm" onClick={() => setPaying({ code: r.reference, amountPaise: r.amountPaise, expiresAt: r.expiresAt, note: r.note, filingType: r.filingType, filingYear: r.filingYear, filingName: r.filingName })}><i className="fa-solid fa-lock" />Pay Now</button> : <span className="muted">—</span>) },
  ];
  return (
    <>
      <DataTable endpoint="/user/payments" columns={columns} defaultSort="date" emptyIcon="fa-credit-card" emptyText="You have no payments yet." refreshKey={refreshKey + bump} />
      {paying && <PayDialog reference={paying} onClose={() => setPaying(null)} onChanged={() => setBump((k) => k + 1)} />}
    </>
  );
}
