'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import PageHeader from './PageHeader';
import DataTable from './DataTable';
import { FilingName } from './FilingDetails';
import Modal from './Modal';
import { useToast } from './Shell';
import { api, fmtDateTime, fmtSize } from '@/lib/api';

const QR_EXT = ['png', 'jpg', 'jpeg', 'webp'];
const QR_MAX_MB = 2;

function useInfo() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api('/admin/payment-settings').then(setInfo).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  return { info, setInfo, error, load };
}

const Loading = () => <div className="loading"><i className="fa-solid fa-spinner fa-spin" aria-label="Loading" /></div>;

// ---- QR Code Management -------------------------------------------------------------------------
export function QrManager() {
  const toast = useToast();
  const { info, setInfo, error } = useInfo();
  const input = useRef(null);
  const [picked, setPicked] = useState(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  function onPick(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!QR_EXT.includes(ext)) return setProblem(`Choose an image file (${QR_EXT.join(', ').toUpperCase()}).`);
    if (f.size === 0) return setProblem('That file is empty.');
    if (f.size > QR_MAX_MB * 1024 * 1024) return setProblem(`"${f.name}" is ${(f.size / 1024 / 1024).toFixed(1)} MB. The maximum is ${QR_MAX_MB} MB.`);
    setProblem(''); setPicked(f);
  }

  async function save() {
    setBusy(true); setProblem('');
    const body = new FormData();
    body.append('files', picked);
    try {
      const r = await api('/admin/qr', { method: 'POST', body });
      setInfo({ qr: r.qr, upi: r.upi });
      toast(r.message);
      setPicked(null);
    } catch (e) { setProblem(e.message); } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try {
      const r = await api('/admin/qr', { method: 'DELETE' });
      setInfo({ qr: r.qr, upi: r.upi });
      toast(r.message);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); setConfirmRemove(false); }
  }

  if (error) return <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{error}</p>;
  if (!info) return <Loading />;
  const has = Boolean(info.qr);

  return (
    <>
      <PageHeader title="QR Code Management" subtitle="The payment QR code shown on the public homepage. Changes appear on the homepage immediately." />
      <div className="card" style={{ padding: 28, maxWidth: 560 }}>
        <h2 className="panel-title">Active QR code</h2>
        {has ? (
          <img src={info.qr.url} alt="Active payment QR code" style={{ width: 200, height: 200, objectFit: 'contain', border: '1px solid var(--input-border)', borderRadius: 10, background: '#fff', padding: 8 }} />
        ) : (
          <p className="muted"><i className="fa-solid fa-qrcode" /> No QR code is configured. The homepage shows &ldquo;QR code is not available right now.&rdquo;</p>
        )}

        <input ref={input} type="file" hidden accept={QR_EXT.map((e) => `.${e}`).join(',')} onChange={onPick} />
        {picked && <div className="file-pick" style={{ marginTop: 16 }}><span>{picked.name}<small>{fmtSize(picked.size)}</small></span></div>}
        {problem && <p role="alert" className="alert" style={{ marginTop: 14 }}><i className="fa-solid fa-circle-exclamation" />{problem}</p>}

        <div className="inline-actions" style={{ marginTop: 16 }}>
          <button className="btn outline sm" onClick={() => input.current.click()} disabled={busy}>
            <i className="fa-solid fa-folder-open" />{picked ? 'Choose another' : has ? 'Replace QR Code' : 'Upload QR Code'}
          </button>
          {picked && <button className="btn sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : has ? 'Save replacement' : 'Save QR code'}</button>}
          {has && !picked && <button className="btn outline sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setConfirmRemove(true)} disabled={busy}><i className="fa-solid fa-trash" />Remove QR Code</button>}
        </div>
        <p className="muted" style={{ marginTop: 14, fontSize: '.82rem' }}>{QR_EXT.join(', ').toUpperCase()} · up to {QR_MAX_MB} MB.</p>
      </div>
      {confirmRemove && (
        <Modal title="Remove QR code?" onClose={() => setConfirmRemove(false)} busy={busy}>
          <p>The QR code will be removed from the homepage immediately. Visitors will see &ldquo;QR code is not available right now.&rdquo;</p>
          <div className="modal-actions">
            <button className="btn outline sm" onClick={() => setConfirmRemove(false)} disabled={busy}>Cancel</button>
            <button className="btn sm" style={{ background: 'var(--danger)' }} onClick={remove} disabled={busy}>{busy ? 'Removing…' : 'Remove'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---- Payment References: fixed-amount requests tied to one client + one Completed filing ----------------------
const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const METHODS = { card: 'Card', upi: 'UPI', qr: 'QR Code', netbanking: 'Netbanking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay Later' };
const methodName = (m) => METHODS[String(m || '').toLowerCase()] || m || '—';
const STATUS_LABEL = { open: 'Open', pending: 'Pending', paid: 'Paid', expired: 'Expired', cancelled: 'Cancelled', successful: 'Successful', failed: 'Failed', refunded: 'Refunded', created: 'Not completed' };
const PayBadge = ({ status }) => <span className={`badge pay-${status}`}>{STATUS_LABEL[status] || status}</span>;

// Searchable client picker: type to search by name or email, pick from the list.
function ClientPicker({ value, onChange, disabled }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState('idle');
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const ctl = new AbortController();
    setState('loading');
    const t = setTimeout(() => {
      api(`/admin/clients?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((d) => { setRows(d.rows); setState('ready'); }).catch((e) => { if (e.name !== 'AbortError') setState('error'); });
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, open]);

  useEffect(() => {
    const close = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (value) {
    return (
      <div className="client-chosen">
        <span className="avatar sm" aria-hidden>{value.name.slice(0, 1).toUpperCase()}</span>
        <span><strong>{value.name}</strong><small>{value.email}</small></span>
        <button type="button" className="link-btn plain" onClick={() => { onChange(null); setQ(''); }} disabled={disabled}>Change</button>
      </div>
    );
  }
  return (
    <div className="combo" ref={wrap}>
      <input className="input" role="combobox" aria-expanded={open} aria-controls="client-list" value={q} placeholder="Search client by name or email…" autoComplete="off"
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} disabled={disabled} />
      {open && (
        <ul className="combo-list" id="client-list" role="listbox">
          {state === 'loading' && <li className="combo-note">Searching…</li>}
          {state === 'error' && <li className="combo-note">Could not load clients.</li>}
          {state === 'ready' && rows.length === 0 && <li className="combo-note">No matching clients.</li>}
          {rows.map((c) => (
            <li key={c.id} role="option" aria-selected="false" onMouseDown={(e) => { e.preventDefault(); onChange(c); setOpen(false); }}>
              <strong>{c.name}</strong><small>{c.email}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReferenceManager() {
  const toast = useToast();
  const [client, setClient] = useState(null);
  const [filings, setFilings] = useState(null); // null = not loaded
  const [filingId, setFilingId] = useState('');
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('30');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState('');
  const [cancelling, setCancelling] = useState(null);
  const [created, setCreated] = useState(null);

  // Choosing (or changing) the client always clears the filing, then loads that client's Completed filings.
  useEffect(() => {
    setFilingId(''); setFilings(null);
    if (!client) return undefined;
    let alive = true;
    api(`/admin/clients/${client.id}/filings`).then((d) => { if (alive) setFilings(d.rows); }).catch((e) => { if (alive) { setFilings([]); setProblem(e.message); } });
    return () => { alive = false; };
  }, [client]);

  const expiry = Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 90 ? new Date(Date.now() + Number(days) * 86400000) : null;

  async function create(e) {
    e.preventDefault();
    if (!client) return setProblem('Select a client.');
    if (!filingId) return setProblem('Select one of the client\'s completed filings.');
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(amount.trim()) || Number(amount) < 1) return setProblem('Enter a valid amount in ₹ (minimum ₹1, up to 2 decimals).');
    if (Number(amount) > 500000) return setProblem('The amount must not exceed ₹5,00,000.');
    if (!/^\d+$/.test(days.trim()) || Number(days) < 1 || Number(days) > 90) return setProblem('Validity must be 1 to 90 days.');
    setBusy(true); setProblem('');
    try {
      const r = await api('/admin/payment-references', { method: 'POST', body: { userId: client.id, filingId: Number(filingId), amount: amount.trim(), days: Number(days), note } });
      toast(`Reference ${r.code} created for ${client.name}.`);
      setCreated({ code: r.code, client: client.name });
      setAmount(''); setNote(''); setFilingId('');
      setRefresh((k) => k + 1);
      api(`/admin/clients/${client.id}/filings`).then((d) => setFilings(d.rows)).catch(() => {});
    } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  }

  async function cancel() {
    setBusy(true);
    try { await api(`/admin/payment-references/${encodeURIComponent(cancelling.code)}`, { method: 'DELETE' }); toast('Reference cancelled.'); setRefresh((k) => k + 1); } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); setCancelling(null); }
  }

  const columns = [
    { label: 'Reference', sort: 'code', render: (r) => <strong>{r.code}</strong> },
    { label: 'Client', sort: 'client', render: (r) => (r.clientName ? <div className="cell-user"><div><strong>{r.filingId ? <FilingName id={r.filingId} name={r.clientName} role="admin" /> : r.clientName}</strong></div></div> : <span className="muted">Not linked (legacy)</span>) },
    { label: 'Filing', sort: 'filing', render: (r) => (r.filingType ? `${r.filingType} · ${r.filingYear} · #${r.filingId}` : '—') },
    { label: 'Amount', sort: 'amount', render: (r) => INR.format(r.amountPaise / 100) },
    { label: 'Status', sort: 'status', render: (r) => <PayBadge status={r.status} /> },
    { label: 'Created', sort: 'created', render: (r) => fmtDate(r.createdAt) },
    { label: 'Expires', sort: 'expires', render: (r) => fmtDate(r.expiresAt) },
    { label: 'Paid', render: (r) => (r.status === 'paid' ? `${fmtDate(r.paidAt)} · ${methodName(r.paidMethod)}` : '—') },
    { label: 'Note', render: (r) => r.note || '—' },
    { label: '', render: (r) => r.status === 'open' && <button className="link-btn" onClick={() => setCancelling(r)}>Cancel</button> },
  ];

  const noFilings = client && filings && filings.length === 0;
  return (
    <>
      <PageHeader title="Payment References" subtitle="Request a fixed payment from a client for one of their Completed filings. The amount is locked on the server; the client pays it from their own dashboard." />
      <form className="card" onSubmit={create} noValidate style={{ padding: 28, maxWidth: 680, marginBottom: 20 }}>
        <h2 className="panel-title">New payment reference</h2>
        <div className="field"><label>Select client</label><ClientPicker value={client} onChange={(c) => { setClient(c); setProblem(''); setCreated(null); }} disabled={busy} /></div>
        <div className="field">
          <label htmlFor="ref-filing">Select client filing <span className="muted">(Completed only)</span></label>
          <select id="ref-filing" className="select" value={filingId} onChange={(e) => setFilingId(e.target.value)} disabled={!client || !filings || busy}>
            <option value="">{!client ? 'Select a client first' : !filings ? 'Loading filings…' : noFilings ? 'No completed filings' : 'Select a completed filing'}</option>
            {(filings || []).map((f) => (
              <option key={f.id} value={f.id} disabled={f.activeRefs > 0}>
                {f.type} · FY {f.year} · #{f.id} · {f.name}{f.activeRefs > 0 ? ' (active reference exists)' : ''}
              </option>
            ))}
          </select>
          {noFilings && <p className="muted" style={{ marginTop: 6, fontSize: '.82rem' }}>This client has no Completed filings, so a payment cannot be requested yet.</p>}
        </div>
        <div className="row-2">
          <div className="field"><label htmlFor="ref-amount">Payment amount (₹ INR)</label><input id="ref-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 2500" /></div>
          <div className="field"><label htmlFor="ref-days">Valid for (days)</label><input id="ref-days" className="input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            <p className="muted" style={{ marginTop: 6, fontSize: '.8rem' }}>{expiry ? `Expires on ${fmtDate(expiry)}` : 'Enter 1 to 90 days'}</p></div>
        </div>
        <div className="field"><label htmlFor="ref-note">Note (optional)</label><input id="ref-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={190} placeholder="e.g. Tax preparation fee for 1099-B" /></div>
        {problem && <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{problem}</p>}
        {created && <p className="alert ok" role="status"><i className="fa-solid fa-circle-check" /><span>Reference <b>{created.code}</b> created for {created.client}. It now appears in their dashboard.</span></p>}
        <button className="btn sm" disabled={busy}>{busy ? 'Creating…' : 'Create payment reference'}</button>
      </form>

      <div className="table-filter">
        <label>Status
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {['open', 'pending', 'paid', 'expired', 'cancelled'].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
      </div>
      <DataTable endpoint="/admin/payment-references" params={{ status }} columns={columns} defaultSort="created" emptyIcon="fa-file-invoice" emptyText="No payment references yet." refreshKey={refresh} />
      {cancelling && (
        <Modal title="Cancel this reference?" onClose={() => setCancelling(null)} busy={busy}>
          <p><b>{cancelling.code}</b> ({INR.format(cancelling.amountPaise / 100)}{cancelling.clientName ? ` for ${cancelling.clientName}` : ''}) will no longer be payable.</p>
          <div className="modal-actions">
            <button className="btn outline sm" onClick={() => setCancelling(null)} disabled={busy}>Keep it</button>
            <button className="btn sm" style={{ background: 'var(--danger)' }} onClick={cancel} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel reference'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---- Admin Payment History (Razorpay + manual QR/UPI) ----------------------------------------------------------
export function AdminPayments() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [acting, setActing] = useState(null); // { kind: 'verify'|'reject', row }
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function act() {
    setBusy(true); setProblem('');
    try {
      const path = `/admin/payments/${acting.row.id}/${acting.kind}`;
      const r = await api(path, { method: 'POST', body: acting.kind === 'verify' ? { confirm: true } : { note } });
      toast(r.message); setActing(null); setNote(''); setRefresh((k) => k + 1);
    } catch (e) { setProblem(e.message); } finally { setBusy(false); }
  }

  const columns = [
    { label: 'Date', sort: 'date', render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.paidAt || r.createdAt)}</span> },
    { label: 'Client', sort: 'client', render: (r) => <div className="cell-user"><div><strong>{r.clientName ? (r.filingId ? <FilingName id={r.filingId} name={r.clientName} role="admin" /> : r.clientName) : '—'}</strong></div></div> },
    { label: 'Filing', render: (r) => (r.filingType ? `${r.filingType} · ${r.filingYear} · #${r.filingId}` : <span className="muted">{r.plan === 'reference' ? '—' : `Plan: ${r.plan}`}</span>) },
    { label: 'Reference', sort: 'code', render: (r) => (r.reference ? <strong>{r.reference}</strong> : '—') },
    { label: 'Amount', sort: 'amount', render: (r) => INR.format(r.amountPaise / 100) },
    { label: 'Method', sort: 'method', render: (r) => methodName(r.method) },
    { label: 'Status', sort: 'status', render: (r) => <div><PayBadge status={r.status} />{r.source === 'manual' && r.status === 'pending' && <small className="muted" style={{ display: 'block' }}>Awaiting verification</small>}</div> },
    { label: 'Payment ID / Txn ref', render: (r) => <span style={{ wordBreak: 'break-all' }}>{r.razorpayPaymentId || r.utr || '—'}{r.failureReason && r.status === 'failed' ? <small className="muted" style={{ display: 'block' }}>{r.failureReason}</small> : null}</span> },
    {
      label: 'Action',
      render: (r) => (r.source === 'manual' && r.status === 'pending' ? (
        <div className="inline-actions">
          <button className="btn sm" onClick={() => { setProblem(''); setActing({ kind: 'verify', row: r }); }}>Verify</button>
          <button className="btn outline sm" onClick={() => { setProblem(''); setNote(''); setActing({ kind: 'reject', row: r }); }}>Reject</button>
        </div>
      ) : null),
    },
  ];

  return (
    <>
      <PageHeader title="Payment History" subtitle="Every payment linked to its client, filing and payment reference. Manual QR/UPI payments stay Pending until you verify them here." />
      <div className="table-filter">
        <label>Status
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {['successful', 'pending', 'failed', 'cancelled', 'refunded'].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label>Type
          <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All</option>
            <option value="razorpay">Online (Razorpay)</option>
            <option value="manual">Manual (QR / UPI)</option>
          </select>
        </label>
      </div>
      <DataTable endpoint="/admin/payments" params={{ status, source }} columns={columns} defaultSort="date" emptyIcon="fa-money-bill-transfer" emptyText="No payments yet." refreshKey={refresh} />
      {acting && (
        <Modal title={acting.kind === 'verify' ? 'Verify this payment?' : 'Reject this payment?'} onClose={() => setActing(null)} busy={busy}>
          <p>{acting.row.clientName} reports paying <b>{INR.format(acting.row.amountPaise / 100)}</b> by {methodName(acting.row.method)} for reference <b>{acting.row.reference}</b>. Transaction ref: <b>{acting.row.utr}</b>.</p>
          {acting.kind === 'verify'
            ? <p>Only verify after you have seen this exact amount in your bank / UPI statement. The reference will be marked <b>Paid</b> and both dashboards will be notified.</p>
            : <div className="field"><label htmlFor="rej-note">Reason (shown to the client, optional)</label><input id="rej-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} placeholder="e.g. Amount not received" /></div>}
          {problem && <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{problem}</p>}
          <div className="modal-actions">
            <button className="btn outline sm" onClick={() => setActing(null)} disabled={busy}>Cancel</button>
            <button className="btn sm" style={acting.kind === 'reject' ? { background: 'var(--danger)' } : undefined} onClick={act} disabled={busy}>{busy ? 'Saving…' : acting.kind === 'verify' ? 'Yes, payment received' : 'Reject payment'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---- UPI Management -----------------------------------------------------------------------------
const UPI_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}@[a-zA-Z][a-zA-Z0-9]{1,31}$/;

export function UpiManager() {
  const toast = useToast();
  const { info, setInfo, error } = useInfo();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (error) return <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{error}</p>;
  if (!info) return <Loading />;
  const has = Boolean(info.upi);
  const showForm = editing || !has;

  function check(v) {
    const s = v.trim();
    if (!s) return 'UPI ID is required.';
    if (/\s/.test(s)) return 'UPI ID must not contain spaces.';
    if (!s.includes('@')) return 'UPI ID must look like name@bank.';
    if (!UPI_RE.test(s)) return 'Enter a valid UPI ID (letters, numbers, dot, dash or underscore, then @bank), e.g. visiontax@okhdfcbank.';
    return '';
  }

  async function save(e) {
    e.preventDefault();
    const msg = check(value);
    if (msg) return setProblem(msg);
    setBusy(true); setProblem('');
    try {
      const r = await api('/admin/upi', { method: 'PUT', body: { upi: value.trim() } });
      setInfo({ qr: r.qr, upi: r.upi });
      toast(r.message);
      setEditing(false);
    } catch (e2) { setProblem(e2.message); } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try {
      const r = await api('/admin/upi', { method: 'DELETE' });
      setInfo({ qr: r.qr, upi: r.upi });
      toast(r.message);
      setEditing(false); setValue('');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); setConfirmRemove(false); }
  }

  return (
    <>
      <PageHeader title="UPI Management" subtitle="The UPI ID shown directly below the QR code on the public homepage." />
      <div className="card" style={{ padding: 28, maxWidth: 560 }}>
        <h2 className="panel-title">Active UPI ID</h2>
        {has && !editing && <p style={{ fontSize: '1.15rem', fontWeight: 700 }}>{info.upi}</p>}
        {!has && !editing && <p className="muted">No UPI ID is configured. The homepage shows &ldquo;UPI ID not available&rdquo;.</p>}

        {showForm && (
          <form onSubmit={save} noValidate>
            <div className="field">
              <label htmlFor="upi">{has ? 'UPI ID' : 'Add UPI ID'}</label>
              <input id="upi" className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="name@bank" maxLength={100} autoComplete="off" />
            </div>
            {problem && <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{problem}</p>}
            <div className="inline-actions">
              <button className="btn sm" disabled={busy}>{busy ? 'Saving…' : has ? 'Save changes' : 'Add UPI ID'}</button>
              {has && <button type="button" className="btn outline sm" onClick={() => { setEditing(false); setProblem(''); }} disabled={busy}>Cancel</button>}
            </div>
            <p className="muted" style={{ marginTop: 12, fontSize: '.82rem' }}>
              Only the format is checked. Please make sure this UPI ID is active and belongs to your business before saving.
            </p>
          </form>
        )}

        {has && !editing && (
          <div className="inline-actions" style={{ marginTop: 14 }}>
            <button className="btn outline sm" onClick={() => { setValue(info.upi); setProblem(''); setEditing(true); }}><i className="fa-solid fa-pen" />Edit UPI ID</button>
            <button className="btn outline sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setConfirmRemove(true)}><i className="fa-solid fa-trash" />Remove UPI ID</button>
          </div>
        )}
      </div>
      {confirmRemove && (
        <Modal title="Remove UPI ID?" onClose={() => setConfirmRemove(false)} busy={busy}>
          <p>The UPI ID <b>{info.upi}</b> will be removed from the homepage immediately.</p>
          <div className="modal-actions">
            <button className="btn outline sm" onClick={() => setConfirmRemove(false)} disabled={busy}>Cancel</button>
            <button className="btn sm" style={{ background: 'var(--danger)' }} onClick={remove} disabled={busy}>{busy ? 'Removing…' : 'Remove'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
