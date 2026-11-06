'use client';
import { useRef, useState } from 'react';
import DataTable, { FileLinks, IconBtn, UserCell } from './DataTable';
import { FilingName } from './FilingDetails';
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
      <button className="btn sm" disabled={busy || Boolean(blocked)} title={blocked || 'Save the selected status'} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      {blocked && <i className="fa-solid fa-circle-info warn-ico" title={blocked} aria-label={blocked} />}
      {asking && <ConfirmStatus row={row} to="completed" onCancel={() => { setAsking(false); setValue(row.status); }} onDone={() => { setAsking(false); onDone(); }} doneMessage="Filing completed. You can now add a payment reference." />}
    </div>
  );
}

function StartButton({ row, onDone }) {
  const [asking, setAsking] = useState(false);
  const blocked = blocker(row, 'ongoing');
  return (
    <div className="status-edit">
      <button className="btn sm" disabled={Boolean(blocked)} title={blocked || 'Move this filing to Ongoing'} onClick={() => setAsking(true)}><i className="fa-solid fa-play" />Start Processing</button>
      {blocked && <i className="fa-solid fa-circle-info warn-ico" title={blocked} aria-label={blocked} />}
      {asking && <ConfirmStatus row={row} to="ongoing" note="Processing started" doneMessage="Filing moved to Ongoing. Your document is now its Draft File." onCancel={() => setAsking(false)} onDone={() => { setAsking(false); onDone(); }} />}
    </div>
  );
}

const CompleteBadge = () => <span className="badge pay-paid" title="Completed is a final status (locked)" aria-label="Completed"><i className="fa-solid fa-lock" /></span>;

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
    <>
      <button className="btn outline sm" onClick={() => setOpen(true)} title={latest ? `${latest.code} · ${money(latest.amountPaise)}${refs.length > 1 ? ` (+${refs.length - 1} earlier)` : ''}` : 'Create a payment reference'}>
        <i className="fa-solid fa-file-invoice" /><span className="lbl">{latest ? 'Manage' : 'Add Payment'}</span>
      </button>
      {latest && <PayBadge status={latest.status} />}
      {open && <ReferenceModal row={row} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

// ---- Tables ---------------------------------------------------------------------------------------------------
const only = (files, kind) => (files || []).filter((f) => f.kind === kind);
const BASE = [
  { label: 'Client', sort: 'name', render: (r) => <UserCell name={r.userName || r.name}><FilingName id={r.id} name={r.userName || r.name} role="admin" /></UserCell> },
  { label: 'Type of Filing', sort: 'type', render: (r) => <span className="chip">{r.type}</span> },
  { label: 'Year', sort: 'year', render: (r) => r.year },
  { label: 'Contact', sort: 'contact', render: (r) => <span className="nowrap">{fmtPhone(r.contact)}</span> },
  // Two different fields: what the CLIENT uploaded (read-only) and what the ADMIN uploaded (replace / delete icons).
  { label: 'Client Filing File', render: (r) => <FileLinks files={only(r.files, 'upload')} empty="No file" /> },
];

// ---- Admin-uploaded documents: pen = replace with a new file, cross = delete (with confirmation) ----------------------
// Only draft/final files (uploaded by the admin) get these icons; the client's own uploads are never editable here.
// Draft files are locked once a filing is Completed (the server enforces the same rule).
function AdminFiles({ row, kinds, refresh, empty }) {
  const toast = useToast();
  const input = useRef(null);
  const [target, setTarget] = useState(null); // file being replaced
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const files = (row.files || []).filter((f) => kinds.includes(f.kind));
  const tagged = kinds.length > 1;
  const locked = (f) => f.kind === 'draft' && row.status === 'completed';

  async function onPick(e) {
    const f = e.target.files[0];
    e.target.value = '';
    const t = target;
    setTarget(null);
    if (!f || !t) return;
    const p = fileProblem(f);
    if (p) return toast(p, 'error');
    setBusy(true);
    const body = new FormData();
    body.append('files', f);
    try {
      await api(`/admin/files/${t.id}`, { method: 'PUT', body });
      toast(`"${t.name}" replaced with "${f.name}".`);
      refresh();
    } catch (err) { toast(`${err.message} The existing document was kept.`, 'error'); } finally { setBusy(false); }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await api(`/admin/files/${deleting.id}`, { method: 'DELETE' });
      toast(`"${deleting.name}" deleted.`);
      setDeleting(null); refresh();
    } catch (err) { toast(err.message, 'error'); setDeleting(null); } finally { setBusy(false); }
  }

  const actionsFn = (f) => (locked(f) ? <i className="fa-solid fa-lock warn-ico" title="Draft documents are locked once the filing is completed" /> : (
    <>
      <IconBtn icon="fa-pen" tone="edit" label={`Replace ${f.name}`} disabled={busy} onClick={() => { setTarget(f); input.current.click(); }} />
      <IconBtn icon="fa-xmark" tone="delete" label={`Delete ${f.name}`} disabled={busy} onClick={() => setDeleting(f)} />
    </>
  ));
  const tagFn = tagged ? (f) => (f.kind === 'draft' ? 'Draft' : 'Final') : null;

  return (
    <>
      {/* every document on its own line (file 1, file 2 …), each with its own replace / delete icons */}
      <FileLinks files={files} empty={empty} actions={actionsFn} tag={tagFn} />
      <input ref={input} type="file" hidden accept={ALLOWED_EXT.map((e) => `.${e}`).join(',')} onChange={onPick} />
      {deleting && (
        <Modal title="Delete document" onClose={() => setDeleting(null)} busy={busy}>
          <p>Delete <b>{deleting.name}</b> from <b>{row.userName || row.name}</b>'s filing? Only this document is removed; the filing's other documents are not affected.</p>
          <div className="modal-actions">
            <button className="btn outline sm" onClick={() => setDeleting(null)} disabled={busy}>Cancel</button>
            <button className="btn danger sm" onClick={confirmDelete} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// Each row owns its upload state, so every row's Choose and Upload controls work independently. One compact line per row.
function UploadPair({ row, kind, refresh, tone }) {
  const u = useRowUpload(row.id, kind, refresh);
  return (
    <div className="mini-up">
      <label className={`mini-btn${u.busy ? ' off' : ''}`} title={u.file ? `${u.file.name} · ${fmtSize(u.file.size)}` : 'Choose a file to upload'}><i className="fa-solid fa-folder-open" /><span className="mini-name lbl-c">{u.file ? u.file.name : 'Choose'}</span>
        <input key={u.key} type="file" hidden accept={ALLOWED_EXT.map((e) => `.${e}`).join(',')} aria-label="Choose file" onChange={u.pick} disabled={u.busy} />
      </label>
      <button className={`mini-btn go ${tone}`} disabled={u.busy || !u.file} onClick={u.send} title="Upload the chosen file"><i className="fa-solid fa-cloud-arrow-up" /><span className="lbl">{u.busy ? '…' : 'Upload'}</span></button>
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
      { label: 'Admin Uploaded Filing', render: (r) => <AdminFiles row={r} kinds={['draft']} refresh={refresh} empty="Not uploaded" /> },
      { label: 'Choose File & Upload', render: (r) => <UploadPair row={r} kind="draft" refresh={refresh} tone="cyan" /> },
      { label: 'Action', render: (r) => <StartButton row={r} onDone={refresh} /> },
    ],
  },
  ongoing: {
    title: 'Ongoing Filings',
    subtitle: 'Filings in progress. Uploading a file never changes the status; pick a status and press Save.',
    icon: 'fa-hourglass-half',
    columns: (refresh) => [
      ...BASE,
      { label: 'Admin Uploaded Filing', render: (r) => <AdminFiles row={r} kinds={['draft', 'final']} refresh={refresh} empty="Not uploaded" /> },
      { label: 'Choose File & Upload', render: (r) => <UploadPair row={r} kind="final" refresh={refresh} tone="cyan" /> },
      { label: 'Action', render: (r) => <StatusEditor row={r} onDone={refresh} /> },
    ],
  },
  completed: {
    title: 'Completed Filings',
    subtitle: 'Finished filings. Completed is final: it cannot move back. Documents can still be added and payment references requested.',
    icon: 'fa-circle-check',
    columns: (refresh) => [
      ...BASE,
      { label: 'Admin Uploaded Filing', render: (r) => <AdminFiles row={r} kinds={['draft', 'final']} refresh={refresh} empty="Not uploaded" /> },
      { label: 'Choose File & Upload', render: (r) => <UploadPair row={r} kind="final" refresh={refresh} tone="green" /> },
      { label: 'Action', render: (r) => <div className="status-edit"><CompleteBadge /><RefCell row={r} onDone={refresh} /></div> },
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
