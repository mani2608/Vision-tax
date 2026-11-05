'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import DataTable, { FileLinks, StatusBadge } from '@/components/DataTable';
import PageHeader from '@/components/PageHeader';
import Modal from '@/components/Modal';
import { useToast } from '@/components/Shell';
import { ReferenceCards } from '@/components/ClientPayments';
import { api, ALLOWED_EXT, MAX_FILE_MB, fileProblem, fmtSize, fmtPhone } from '@/lib/api';

// Pick a corrected document, show its name/size, confirm, then upload it over the existing record.
function ReplaceDialog({ file, onClose, onDone }) {
  const toast = useToast();
  const input = useRef(null);
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function onPick(e) {
    const f = e.target.files[0];
    if (!f) return;
    const msg = fileProblem(f);
    setError(msg);
    setPicked(msg ? null : f);
    if (msg) e.target.value = '';
  }

  async function confirm() {
    if (!picked) return;
    setBusy(true); setError('');
    const body = new FormData();
    body.append('files', picked);
    try {
      await api(`/user/files/${file.id}`, { method: 'PUT', body });
      toast('Document replaced successfully.');
      onDone();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal title="Replace document" onClose={onClose} busy={busy}>
      <p>Replacing <b>{file.name}</b>. Choose the corrected file ({ALLOWED_EXT.join(', ').toUpperCase()}, up to {MAX_FILE_MB} MB).</p>
      <input ref={input} type="file" hidden accept={ALLOWED_EXT.map((e) => `.${e}`).join(',')} onChange={onPick} />
      {picked && (
        <div className="file-pick"><span>{picked.name}<small>{fmtSize(picked.size)}</small></span></div>
      )}
      {error && <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{error}</p>}
      <div className="modal-actions">
        <button className="btn outline sm" onClick={() => input.current.click()} disabled={busy}><i className="fa-solid fa-folder-open" />{picked ? 'Choose another' : 'Choose file'}</button>
        <button className="btn outline sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn sm" onClick={confirm} disabled={!picked || busy}>{busy ? 'Uploading…' : 'Confirm & upload'}</button>
      </div>
    </Modal>
  );
}

export default function MyFilings() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [replacing, setReplacing] = useState(null);

  const columns = [
    { label: 'Name', sort: 'name', render: (r) => <strong>{r.name}</strong> },
    { label: 'Type', sort: 'type', render: (r) => <span className="chip">{r.type}</span> },
    { label: 'Year', sort: 'year', render: (r) => r.year },
    { label: 'Contact', sort: 'contact', render: (r) => <span className="nowrap">{fmtPhone(r.contact)}</span> },
    { label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      label: 'Files',
      render: (r) => (
        <div>
          <FileLinks files={r.files} />
          {r.editable && r.files.map((f) => (
            <button key={f.id} className="link-btn plain" style={{ display: 'block', marginTop: 4 }} onClick={() => setReplacing(f)} title={`Replace ${f.name}`}>
              <i className="fa-solid fa-pen" /> Replace {f.name.length > 22 ? `${f.name.slice(0, 20)}…` : f.name}
            </button>
          ))}
        </div>
      ),
    },
    {
      label: 'Action',
      render: (r) => r.editable
        ? <Link href={`/dashboard/upload?edit=${r.id}`} className="btn outline sm"><i className="fa-solid fa-pen-to-square" />Edit Filing</Link>
        : <span className="muted" title="Completed filings are read-only"><i className="fa-solid fa-lock" /> Read-only</span>,
    },
  ];

  return (
    <>
      <PageHeader title="My Filings" subtitle="Everything you have submitted and where it stands. Pending and in-progress filings can be corrected.">
        <Link href="/dashboard/upload" className="btn"><i className="fa-solid fa-plus" />New filing</Link>
      </PageHeader>
      <DataTable endpoint="/user/filings" columns={columns} defaultSort="submitted" emptyIcon="fa-folder-open" emptyText="You have not submitted any filings yet." refreshKey={refreshKey} />
      <ReferenceCards refreshKey={refreshKey} />
      {replacing && <ReplaceDialog file={replacing} onClose={() => setReplacing(null)} onDone={() => { setReplacing(null); setRefreshKey((k) => k + 1); }} />}
    </>
  );
}
