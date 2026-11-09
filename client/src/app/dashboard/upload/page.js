'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, FILING_TYPES, filingYears, ALLOWED_EXT, MAX_FILE_MB, MAX_FILES, fmtSize, fileProblem, VTPhone, fmtPhone, loadPublicConfig } from '@/lib/api';
import { useToast } from '@/components/Shell';
import PageHeader from '@/components/PageHeader';
import PhoneField from '@/components/PhoneField';
import { IconBtn } from '@/components/DataTable';

// Same rules for submitting and editing (the server enforces them again).
function validateDetails(v, country, skipPhone) {
  if (!v.name.trim() || v.name.trim().length > 150) return 'Filing name is required.';
  if (!FILING_TYPES.includes(v.type)) return 'Select a valid filing type.';
  const y = Number(v.year);
  if (!/^\d{4}$/.test(String(v.year).trim()) || y < 2000 || y > new Date().getFullYear() + 1) return 'Select a valid filing year.';
  if (skipPhone) return '';
  const p = VTPhone.parse(v.contact, country);
  return p.ok ? '' : p.error;
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
  // Edit mode: the filing's current documents. Nothing is changed on the server until "Save Changes";
  // removed = marked for removal, replacement = a newly chosen File that will replace it.
  const [docs, setDocs] = useState([]);
  const docInput = useRef(null);
  const replacing = useRef(null);
  const [reviewing, setReviewing] = useState(false);
  // Contact number: free text + selected country. defaultCountry only pre-selects the dropdown; any country is accepted.
  const [contact, setContact] = useState({ text: '', country: 'US' });
  const [phoneErr, setPhoneErr] = useState(false);
  const touched = useRef(false);
  useEffect(() => {
    loadPublicConfig().then((c) => { if (!touched.current && !editing) setContact((p) => ({ ...p, country: c.defaultCountry || p.country })); });
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    api(`/user/filings/${editId}`)
      .then(({ filing }) => {
        if (!filing.editable) return setBlocked('This filing is completed and can no longer be edited. You can still view it under My Filings.');
        const v = { name: filing.name, type: filing.type, year: String(filing.year), contact: filing.contact };
        // Pre-fill the saved number as country + national digits; a value that cannot be read is shown as-is.
        const parts = VTPhone.split(filing.contact);
        setContact(parts ? { text: parts.national, country: parts.country || 'US' } : { text: filing.contact, country: 'US' });
        setDocs((filing.files || []).map((f) => ({ id: f.id, name: f.name, removed: false, replacement: null })));
        setValues(v); setOriginal(v); setLoaded(true);
      })
      .catch((e) => setBlocked(e.message));
  }, [editing, editId]);

  // ---- existing documents (edit mode) ----
  const patchDoc = (id, change) => setDocs((list) => list.map((d) => (d.id === id ? { ...d, ...change } : d)));
  const kept = docs.filter((d) => !d.removed).length;
  function removeDoc(d) {
    if (kept <= 1) return setError('A filing must keep at least one document. Use the pen icon to replace it with another file instead.');
    setError(''); patchDoc(d.id, { removed: true, replacement: null });
  }
  function chooseReplacement(d) { replacing.current = d.id; docInput.current.click(); }
  function onReplacement(e) {
    const f = e.target.files[0];
    e.target.value = '';
    const id = replacing.current;
    if (!f || id == null) return;
    const p = fileProblem(f);
    if (p) return setError(p);
    setError(''); patchDoc(id, { replacement: f, removed: false });
  }
  const docChanges = docs.filter((d) => d.removed || d.replacement);

  // New files are ADDED to the current selection (never replace it). Each one is checked against the type / size rules;
  // invalid, duplicate or over-limit files are skipped with a message and the valid ones are kept.
  function addFiles(picked) {
    const issues = [];
    const next = [...files];
    for (const f of picked) {
      const p = fileProblem(f);
      if (p) { issues.push(p); continue; }
      if (next.some((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified)) { issues.push(`"${f.name}" is already selected.`); continue; }
      if (next.length >= MAX_FILES) { issues.push(`You can upload up to ${MAX_FILES} files per filing.`); break; }
      next.push(f);
    }
    setFiles(next);
    setError(issues.join(' '));
  }
  const onPick = (e) => { const picked = Array.from(e.target.files); e.target.value = ''; addFiles(picked); };
  const onDrop = (e) => { e.preventDefault(); setOver(false); addFiles(Array.from(e.dataTransfer.files)); };
  const remove = (idx) => { setFiles((list) => list.filter((_, i) => i !== idx)); setError(''); };

  function problem() {
    if (files.length === 0) return 'Please choose at least one file.';
    if (files.length > MAX_FILES) return `You can upload up to ${MAX_FILES} files at once.`;
    for (const f of files) {
      const p = fileProblem(f);
      if (p) return p;
    }
    return '';
  }

  const read = (form) => ({ ...Object.fromEntries(['name', 'type', 'year'].map((k) => [k, form.elements[k].value])), contact: contact.text });

  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = read(form);
    // An older saved number that cannot be read as an international number may stay as it is while other details are edited.
    const keepSaved = editing && original && !VTPhone.split(original.contact) && v.contact === original.contact;
    const msg = validateDetails(v, contact.country, keepSaved) || (editing ? '' : problem());
    setPhoneErr(!keepSaved && Boolean(VTPhone.parse(v.contact, contact.country).error));
    if (msg) return setError(msg);
    setError('');
    // Normalise to E.164 (+<country code><number>) for the review screen and the API.
    if (!keepSaved) v.contact = VTPhone.parse(v.contact, contact.country).e164;
    if (editing) { setValues(v); setReviewing(true); return; }
    setBusy(true);
    const body = new FormData();
    for (const k of ['name', 'type', 'year', 'contact']) body.append(k, v[k]);
    body.append('contactCountry', contact.country);
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
      // Documents first (replacements, then removals); only now are the originals actually replaced or removed.
      for (const d of docs.filter((x) => x.replacement)) {
        const body = new FormData();
        body.append('files', d.replacement);
        await api(`/user/files/${d.id}`, { method: 'PUT', body });
      }
      for (const d of docs.filter((x) => x.removed)) await api(`/user/files/${d.id}`, { method: 'DELETE' });
      const r = await api(`/user/filings/${editId}`, { method: 'PUT', body: { ...values, contactCountry: contact.country } });
      toast(r.unchanged && docChanges.length === 0 ? 'No changes to save.' : 'Filing updated successfully.');
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
                <span>{label}</span><span>{k === 'contact' ? fmtPhone(values[k]) : values[k]}</span>
              </li>
            ))}
            {docChanges.map((d) => (
              <li key={d.id} className="changed">
                <span>Document</span><span>{d.replacement ? `${d.name} → ${d.replacement.name}` : `${d.name} (removed)`}</span>
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
        subtitle={editing ? 'Correct the details of your submitted filing. You can also replace or remove its documents below.' : 'Tell us about your return and attach your tax documents. Files are encrypted in transit and stored privately.'}
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
            <div className="field">
              <label htmlFor="year">Filing Year</label>
              <select id="year" name="year" className="select" required defaultValue={values.year}>
                <option value="" disabled>Select Year</option>
                {filingYears(values.year).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <PhoneField id="contact" label="Contact Number" required value={contact} error={phoneErr}
            onChange={(c) => { touched.current = true; setPhoneErr(false); setContact(c); }} />
          {editing && docs.length > 0 && (
            <div className="field">
              <label>Uploaded documents</label>
              <input ref={docInput} type="file" hidden accept={ALLOWED_EXT.map((e) => `.${e}`).join(',')} onChange={onReplacement} />
              <ul className="chosen doc-edit">
                {docs.map((d) => (
                  <li key={d.id} className={d.removed ? 'removed' : ''}>
                    <span className="f"><i className="fa-solid fa-file-lines" /><span>{d.replacement ? d.replacement.name : d.name}<small>{d.removed ? 'Will be removed when you save' : d.replacement ? `New file · ${fmtSize(d.replacement.size)} · replaces ${d.name}` : 'Current file'}</small></span></span>
                    <span className="icon-acts">
                      {d.removed
                        ? <button type="button" className="link-btn plain" onClick={() => patchDoc(d.id, { removed: false })}>Undo</button>
                        : (
                          <>
                            <IconBtn icon="fa-pen" tone="edit" label={`Replace ${d.name}`} onClick={() => chooseReplacement(d)} />
                            <IconBtn icon="fa-xmark" tone="delete" label={`Remove ${d.replacement ? d.replacement.name : d.name}`} onClick={() => (d.replacement ? patchDoc(d.id, { replacement: null }) : removeDoc(d))} />
                          </>
                        )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted field-hint">Changes to documents are applied only when you save. Cancel keeps your original files.</p>
            </div>
          )}
          {!editing && (
            <div className="field">
              <label htmlFor="files">Documents</label>
              <label
                htmlFor="files" className={`dropzone${over ? ' over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
              >
                <i className="fa-solid fa-cloud-arrow-up" />
                <strong>{files.length ? "Add more files: drag & drop here, or click to browse" : "Drag & drop files here, or click to browse"}</strong>
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
