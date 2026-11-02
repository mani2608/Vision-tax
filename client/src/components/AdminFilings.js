'use client';
import { useState } from 'react';
import DataTable, { FileLinks, UserCell } from './DataTable';
import PageHeader from './PageHeader';
import { api, STATUS_LABEL } from '@/lib/api';
import { useToast } from './Shell';

// Choose files + upload button for one filing. `kind` is 'draft' or 'final'.
function Uploader({ filingId, kind, label, tone, onDone }) {
  const toast = useToast();
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);

  async function send() {
    if (!files.length) return toast('Choose at least one file first.', 'error');
    setBusy(true);
    const body = new FormData();
    files.forEach((f) => body.append('files', f));
    try {
      await api(`/admin/filings/${filingId}/${kind}`, { method: 'POST', body });
      toast(kind === 'draft' ? 'Draft uploaded. Filing marked as Drafted.' : 'Final copy uploaded.');
      setFiles([]); setKey((k) => k + 1);
      onDone();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="inline-actions">
      <input key={key} type="file" multiple accept=".txt,.docx,.pdf,.rtf,.xml,.json,.csv" aria-label={`Choose ${kind} files`} onChange={(e) => setFiles(Array.from(e.target.files))} />
      <button className={`btn sm ${tone}`} disabled={busy || !files.length} onClick={send}>
        <i className="fa-solid fa-cloud-arrow-up" />{busy ? 'Uploading…' : label}
      </button>
    </div>
  );
}

function StatusEditor({ row, onDone }) {
  const toast = useToast();
  const [value, setValue] = useState(row.status);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/admin/filings/${row.id}/status`, { method: 'PATCH', body: { status: value } });
      toast(`Status updated to ${STATUS_LABEL[value]}.`);
      onDone();
    } catch (e) { toast(e.message, 'error'); setValue(row.status); } finally { setBusy(false); }
  }

  return (
    <div className="inline-actions" style={{ flexWrap: 'nowrap' }}>
      <select className="status-select" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Status">
        {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <button className="btn sm" disabled={busy || value === row.status} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

const only = (files, kind) => (files || []).filter((f) => f.kind === kind);
const BASE = [
  { label: 'Name', sort: 'name', render: (r) => <UserCell name={r.name} sub={r.userEmail} /> },
  { label: 'Type', sort: 'type', render: (r) => <span className="chip">{r.type}</span> },
  { label: 'Year', sort: 'year', render: (r) => r.year },
  { label: 'Contact', sort: 'contact', render: (r) => r.contact },
];

const VARIANTS = {
  pending: {
    title: 'Pending Filings',
    subtitle: 'New submissions waiting for review. Upload a draft or start processing.',
    icon: 'fa-clock',
    columns: (refresh) => [
      ...BASE,
      { label: 'Files', render: (r) => <FileLinks files={only(r.files, 'upload')} /> },
      { label: 'Upload Draft', render: (r) => <Uploader filingId={r.id} kind="draft" label="Upload" tone="cyan" onDone={refresh} /> },
      { label: 'Action', render: (r) => <StartButton row={r} onDone={refresh} /> },
    ],
  },
  ongoing: {
    title: 'Ongoing Filings',
    subtitle: 'Filings in progress. Upload final copies and move them to completed.',
    icon: 'fa-hourglass-half',
    columns: (refresh) => [
      ...BASE,
      { label: 'Files', render: (r) => <FileLinks files={only(r.files, 'upload')} /> },
      { label: 'Draft Files', render: (r) => <FileLinks files={only(r.files, 'draft')} empty="No draft yet" /> },
      { label: 'Upload Final', render: (r) => <Uploader filingId={r.id} kind="final" label="Upload Final" tone="cyan" onDone={refresh} /> },
      { label: 'Final Files', render: (r) => <FileLinks files={only(r.files, 'final')} empty="None" /> },
      { label: 'Status', render: (r) => <StatusEditor row={r} onDone={refresh} /> },
    ],
  },
  completed: {
    title: 'Completed Filings',
    subtitle: 'Manage final files and status for finished filings.',
    icon: 'fa-circle-check',
    columns: (refresh) => [
      ...BASE,
      { label: 'Uploaded Final Files', render: (r) => <FileLinks files={only(r.files, 'final')} empty="No files" /> },
      { label: 'Upload Final', render: (r) => <Uploader filingId={r.id} kind="final" label="Upload" tone="green" onDone={refresh} /> },
      { label: 'Status', render: (r) => <StatusEditor row={r} onDone={refresh} /> },
    ],
  },
};

function StartButton({ row, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      await api(`/admin/filings/${row.id}/status`, { method: 'PATCH', body: { status: 'ongoing', note: 'Review started' } });
      toast('Filing moved to In Progress.');
      onDone();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  return <button className="btn outline sm" disabled={busy} onClick={start}><i className="fa-solid fa-play" />Start Processing</button>;
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
        emptyIcon={v.icon}
        emptyText={`No ${group} filings.`}
      />
    </>
  );
}
