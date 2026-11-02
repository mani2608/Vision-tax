'use client';
import Link from 'next/link';
import DataTable, { FileLinks, StatusBadge } from '@/components/DataTable';
import PageHeader from '@/components/PageHeader';

const COLUMNS = [
  { label: 'Name', sort: 'name', render: (r) => <strong>{r.name}</strong> },
  { label: 'Type', sort: 'type', render: (r) => <span className="chip">{r.type}</span> },
  { label: 'Year', sort: 'year', render: (r) => r.year },
  { label: 'Contact', sort: 'contact', render: (r) => r.contact },
  { label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  { label: 'Files', render: (r) => <FileLinks files={r.files} /> },
];

export default function MyFilings() {
  return (
    <>
      <PageHeader title="My Filings" subtitle="Everything you have submitted and where it stands.">
        <Link href="/dashboard/upload" className="btn"><i className="fa-solid fa-plus" />New filing</Link>
      </PageHeader>
      <DataTable endpoint="/user/filings" columns={COLUMNS} defaultSort="submitted" emptyIcon="fa-folder-open" emptyText="You have not submitted any filings yet." />
    </>
  );
}
