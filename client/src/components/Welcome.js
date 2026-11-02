'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDateTime, STATUS_LABEL } from '@/lib/api';
import { useUser } from './Shell';

const STEPS = [
  { key: 'pending', label: 'Submitted', icon: 'fa-paper-plane' },
  { key: 'ongoing', label: 'In Review', icon: 'fa-magnifying-glass' },
  { key: 'drafted', label: 'Draft Ready', icon: 'fa-file-lines' },
  { key: 'completed', label: 'Completed', icon: 'fa-check' },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Progress({ status }) {
  const at = Math.max(0, STEPS.findIndex((s) => s.key === status));
  return (
    <div className="steps" aria-label={`Status: ${STATUS_LABEL[status]}`}>
      {STEPS.map((s, i) => (
        <div key={s.key} className={`step${i <= at ? ' done' : ''}${i === at && status !== 'completed' ? ' now' : ''}`}>
          <div className="dot"><i className={`fa-solid ${s.icon}`} /></div>{s.label}
        </div>
      ))}
    </div>
  );
}

// cards: [{ key, label, tone, icon }]  bars: [{ key, label, color }]  quick: [{ href, label, icon, tone }]
export default function Welcome({ endpoint, cards, portal, role, bars, quick }) {
  const user = useUser();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(endpoint).then(setData).catch((e) => setError(e.message)); }, [endpoint]);

  const isAdmin = role === 'admin';
  const total = bars ? bars.reduce((s, b) => s + (data ? data[b.key] || 0 : 0), 0) : 0;
  const latest = data?.recent?.[0];

  return (
    <>
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">{portal}</span>
          <h1>{greeting()}, {isAdmin ? 'Admin' : user.firstName} 👋</h1>
          <p>
            {isAdmin
              ? 'Here is what needs your attention today. Review new submissions, upload drafts and finish filings.'
              : 'Track your tax filings, upload documents and download your returns securely — all in one place.'}
          </p>
          <div className="hero-actions">
            {isAdmin ? (
              <>
                <Link className="btn light" href="/admin/pending"><i className="fa-solid fa-clock" /> Review pending</Link>
                <Link className="btn ghost-light" href="/admin/users"><i className="fa-solid fa-users" /> View users</Link>
              </>
            ) : (
              <>
                <Link className="btn light" href="/dashboard/upload"><i className="fa-solid fa-upload" /> New filing</Link>
                <Link className="btn ghost-light" href="/dashboard/filings"><i className="fa-solid fa-folder-open" /> My filings</Link>
              </>
            )}
          </div>
        </div>
      </section>

      {error && <p className="alert" role="alert"><i className="fa-solid fa-circle-exclamation" />{error}</p>}

      <div className="stats">
        {cards.map((c) => (
          <div className={`stat ${c.tone.replace('g-', 't-')}`} key={c.key}>
            <div className="stat-top">
              <span className={`stat-icon ${c.tone}`}><i className={`fa-solid ${c.icon}`} /></span>
            </div>
            <div>
              <div className="stat-num">{data ? data[c.key] ?? 0 : '–'}</div>
              <div className="stat-label">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <section className="card">
          <div className="card-head">
            <h2>{isAdmin ? 'Recent submissions' : 'Recent filings'}</h2>
            <Link href={isAdmin ? '/admin/pending' : '/dashboard/filings'}>View all →</Link>
          </div>
          {!data && <p className="muted">Loading…</p>}
          {data && data.recent?.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>
              {isAdmin ? 'No filings have been submitted yet.' : 'You have not submitted a filing yet. Start by uploading your documents.'}
            </p>
          )}
          <ul className="activity">
            {data?.recent?.map((r) => (
              <li key={r.id}>
                <span className="act-ico"><i className="fa-solid fa-file-invoice" /></span>
                <div className="act-main">
                  <strong>{r.name}</strong>
                  <span>{isAdmin ? `${r.userName} · ` : ''}{r.type} · {r.year} · {fmtDateTime(r.submittedAt)}</span>
                </div>
                <span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span>
              </li>
            ))}
          </ul>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {isAdmin && bars && (
            <section className="card">
              <div className="card-head"><h2>Filing pipeline</h2><span className="chip">{total} total</span></div>
              <div className="pipeline">
                {bars.map((b) => {
                  const n = data ? data[b.key] || 0 : 0;
                  return (
                    <div className="bar-row" key={b.key}>
                      <div className="bar-top"><span>{b.label}</span><b>{n}</b></div>
                      <div className="bar"><i style={{ width: `${total ? (n / total) * 100 : 0}%`, background: b.color }} /></div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {!isAdmin && (
            <section className="card">
              <div className="card-head"><h2>Latest filing progress</h2></div>
              {latest ? (
                <>
                  <p style={{ margin: '0 0 16px' }}><strong>{latest.name}</strong> <span className="muted">· {latest.type} {latest.year}</span></p>
                  <Progress status={latest.status} />
                </>
              ) : <p className="muted" style={{ margin: 0 }}>Your progress tracker appears here after your first submission.</p>}
            </section>
          )}
          {quick && (
            <section className="card">
              <div className="card-head"><h2>Quick actions</h2></div>
              <div className="quick">
                {quick.map((q) => (
                  <Link key={q.href} href={q.href}><i className={`fa-solid ${q.icon} ${q.tone}`} />{q.label}</Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
