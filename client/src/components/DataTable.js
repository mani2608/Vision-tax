'use client';
import { useEffect, useState } from 'react';
import { api, downloadUrl, initials, STATUS_LABEL } from '@/lib/api';

// Server-driven table: search, sort, page size and pagination are all handled by the API.
// columns: [{ label, sort?: 'apiSortKey', render: (row, index) => node }]
export default function DataTable({ endpoint, params = {}, columns, defaultSort, defaultDir = 'desc', topSearch, emptyText = 'No records found.', emptyIcon = 'fa-inbox', refreshKey = 0, compact = false }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [dq, setDq] = useState('');
  const [dname, setDname] = useState('');
  const [sort, setSort] = useState(defaultSort);
  const [dir, setDir] = useState(defaultDir);
  const [data, setData] = useState({ rows: [], total: 0 });
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { const t = setTimeout(() => { setDname(name); setPage(1); }, 300); return () => clearTimeout(t); }, [name]);

  const paramKey = JSON.stringify(params);
  useEffect(() => {
    const ctl = new AbortController();
    const qs = new URLSearchParams({ ...params, page, limit, q: dq, name: dname, sort: sort || '', dir });
    setState((s) => (s === 'ready' ? 'refreshing' : 'loading'));
    api(`${endpoint}?${qs}`, { signal: ctl.signal })
      .then((d) => {
        // If rows vanished from the last page (e.g. status changed), step back
        if (d.rows.length === 0 && d.total > 0 && page > 1) return setPage(Math.ceil(d.total / limit));
        setData(d); setState('ready');
      })
      .catch((e) => { if (e.name !== 'AbortError') { setError(e.message); setState('error'); } });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, paramKey, page, limit, dq, dname, sort, dir, refreshKey]);

  const pages = Math.max(1, Math.ceil(data.total / limit));
  const from = data.total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, data.total);
  const window_ = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) window_.push(i);

  const toggleSort = (key) => {
    if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSort(key); setDir('asc'); }
    setPage(1);
  };

  const ready = state === 'ready' || state === 'refreshing';
  const searching = dq || dname;

  return (
    <div className="card">
      {topSearch && (
        <div className="top-wrap">
          <i className="fa-solid fa-magnifying-glass" aria-hidden />
          <input className="top-search" placeholder={topSearch} value={name} onChange={(e) => setName(e.target.value)} aria-label={topSearch} />
        </div>
      )}
      <div className="table-tools">
        <label>Show
          <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          entries
        </label>
        <label className="searchbox">
          <i className="fa-solid fa-magnifying-glass" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search" />
        </label>
      </div>
      <div className="table-wrap" style={{ opacity: state === 'refreshing' ? 0.6 : 1 }}>
        <table className={compact ? "dt compact" : "dt"}>
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort(defaultSort)}>S.No<SortIcon on={sort === defaultSort} dir={dir} /></th>
              {columns.map((c) => c.sort
                ? <th key={c.label} className="sortable" onClick={() => toggleSort(c.sort)}>{c.label}<SortIcon on={sort === c.sort} dir={dir} /></th>
                : <th key={c.label}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {state === 'loading' && [0, 1, 2, 3].map((i) => (
              <tr key={i} className="skeleton">
                {Array.from({ length: columns.length + 1 }, (_, j) => <td key={j}><span style={{ width: j === 0 ? 18 : `${55 + ((i + j) % 3) * 15}%` }} /></td>)}
              </tr>
            ))}
            {state === 'error' && <tr><td colSpan={columns.length + 1} className="empty" style={{ color: 'var(--danger)' }}><i className="fa-solid fa-triangle-exclamation" /> {error}</td></tr>}
            {ready && data.rows.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="empty">
                <span className="empty-ico"><i className={`fa-solid ${searching ? 'fa-magnifying-glass' : emptyIcon}`} /></span>
                {searching ? 'No matching records found.' : emptyText}
              </td></tr>
            )}
            {ready && data.rows.map((row, i) => (
              <tr key={row.id}>
                <td className="sno">{(page - 1) * limit + i + 1}</td>
                {columns.map((c) => <td key={c.label}>{c.render(row, i)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-foot">
        <span>Showing {from} to {to} of {data.total} entries</span>
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          {window_.map((n) => <button key={n} className={n === page ? 'on' : ''} onClick={() => setPage(n)}>{n}</button>)}
          <button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}

function SortIcon({ on, dir }) {
  return <i className={`sort fa-solid ${on ? (dir === 'asc' ? 'fa-arrow-up on' : 'fa-arrow-down on') : 'fa-arrows-up-down'}`} />;
}

export function StatusBadge({ status }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status] || status}</span>;
}

export function UserCell({ name, sub }) {
  return (
    <div className="cell-user">
      <span className="avatar sm" aria-hidden>{initials(name)}</span>
      <div><strong>{name}</strong>{sub && <span>{sub}</span>}</div>
    </div>
  );
}

const fileIcon = (n = '') => {
  const e = n.split('.').pop().toLowerCase();
  return e === 'pdf' ? 'fa-file-pdf' : e === 'docx' ? 'fa-file-word' : ['csv', 'json', 'xml'].includes(e) ? 'fa-file-code' : 'fa-file-lines';
};

export function FileLinks({ files, empty = 'No files' }) {
  if (!files || files.length === 0) return <span className="muted">{empty}</span>;
  return (
    <ul className="file-list">
      {files.map((f) => <li key={f.id}><a href={downloadUrl(f.id)} title={f.name}><i className={`fa-solid ${fileIcon(f.name)}`} /><span>{f.name}</span></a></li>)}
    </ul>
  );
}
