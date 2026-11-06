'use client';
import DataTable, { UserCell } from '@/components/DataTable';
import { UserName } from '@/components/FilingDetails';
import PageHeader from '@/components/PageHeader';
import { fmtDateTime, fmtPhone } from '@/lib/api';

const COLUMNS = [
  { label: 'Name', sort: 'name', render: (r) => <UserCell name={r.name}><UserName id={r.id} name={r.name} /></UserCell> },
  { label: 'Phone', sort: 'phone', render: (r) => <span className="nowrap">{fmtPhone(r.phone)}</span> },
  { label: 'Year', sort: 'year', render: (r) => (r.year ? <span className="chip">{r.year}</span> : <span className="muted">–</span>) },
  { label: 'Registered At', sort: 'registered', render: (r) => fmtDateTime(r.registeredAt) },
];

export default function Users() {
  return (
    <>
      <PageHeader title="All Users" subtitle="Every registered client account." />
      <DataTable endpoint="/admin/users" columns={COLUMNS} defaultSort="registered" emptyIcon="fa-users" emptyText="No registered users yet." />
    </>
  );
}
