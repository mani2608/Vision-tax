'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, FILING_TYPES, ALLOWED_EXT, MAX_FILE_MB, MAX_FILES, fmtSize } from '@/lib/api';
import { useToast } from '@/components/Shell';
import PageHeader from '@/components/PageHeader';

export default function UploadFiling() {
  const router = useRouter();
  const toast = useToast();
  const input = useRef(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);

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
      const ext = f.name.split('.').pop().toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) return `"${f.name}" is not an allowed file type (${ALLOWED_EXT.join(', ')}).`;
      if (f.size > MAX_FILE_MB * 1024 * 1024) return `"${f.name}" is larger than ${MAX_FILE_MB} MB.`;
    }
    return '';
  }

  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const msg = problem();
    if (msg) return setError(msg);
    setError(''); setBusy(true);
    const body = new FormData();
    for (const k of ['name', 'type', 'year', 'contact']) body.append(k, form.elements[k].value);
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

  const total = files.reduce((s, f) => s + f.size, 0);

  return (
    <>
      <PageHeader title="Apply for Filing" subtitle="Tell us about your return and attach your tax documents. Files are encrypted in transit and stored privately." />
      <form className="card form-grid" onSubmit={submit} noValidate style={{ padding: 28 }}>
        <div>
          <h2 className="panel-title">Filing details</h2>
          <div className="field"><label htmlFor="name">Filing Name</label><input id="name" name="name" className="input" required maxLength={150} placeholder="e.g. 2025 Federal Return" /></div>
          <div className="row-2">
            <div className="field">
              <label htmlFor="type">Type</label>
              <select id="type" name="type" className="select" required defaultValue="">
                <option value="" disabled>Select Type</option>
                {FILING_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="year">Filing Year</label><input id="year" name="year" className="input" inputMode="numeric" maxLength={4} required placeholder="2025" /></div>
          </div>
          <div className="field"><label htmlFor="contact">Contact Number</label><input id="contact" name="contact" className="input" inputMode="tel" maxLength={20} required placeholder="+1 555 000 0000" /></div>
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
          {error && <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{error}</p>}
          <button className="btn block" disabled={busy}><i className="fa-solid fa-paper-plane" />{busy ? 'Submitting…' : 'Submit filing'}</button>
        </div>
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
      </form>
    </>
  );
}
