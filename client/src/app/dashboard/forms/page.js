'use client';
import DataTable from '@/components/DataTable';
import PageHeader from '@/components/PageHeader';
import { downloadUrl, fmtDateTime } from '@/lib/api';

const COLUMNS = [
  { label: 'Category', sort: 'category', render: (r) => <span className="chip">{r.category}</span> },
  { label: 'Filing Year', sort: 'year', render: (r) => r.year },
  { label: 'Submitted On', sort: 'submitted', render: (r) => fmtDateTime(r.submittedAt) },
  { label: 'File', sort: 'file', render: (r) => <span><i className="fa-solid fa-file-lines" style={{ color: 'var(--primary-600)', marginRight: 8 }} />{r.fileName}</span> },
  { label: 'Action', render: (r) => <a className="btn green sm" href={downloadUrl(r.id)}><i className="fa-solid fa-download" />Download</a> },
];

export default function Forms() {
  return (
    <>
      <PageHeader title="Application Forms" subtitle="Tax information forms and documents on record for you." />
      <DataTable endpoint="/user/forms" columns={COLUMNS} defaultSort="submitted" emptyIcon="fa-clipboard-list" emptyText="No forms available yet. Upload filing documents to get started." />
    </>
  );
}
