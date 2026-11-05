'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtDateTime } from '@/lib/api';

const ICON = { payment_received: 'fa-circle-check', payment_success: 'fa-circle-check', payment_submitted: 'fa-hourglass-half', payment_rejected: 'fa-circle-xmark', payment_requested: 'fa-file-invoice', payment_duplicate: 'fa-triangle-exclamation' };
const POLL_MS = 30000;

// Bell with an unread badge. Polls a tiny count endpoint; the list is loaded only when the panel opens.
export default function Notifications({ onNew, paymentsHref }) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const wrap = useRef(null);
  const lastSeen = useRef(null);
  const announce = useRef(onNew);
  useEffect(() => { announce.current = onNew; });

  const poll = useCallback(async () => {
    try {
      const d = await api('/notifications/unread-count');
      setUnread(d.unread);
      // Announce a notification that arrived while the page was open (not the ones already waiting at page load).
      if (d.latest && lastSeen.current !== null && d.latest.id > lastSeen.current) announce.current && announce.current(d.latest.message);
      lastSeen.current = d.latest ? d.latest.id : lastSeen.current ?? 0;
    } catch { /* bell is best-effort: never disturbs the page */ }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    const vis = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [poll]);

  const load = useCallback(() => api('/notifications').then((d) => { setRows(d.rows); setUnread(d.unread); setError(''); }).catch((e) => setError(e.message)), []);

  useEffect(() => {
    if (!open) return undefined;
    load();
    const close = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open, load]);

  async function markAll() {
    try { const d = await api('/notifications/read', { method: 'POST', body: {} }); setUnread(d.unread); setRows((r) => r && r.map((x) => ({ ...x, read: true }))); } catch { /* ignore */ }
  }
  async function markOne(n) {
    if (n.read) return;
    try { const d = await api('/notifications/read', { method: 'POST', body: { ids: [n.id] } }); setUnread(d.unread); setRows((r) => r && r.map((x) => (x.id === n.id ? { ...x, read: true } : x))); } catch { /* ignore */ }
  }

  return (
    <div className="profile-wrap" ref={wrap}>
      <button className="icon-btn bell-btn" onClick={() => setOpen((o) => !o)} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-haspopup="true" aria-expanded={open} title="Notifications">
        <i className="fa-solid fa-bell" />
        {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            {unread > 0 && <button className="link-btn plain" onClick={markAll}>Mark all as read</button>}
          </div>
          <div className="notif-list">
            {error && <p className="notif-empty" style={{ color: 'var(--danger)' }}>{error}</p>}
            {!error && !rows && <p className="notif-empty"><i className="fa-solid fa-spinner fa-spin" /></p>}
            {!error && rows && rows.length === 0 && <p className="notif-empty">You have no notifications yet.</p>}
            {rows && rows.map((n) => (
              <button key={n.id} className={`notif-item${n.read ? '' : ' unread'}`} onClick={() => markOne(n)}>
                <i className={`fa-solid ${ICON[n.type] || 'fa-bell'} notif-ico ${n.type}`} />
                <span>
                  <strong>{n.title}</strong>
                  <span className="notif-msg">{n.message}</span>
                  <PaymentDetails n={n} />
                  <small>{fmtDateTime(n.createdAt)}</small>
                </span>
              </button>
            ))}
          </div>
          {paymentsHref && <a className="notif-foot" href={paymentsHref}>View payment history →</a>}
        </div>
      )}
    </div>
  );
}

// The structured facts behind a payment notification (what the PRD asks both dashboards to show).
function PaymentDetails({ n }) {
  const d = n.data || {};
  if (!['payment_received', 'payment_success', 'payment_submitted', 'payment_rejected'].includes(n.type)) return null;
  const rows = [
    d.clientName && ['Client', `${d.clientName}${d.clientEmail ? ` (${d.clientEmail})` : ''}`],
    d.filing && ['Filing', `${d.filing}${d.filingId ? ` · #${d.filingId}` : ''}${d.filingYear ? ` · ${d.filingYear}` : ''}`],
    d.reference && ['Reference', d.reference],
    d.amount && ['Amount', d.amount],
    d.method && ['Method', d.method],
    d.razorpayPaymentId && ['Razorpay ID', d.razorpayPaymentId],
    d.utr && ['Txn ref', d.utr],
    d.paidAt && ['Date', fmtDateTime(d.paidAt)],
    d.status && ['Status', d.status],
  ].filter(Boolean);
  return (
    <dl className="notif-details">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}
