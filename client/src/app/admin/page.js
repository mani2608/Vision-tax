'use client';
import Welcome from '@/components/Welcome';

const CARDS = [
  { key: 'pending', label: 'Pending Filings', tone: 'g-amber', icon: 'fa-clock' },
  { key: 'inProgress', label: 'In Progress Filings', tone: 'g-blue', icon: 'fa-hourglass-half' },
  { key: 'completed', label: 'Completed Filings', tone: 'g-green', icon: 'fa-circle-check' },
  { key: 'users', label: 'Registered Users', tone: 'g-violet', icon: 'fa-users' },
];

const BARS = [
  { key: 'pending', label: 'Pending', color: 'linear-gradient(90deg,#f59e0b,#f97316)' },
  { key: 'inProgress', label: 'In progress', color: 'linear-gradient(90deg,#3b82f6,#06b6d4)' },
  { key: 'completed', label: 'Completed', color: 'linear-gradient(90deg,#10b981,#0d9488)' },
];

const QUICK = [
  { href: '/admin/pending', label: 'Pending filings', icon: 'fa-clock', tone: 'g-amber' },
  { href: '/admin/ongoing', label: 'Ongoing filings', icon: 'fa-hourglass-half', tone: 'g-blue' },
  { href: '/admin/completed', label: 'Completed filings', icon: 'fa-circle-check', tone: 'g-green' },
  { href: '/admin/users', label: 'User list', icon: 'fa-users', tone: 'g-violet' },
];

export default function AdminDashboard() {
  return <Welcome role="admin" endpoint="/admin/summary" cards={CARDS} bars={BARS} quick={QUICK} portal="VisionTax Admin" />;
}
