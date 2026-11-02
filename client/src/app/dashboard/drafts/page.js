'use client';
import DataTable from '@/components/DataTable';
import PageHeader from '@/components/PageHeader';
import { downloadUrl } from '@/lib/api';

const COLUMNS = [
  { label: 'Category', sort: 'type', render: (r) => <span className="chip">{r.type}</span> },
  { label: 'Year', sort: 'year', render: (r) => r.year },
  {
    label: 'Draft File(s)',
    render: (r) => (
      <div className="inline-actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        {r.files.map((f) => <a key={f.id} className="btn outline sm" href={downloadUrl(f.id)}><i className="fa-solid fa-download" />{f.name}</a>)}
      </div>
    ),
  },
];

export default function Drafts() {
  return (
    <>
      <PageHeader title="My Draft Files" subtitle="Review your tax return drafts before they are finalised." />
      <DataTable endpoint="/user/drafts" columns={COLUMNS} defaultSort="submitted" topSearch="Search by Category" emptyIcon="fa-file-arrow-down" emptyText="No draft copies are available yet. We will notify you here once your draft is ready." />
    </>
  );
}
