'use client';
import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { PaymentHistory, ReferenceCards } from '@/components/ClientPayments';

export default function Payments() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <PageHeader title="Payments" subtitle="Payments requested for your completed filings, and your payment history." />
      <ReferenceCards refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
      <h2 className="panel-title" style={{ marginTop: 24 }}>Payment history</h2>
      <PaymentHistory refreshKey={refreshKey} />
    </>
  );
}
