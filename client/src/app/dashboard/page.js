'use client';
import Welcome from '@/components/Welcome';

const CARDS = [
  { key: 'downloads', label: 'Total Downloads', tone: 'g-indigo', icon: 'fa-download' },
  { key: 'uploads', label: 'Total Uploads', tone: 'g-violet', icon: 'fa-cloud-arrow-up' },
  { key: 'drafts', label: 'Total Drafts Received', tone: 'g-amber', icon: 'fa-file-lines' },
  { key: 'finals', label: 'Final Copies Received', tone: 'g-green', icon: 'fa-circle-check' },
];

const QUICK = [
  { href: '/dashboard/upload', label: 'Upload documents', icon: 'fa-upload', tone: 'g-violet' },
  { href: '/dashboard/forms', label: 'Tax information forms', icon: 'fa-clipboard-list', tone: 'g-indigo' },
  { href: '/dashboard/drafts', label: 'Draft copies', icon: 'fa-file-arrow-down', tone: 'g-amber' },
  { href: '/dashboard/finals', label: 'Final copies', icon: 'fa-cloud-arrow-down', tone: 'g-green' },
];

export default function UserDashboard() {
  return <Welcome role="user" endpoint="/user/summary" cards={CARDS} quick={QUICK} portal="VisionTax Client Portal" />;
}
