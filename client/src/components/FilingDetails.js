'use client';
import { useEffect, useState } from 'react';
import Modal from './Modal';
import { FileLinks, StatusBadge } from './DataTable';
import { api, fmtDateTime, fmtPhone, fmtSize, STATUS_LABEL } from '@/lib/api';

// Read-only popup with everything on record for ONE filing. Data comes from the API (the server checks that a
// client can only open their own filing); nothing here is hard-coded.
export default function FilingDetails({ filingId, role, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const isAdmin = role === 'admin';

  useEffect(() => {
    const ctl = new AbortController();
    api(`/${isAdmin ? 'admin' : 'user'}/filings/${filingId}/details`, { signal: ctl.signal })
      .then((d) => setData(d.filing))
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [filingId, isAdmin]);

  const kind = (k) => (data ? data.files.filter((f) => f.kind === k) : []);
  const row = (label, value) => (
    <div className="dl-row"><dt>{label}</dt><dd>{value || value === 0 ? value : <span className="muted">—</span>}</dd></div>
  );

  return (
    <Modal title="Filing details" onClose={onClose} wide>
      <button className="modal-x" onClick={onClose} aria-label="Close" title="Close"><i className="fa-solid fa-xmark" /></button>
      {!data && !error && <p className="muted"><i className="fa-solid fa-spinner fa-spin" /> Loading…</p>}
      {error && <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{error}</p>}
      {data && (
        <div className="details">
          <section>
            <h4>{isAdmin ? 'Client' : 'Applicant'}</h4>
            <dl className="dl-grid">
              {row('Name', data.userName)}
              {row('Email', data.userEmail)}
              {row('Contact number', fmtPhone(data.contact))}
              {isAdmin && data.userPhone && data.userPhone !== data.contact ? row('Account phone', fmtPhone(data.userPhone)) : null}
            </dl>
          </section>
          <section>
            <h4>Filing</h4>
            <dl className="dl-grid">
              {row('Filing name', data.name)}
              {row('Filing type', <span className="chip">{data.type}</span>)}
              {row('Filing year', data.year)}
              {row('Status', <StatusBadge status={data.status} />)}
              {row('Submitted', fmtDateTime(data.submittedAt))}
              {row('Last updated', fmtDateTime(data.updatedAt))}
              {row('Filing ID', `#${data.id}`)}
            </dl>
          </section>
          <section>
            <h4>Documents</h4>
            <dl className="dl-grid one">
              {row(isAdmin ? 'Client uploaded' : 'Uploaded by you', <FileLinks files={kind('upload')} empty="None" />)}
              {row(isAdmin ? 'Draft documents (admin)' : 'Draft documents', <FileLinks files={kind('draft')} empty="None yet" />)}
              {row(isAdmin ? 'Upload File / final (admin)' : 'Final documents', <FileLinks files={kind('final')} empty={!isAdmin && data.status !== 'completed' ? 'Released once the filing is completed' : 'None yet'} />)}
            </dl>
            {data.files.length > 0 && (
              <p className="muted small">{data.files.length} document{data.files.length === 1 ? '' : 's'} · {fmtSize(data.files.reduce((s, f) => s + f.size, 0))} in total</p>
            )}
          </section>
          <section>
            <h4>Submission history</h4>
            {data.history.length === 0 ? <p className="muted">No history recorded.</p> : (
              <ul className="history">
                {data.history.map((h, i) => (
                  <li key={i}>
                    <span>{h.fromStatus ? `${STATUS_LABEL[h.fromStatus] || h.fromStatus} → ` : ''}<b>{STATUS_LABEL[h.toStatus] || h.toStatus}</b>{h.note ? <small className="muted"> · {h.note}</small> : null}</span>
                    <small className="muted">{fmtDateTime(h.at)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <div className="modal-actions"><button className="btn outline sm" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

// A client/user name that opens that filing's details. Owns its own open state so every table can just render it.
export function FilingName({ id, name, role }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="name-link" onClick={() => setOpen(true)} title={`${name} – view filing details`}>{name}</button>
      {open && <FilingDetails filingId={id} role={role} onClose={() => setOpen(false)} />}
    </>
  );
}

// Admin "All Users": the name opens the client's profile and the list of their filings; each filing opens its own details.
export function UserName({ id, name }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filing, setFiling] = useState(null);
  useEffect(() => {
    if (!open) return;
    api(`/admin/users/${id}/details`).then(setData).catch((e) => setError(e.message));
  }, [open, id]);
  const close = () => { setOpen(false); setData(null); setError(''); };
  return (
    <>
      <button type="button" className="name-link" onClick={() => setOpen(true)} title="View details">{name}</button>
      {open && !filing && (
        <Modal title="Client details" onClose={close} wide>
          <button className="modal-x" onClick={close} aria-label="Close" title="Close"><i className="fa-solid fa-xmark" /></button>
          {!data && !error && <p className="muted"><i className="fa-solid fa-spinner fa-spin" /> Loading…</p>}
          {error && <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{error}</p>}
          {data && (
            <div className="details">
              <section>
                <h4>Client</h4>
                <dl className="dl-grid">
                  <div className="dl-row"><dt>Name</dt><dd>{data.user.name}</dd></div>
                  <div className="dl-row"><dt>Email</dt><dd>{data.user.email}</dd></div>
                  <div className="dl-row"><dt>Phone</dt><dd>{fmtPhone(data.user.phone) || '—'}</dd></div>
                  <div className="dl-row"><dt>Registered</dt><dd>{fmtDateTime(data.user.registeredAt)}</dd></div>
                </dl>
              </section>
              <section>
                <h4>Filings ({data.filings.length})</h4>
                {data.filings.length === 0 ? <p className="muted">No filings submitted yet.</p> : (
                  <ul className="history">
                    {data.filings.map((f) => (
                      <li key={f.id}>
                        <button type="button" className="name-link" onClick={() => setFiling(f.id)}>{f.name}</button>
                        <span><span className="chip">{f.type}</span> {f.year} <StatusBadge status={f.status} /></span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
          <div className="modal-actions"><button className="btn outline sm" onClick={close}>Close</button></div>
        </Modal>
      )}
      {filing && <FilingDetails filingId={filing} role="admin" onClose={() => setFiling(null)} />}
    </>
  );
}
