'use client';
import { useState } from 'react';
import DataTable, { FileLinks, UserCell } from './DataTable';
import PageHeader from './PageHeader';
import { api, STATUS_LABEL, fileProblem, fmtSize, ALLOWED_EXT, fmtPhone } from '@/lib/api';
import { useToast } from './Shell';
import Modal from './Modal';
import { PayBadge, money } from './ClientPayments';

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// Choose File and Upload live in separate columns, so they share state through one small controller per row.
function useRowUpload(filingId, kind, onDone) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  const [problem, setProblem] = useState('');
  return {
    file, busy, key, problem,
    pick(e) {
      const f = e.target.files[0] || null;
      const p = f ? fileProblem(f) : '';
      setProblem(p); setFile(p ? null : f);
      if (p) { setKey((k) => k + 1); toast(p, 'error'); }
    },
    async send() {
      if (!file) return toast('Choose a file first.', 'error');
      setBusy(true);
      const body = new FormData();
      body.append('files', file);
      try {
        await api(`/admin/filings/${filingId}/${kind}`, { method: 'POST', body });
        toast(`"${file.name}" uploaded. The filing status has not changed.`);
        setFile(null); setProblem(''); setKey((k) => k + 1);
        onDone();
      } catch (e) { toast(`${e.message} Existing documents were kept.`, 'error'); } finally { setBusy(false); }
    },
  };
}

function ChooseCell({ u }) {
  return (
    <div className="uploader">
      <input key={u.key} type="file" accept={ALLOWED_EXT.map((e) => `.${e}`).join(',')} aria-label="Choose file" onChange={u.pick} disabled={u.busy} />
      {u.file && <small className="muted uploader-name" title={u.file.name}>{u.file.name} · {fmtSize(u.file.size)}</small>}
      {u.problem && <small className="uploader-err">{u.problem}</small>}
    </div>
  );
}

function UploadCell({ u, tone = 'cyan' }) {
  return (
    <button className={`btn sm ${tone}`} disabled={u.busy || !u.file} onClick={u.send}>
      <i className="fa-solid fa-cloud-arrow-up" />{u.busy ? 'Uploading…' : 'Upload'}
    </button>
  );
}

// A filing may only move forward once the admin has uploaded the files it needs. (The server enforces this too.)
function blocker(row, to) {
  const has = (kind) => (row.files || []).some((f) => f.kind === kind);
  if (row.status === 'pending' && to === 'ongoing' && !has('draft')) return 'Upload a document first.';
  if (to === 'drafted' && !has('draft')) return 'A draft document is needed first.';
  if (to === 'completed' && !has('final')) return 'Upload the Upload File first.';
  return '';
}

async function changeStatus(row, to, note) {
  return api(`/admin/filings/${row.id}/status`, { method: 'PATCH', body: { status: to, from: row.status, confirm: true, ...(note ? { note } : {}) } });
}

function ConfirmStatus({ row, to, note, doneMessage, onCancel, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await changeStatus(row, to, note);
      toast(doneMessage || `Status updated to ${STATUS_LABEL[to]}.`);
      onDone();
    } catch (e) {
      toast(`${e.message} The filing was not changed.`, 'error');
      onCancel();
    } finally { setBusy(false); }
  }
  return (
    <Modal title="Confirm status change" onClose={onCancel} busy={busy}>
      <p>Move <b>{row.name}</b> from <b>{STATUS_LABEL[row.status]}</b> to <b>{STATUS_LABEL[to]}</b>?{to === 'completed' && ' Completed is final and cannot be undone.'}</p>
      <div className="modal-actions">
        <button className="btn outline sm" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn sm" onClick={confirm} disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</button>
      </div>
    </Modal>
  );
}

// The three options the admin sees. Internally: ongoing / drafted / completed.
const STATUS_CHOICES = [['ongoing', 'In Progress'], ['drafted', 'Draft'], ['completed', 'Complete']];

function StatusEditor({ row, onDone }) {
  const toast = useToast();
  const [value, setValue] = useState(row.status);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const blocked = blocker(row, value);

  async function save() {
    if (value === 'completed') return setAsking(true); // the one irreversible change gets an explicit confirmation
    setBusy(true);
    try {
      const r = await changeStatus(row, value);
      toast(r.unchanged ? `Saved. The filing stays ${value === 'drafted' ? 'in Draft' : 'In Progress'}.` : `Status updated to ${value === 'drafted' ? 'Draft' : 'In Progress'}.`);
      onDone();
    } catch (e) { toast(`${e.message} The filing was not changed.`, 'error'); onDone(); } finally { setBusy(false); }
  }

  return (
    <div className="status-edit">
      <select className="status-select" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Status" disabled={busy}>
        {STATUS_CHOICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {blocked && <small className="muted">{blocked}</small>}
      {asking && <ConfirmStatus row={row} to="completed" onCancel={() => { setAsking(false); setValue(row.status); }} onDone={() => { setAsking(false); onDone(); }} doneMessage="Filing completed. You can now add a payment reference." />}
      <button className="btn sm" disabled={busy || Boolean(blocked)} title={blocked} onClick={save}>{busy ? 'Saving…' : 'Save Update'}</button>
    </div>
  );
}

function StartButton({ row, onDone }) {
  const [asking, setAsking] = useState(false);
  const blocked = blocker(row, 'ongoing');
  return (
    <>
      <button className="btn sm" disabled={Boolean(blocked)} title={blocked || 'Move this filing to Ongoing'} onClick={() => setAsking(true)}><i className="fa-solid fa-play" />Start Processing</button>
      {blocked && <small className="muted block-note">{blocked}</small>}
      {asking && <ConfirmStatus row={row} to="ongoing" note="Processing started" doneMessage="Filing moved to Ongoing. Your document is now its Draft File." onCancel={() => setAsking(false)} onDone={() => { setAsking(false); onDone(); }} />}
    </>
  );
}

const CompleteBadge = () => <span className="badge pay-paid" title="Completed is a final status"><i className="fa-solid fa-lock" /> Complete</span>;

// ---- Payment references for a Completed filing (reuses the existing /admin/payment-references API) -----------
function ReferenceModal({ row, onClose, onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('30');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const hasActive = (row.refs || []).some((r) => r.status === 'open' || r.status === 'pending');
  const expiry = /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 90 ? new Date(Date.now() + Number(days) * 86400000) : null;

  async function create(e) {
    e.preventDefault();
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(amount.trim()) || Number(amount) < 1) return setProblem('Enter a valid amount in ₹ (minimum ₹1, up to 2 decimals).');
    if (Number(amount) > 500000) return setProblem('The amount must not exceed ₹5,00,000.');
    if (!/^\d+$/.test(days.trim()) || Number(days) < 1 || Number(days) > 90) return setProblem('Validity must be 1 to 90 days.');
    setBusy(true); setProblem('');
    try {
      const r = await api('/admin/payment-references', { method: 'POST', body: { userId: row.userId, filingId: row.id, amount: amount.trim(), days: Number(days), note } });
      toast(`Reference ${r.code} created for ${row.userName}.`);
      onDone(); onClose();
    } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="Payment reference" onClose={onClose} busy={busy}>
      <p className="ref-for"><b>{row.userName}</b> · {row.type} · FY {row.year} · #{row.id}</p>
      {(row.refs || []).length > 0 && (
        <ul className="ref-list">
          {row.refs.map((r) => (
            <li key={r.code}><strong>{r.code}</strong><span>{money(r.amountPaise)}</span><PayBadge status={r.status} /><small className="muted">expires {fmtDate(r.expiresAt)}</small></li>
          ))}
        </ul>
      )}
      {hasActive ? (
        <p className="alert"><i className="fa-solid fa-circle-info" />This filing already has an active reference. Cancel it from Payment References, or wait until it is paid or expires, before creating another.</p>
      ) : (
        <form onSubmit={create} noValidate>
          <div className="row-2">
            <div className="field"><label htmlFor="pr-amt">Amount (₹ INR)</label><input id="pr-amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 2500" autoFocus /></div>
            <div className="field"><label htmlFor="pr-days">Valid for (days)</label><input id="pr-days" className="input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
              <p className="muted field-hint">{expiry ? `Expires on ${fmtDate(expiry)}` : 'Enter 1 to 90 days'}</p></div>
          </div>
          <div className="field"><label htmlFor="pr-note">Note (optional)</label><input id="pr-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={190} /></div>
          {problem && <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{problem}</p>}
          <div className="modal-actions">
            <button type="button" className="btn outline sm" onClick={onClose} disabled={busy}>Close</button>
            <button className="btn sm" disabled={busy}>{busy ? 'Creating…' : 'Create reference'}</button>
          </div>
        </form>
      )}
      {hasActive && <div className="modal-actions"><button className="btn outline sm" onClick={onClose}>Close</button></div>}
    </Modal>
  );
}

function RefCell({ row, onDone }) {
  const [open, setOpen] = useState(false);
  const refs = row.refs || [];
  const latest = refs[0];
  return (
    <div className="ref-cell">
      {latest && <div className="ref-mini"><strong>{latest.code}</strong><PayBadge status={latest.status} /><span className="muted">{money(latest.amountPaise)}</span>{refs.length > 1 && <small className="muted">+{refs.length - 1} earlier</small>}</div>}
      <button className="btn outline sm" onClick={() => setOpen(true)}><i className="fa-solid fa-file-invoice" />{latest ? 'Manage' : 'Add Payment Reference'}</button>
      {open && <ReferenceModal row={row} onClose={() => setOpen(false)} onDone={onDone} />}
    </div>
  );
}

// ---- Tables ---------------------------------------------------------------------------------------------------
const only = (files, kind) => (files || []).filter((f) => f.kind === kind);
const BASE = [
  { label: 'Client', sort: 'name', render: (r) => <UserCell name={r.userName || r.name} sub={r.userEmail} /> },
  { label: 'Type of Filing', sort: 'type', render: (r) => <span className="chip">{r.type}</span> },
  { label: 'Year', sort: 'year', render: (r) => r.year },
  { label: 'Contact', sort: 'contact', render: (r) => <span className="nowrap">{fmtPhone(r.contact)}</span> },
];

// Each row owns its upload state, so every row's Choose File and Upload buttons work independently.
function UploadPair({ row, kind, refresh, tone }) {
  const u = useRowUpload(row.id, kind, refresh);
  return (
    <div className="upload-pair">
      <ChooseCell u={u} />
      <UploadCell u={u} tone={tone} />
    </div>
  );
}

const VARIANTS = {
  pending: {
    title: 'Pending Filings',
    subtitle: 'New submissions waiting for review. Upload a document, then click Start Processing to move the filing to Ongoing.',
    icon: 'fa-clock',
    columns: (refresh) => [
      ...BASE,
      { label: 'File', render: (r) => <FileLinks files={only(r.files, 'upload')} empty="No file" /> },
      { label: 'Admin Document', render: (r) => <FileLinks files={only(r.files, 'draft')} empty="Not uploaded" /> },
      { label: 'Choose & Upload', render: (r) => <UploadPair row={r} kind="draft" refresh={refresh} tone="cyan" /> },
      { label: 'Action', render: (r) => <StartButton row={r} onDone={refresh} /> },
    ],
  },
  ongoing: {
    title: 'Ongoing Filings',
    subtitle: 'Filings in progress. Uploading a file never changes the status; pick a status and press Save Update.',
    icon: 'fa-hourglass-half',
    columns: (refresh) => [
      ...BASE,
      { label: 'Draft File', render: (r) => <FileLinks files={only(r.files, 'draft')} empty="No draft" /> },
      { label: 'Upload File', render: (r) => <FileLinks files={only(r.files, 'final')} empty="Not uploaded" /> },
      { label: 'Choose & Upload', render: (r) => <UploadPair row={r} kind="final" refresh={refresh} tone="cyan" /> },
      { label: 'Status', render: (r) => <PayStatus row={r} /> },
      { label: 'Action', render: (r) => <StatusEditor row={r} onDone={refresh} /> },
    ],
  },
  completed: {
    title: 'Completed Filings',
    subtitle: 'Finished filings. Completed is final: it cannot move back. Documents can still be added and payment references requested.',
    icon: 'fa-circle-check',
    columns: (refresh) => [
      ...BASE,
      { label: 'Draft File', render: (r) => <FileLinks files={only(r.files, 'draft')} empty="No draft" /> },
      { label: 'Upload File', render: (r) => <FileLinks files={only(r.files, 'final')} empty="None" /> },
      { label: 'Choose & Upload', render: (r) => <UploadPair row={r} kind="final" refresh={refresh} tone="green" /> },
      { label: 'Status', render: () => <CompleteBadge /> },
      { label: 'Payment', render: (r) => <RefCell row={r} onDone={refresh} /> },
    ],
  },
};

function PayStatus({ row }) {
  return <span className={`badge ${row.status}`}>{row.status === 'drafted' ? 'Draft' : 'In Progress'}</span>;
}

export default function AdminFilings({ group }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const v = VARIANTS[group];
  const refresh = () => setRefreshKey((k) => k + 1);
  return (
    <>
      <PageHeader title={v.title} subtitle={v.subtitle} />
      <DataTable
        endpoint="/admin/filings"
        params={{ group }}
        columns={v.columns(refresh)}
        defaultSort="submitted"
        defaultDir="asc"
        topSearch="Search by Name"
        refreshKey={refreshKey}
        compact
        emptyIcon={v.icon}
        emptyText={`No ${group} filings.`}
      />
    </>
  );
}
