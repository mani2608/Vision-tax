'use client';
import DataTable, { FileLinks } from '@/components/DataTable';
import PageHeader from '@/components/PageHeader';
import { fmtPhone } from '@/lib/api';

const COLUMNS = [
  { label: 'Name', sort: 'name', render: (r) => <strong>{r.name}</strong> },
  { label: 'Type', sort: 'type', render: (r) => <span className="chip">{r.type}</span> },
  { label: 'Year', sort: 'year', render: (r) => r.year },
  { label: 'Contact', sort: 'contact', render: (r) => <span className="nowrap">{fmtPhone(r.contact)}</span> },
  { label: 'Final Copy Files', render: (r) => <FileLinks files={r.files} /> },
];

export default function Finals() {
  return (
    <>
      <PageHeader title="My Final Filings" subtitle="Your completed, ready-to-file tax returns." />
      <DataTable endpoint="/user/finals" columns={COLUMNS} defaultSort="submitted" topSearch="Search by Name" emptyIcon="fa-cloud-arrow-down" emptyText="No final copies are available yet. They appear here once your filing is completed." />
    </>
  );
}
