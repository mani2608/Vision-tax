'use client';
import { useState } from 'react';
import Link from 'next/link';
import DataTable, { FileLinks, IconBtn, StatusBadge } from '@/components/DataTable';
import PageHeader from '@/components/PageHeader';
import Modal from '@/components/Modal';
import FilingDetails, { FilingName } from '@/components/FilingDetails';
import { useToast } from '@/components/Shell';
import { api, fmtPhone } from '@/lib/api';

// Confirmation before a filing (and its documents) is permanently deleted.
function DeleteDialog({ filing, onClose, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    setBusy(true); setError('');
    try {
      await api(`/user/filings/${filing.id}`, { method: 'DELETE' });
      toast('Filing deleted.');
      onDone();
    } catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <Modal title="Delete filing" onClose={onClose} busy={busy}>
      <p>Delete <b>{filing.name}</b> ({filing.type} · {filing.year})? The filing and all of its uploaded documents will be removed permanently. This cannot be undone.</p>
      {error && <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{error}</p>}
      <div className="modal-actions">
        <button className="btn outline sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn danger sm" onClick={confirm} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>
      </div>
    </Modal>
  );
}

export default function MyFilings() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const columns = [
    { label: 'Name', sort: 'name', render: (r) => <strong><FilingName id={r.id} name={r.name} role="user" /></strong> },
    { label: 'Type', sort: 'type', render: (r) => <span className="chip">{r.type}</span> },
    { label: 'Year', sort: 'year', render: (r) => r.year },
    { label: 'Contact', sort: 'contact', render: (r) => <span className="nowrap">{fmtPhone(r.contact)}</span> },
    { label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { label: 'Final File', render: (r) => <FileLinks files={r.files} empty="—" /> },
    {
      // Same rule as before: Pending / In Progress filings are editable, Completed ones are read-only (view only).
      label: 'Action',
      render: (r) => (
        <div className="icon-acts">
          <IconBtn icon="fa-eye" tone="view" label="View filing details" onClick={() => setViewing(r.id)} />
          {r.editable ? (
            <>
              <Link href={`/dashboard/upload?edit=${r.id}`} className="icon-act edit" title="Edit filing" aria-label="Edit filing"><i className="fa-solid fa-pen" /></Link>
              <IconBtn icon="fa-trash" tone="delete" label="Delete filing" onClick={() => setDeleting(r)} />
            </>
          ) : (
            <span className="muted" title="Completed filings are read-only"><i className="fa-solid fa-lock" /></span>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="My Filings" subtitle="Filings with a payment still pending. Pending and in-progress filings can be corrected; paid filings are listed under Payments.">
        <Link href="/dashboard/upload" className="btn"><i className="fa-solid fa-plus" />New filing</Link>
      </PageHeader>
      <DataTable endpoint="/user/filings" columns={columns} defaultSort="submitted" emptyIcon="fa-folder-open" emptyText="No filings with a pending payment." refreshKey={refreshKey} />
      {viewing && <FilingDetails filingId={viewing} role="user" onClose={() => setViewing(null)} />}
      {deleting && <DeleteDialog filing={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); setRefreshKey((k) => k + 1); }} />}
    </>
  );
}
