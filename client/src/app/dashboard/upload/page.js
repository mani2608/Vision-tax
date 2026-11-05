'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, FILING_TYPES, ALLOWED_EXT, MAX_FILE_MB, MAX_FILES, fmtSize, fileProblem, normalizePhone, loadPublicConfig } from '@/lib/api';
import { useToast } from '@/components/Shell';
import PageHeader from '@/components/PageHeader';

// Same rules for submitting and editing (the server enforces them again).
function validateDetails(v, region) {
  if (!v.name.trim() || v.name.trim().length > 150) return 'Filing name is required.';
  if (!FILING_TYPES.includes(v.type)) return 'Select a valid filing type.';
  const y = Number(v.year);
  if (!/^\d{4}$/.test(String(v.year).trim()) || y < 2000 || y > new Date().getFullYear() + 1) return 'Enter a valid filing year.';
  const p = normalizePhone(v.contact, region);
  return p.error || '';
}

function UploadFiling() {
  const router = useRouter();
  const toast = useToast();
  const editId = useSearchParams().get('edit');
  const editing = Boolean(editId);

  const input = useRef(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  // Edit mode state
  const [loaded, setLoaded] = useState(!editing);
  const [blocked, setBlocked] = useState('');
  const [values, setValues] = useState({ name: '', type: '', year: '', contact: '' });
  const [original, setOriginal] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [phone, setPhone] = useState({ phoneRegion: 'US', phonePlaceholder: '+1 (212) 555-1234' });
  useEffect(() => { loadPublicConfig().then(setPhone); }, []);

  useEffect(() => {
    if (!editing) return;
    api(`/user/filings/${editId}`)
      .then(({ filing }) => {
        if (!filing.editable) return setBlocked('This filing is completed and can no longer be edited. You can still view it under My Filings.');
        const v = { name: filing.name, type: filing.type, year: String(filing.year), contact: filing.contact };
        setValues(v); setOriginal(v); setLoaded(true);
      })
      .catch((e) => setBlocked(e.message));
  }, [editing, editId]);

  const onPick = (e) => setFiles(Array.from(e.target.files));
  const onDrop = (e) => {
    e.preventDefault(); setOver(false);
    input.current.files = e.dataTransfer.files;
    setFiles(Array.from(e.dataTransfer.files));
  };
  const remove = (idx) => {
    const dt = new DataTransfer();
    files.forEach((f, i) => i !== idx && dt.items.add(f));
    input.current.files = dt.files;
    setFiles(Array.from(dt.files));
  };

  function problem() {
    if (files.length === 0) return 'Please choose at least one file.';
    if (files.length > MAX_FILES) return `You can upload up to ${MAX_FILES} files at once.`;
    for (const f of files) {
      const p = fileProblem(f);
      if (p) return p;
    }
    return '';
  }

  const read = (form) => Object.fromEntries(['name', 'type', 'year', 'contact'].map((k) => [k, form.elements[k].value]));

  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = read(form);
    const msg = validateDetails(v, phone.phoneRegion) || (editing ? '' : problem());
    if (msg) return setError(msg);
    setError('');
    if (editing) { setValues(v); setReviewing(true); return; }
    setBusy(true);
    const body = new FormData();
    for (const k of ['name', 'type', 'year', 'contact']) body.append(k, v[k]);
    files.forEach((f) => body.append('files', f));
    try {
      await api('/user/filings', { method: 'POST', body });
      toast('Filing submitted successfully.');
      router.push('/dashboard/filings');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function saveChanges() {
    setBusy(true); setError('');
    try {
      const r = await api(`/user/filings/${editId}`, { method: 'PUT', body: values });
      toast(r.unchanged ? 'No changes to save.' : 'Filing updated successfully.');
      router.push('/dashboard/filings');
    } catch (err) {
      setError(err.message);
      setBusy(false);
      setReviewing(false);
    }
  }

  const total = files.reduce((s, f) => s + f.size, 0);

  if (editing && blocked) {
    return (
      <>
        <PageHeader title="Edit Filing" subtitle="Correct a filing you have already submitted." />
        <div className="card" style={{ padding: 28 }}>
          <p role="alert" className="alert"><i className="fa-solid fa-lock" />{blocked}</p>
          <Link href="/dashboard/filings" className="btn outline">Back to My Filings</Link>
        </div>
      </>
    );
  }
  if (!loaded) return <div className="loading"><i className="fa-solid fa-spinner fa-spin" aria-label="Loading" /></div>;

  if (editing && reviewing) {
    const rows = [['Filing Name', 'name'], ['Type', 'type'], ['Filing Year', 'year'], ['Contact Number', 'contact']];
    return (
      <>
        <PageHeader title="Review changes" subtitle="Check the updated details, then save." />
        <div className="card" style={{ padding: 28, maxWidth: 560 }}>
          <ul className="review">
            {rows.map(([label, k]) => (
              <li key={k} className={values[k] !== original[k] ? 'changed' : ''}>
                <span>{label}</span><span>{k === 'contact' ? (normalizePhone(values[k], phone.phoneRegion).value || values[k]) : values[k]}</span>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{error}</p>}
          <div className="inline-actions">
            <button className="btn outline" onClick={() => setReviewing(false)} disabled={busy}>Back</button>
            <button className="btn" onClick={saveChanges} disabled={busy}><i className="fa-solid fa-floppy-disk" />{busy ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={editing ? 'Edit Filing' : 'Apply for Filing'}
        subtitle={editing ? 'Correct the details of your submitted filing. Documents can be replaced from My Filings.' : 'Tell us about your return and attach your tax documents. Files are encrypted in transit and stored privately.'}
      />
      <form className={editing ? 'card' : 'card form-grid'} onSubmit={submit} noValidate style={{ padding: 28, ...(editing ? { maxWidth: 560 } : {}) }}>
        <div>
          <h2 className="panel-title">Filing details</h2>
          <div className="field"><label htmlFor="name">Filing Name</label><input id="name" name="name" className="input" required maxLength={150} placeholder="e.g. 2025 Federal Return" defaultValue={values.name} /></div>
          <div className="row-2">
            <div className="field">
              <label htmlFor="type">Type</label>
              <select id="type" name="type" className="select" required defaultValue={values.type}>
                <option value="" disabled>Select Type</option>
                {FILING_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="year">Filing Year</label><input id="year" name="year" className="input" inputMode="numeric" maxLength={4} required placeholder="2025" defaultValue={values.year} /></div>
          </div>
          <div className="field"><label htmlFor="contact">Contact Number</label><input id="contact" name="contact" className="input" inputMode="tel" maxLength={20} required placeholder={phone.phonePlaceholder} defaultValue={values.contact} /></div>
          {!editing && (
            <div className="field">
              <label htmlFor="files">Documents</label>
              <label
                htmlFor="files" className={`dropzone${over ? ' over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
              >
                <i className="fa-solid fa-cloud-arrow-up" />
                <strong>Drag &amp; drop files here, or click to browse</strong>
                <small>{ALLOWED_EXT.join(', ').toUpperCase()} · up to {MAX_FILES} files · {MAX_FILE_MB} MB each</small>
                <input id="files" ref={input} type="file" multiple accept={ALLOWED_EXT.map((e) => `.${e}`).join(',')} onChange={onPick} />
              </label>
            </div>
          )}
          {error && <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{error}</p>}
          {editing ? (
            <div className="inline-actions">
              <Link href="/dashboard/filings" className="btn outline">Cancel</Link>
              <button className="btn"><i className="fa-solid fa-eye" />Review changes</button>
            </div>
          ) : (
            <button className="btn block" disabled={busy}><i className="fa-solid fa-paper-plane" />{busy ? 'Submitting…' : 'Submit filing'}</button>
          )}
        </div>
        {!editing && (
          <div>
            <h2 className="panel-title">Files {files.length > 0 && <span className="chip">{files.length} · {fmtSize(total)}</span>}</h2>
            {files.length === 0 && <p className="muted">Selected files will be listed here.</p>}
            <ul className="chosen">
              {files.map((f, i) => (
                <li key={f.name + i}>
                  <span className="f"><i className="fa-solid fa-file-lines" /><span>{f.name}<small>{fmtSize(f.size)}</small></span></span>
                  <button type="button" className="link-btn" onClick={() => remove(i)}>Remove</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="loading"><i className="fa-solid fa-spinner fa-spin" aria-label="Loading" /></div>}><UploadFiling /></Suspense>;
}
