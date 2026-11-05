'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import VTPhone from '../../public/assets/js/phone-core.js';

// Searchable country selector + phone input. Controlled: { text, country } in, onChange({ text, country }) out.
// Validation is VTPhone.parse (libphonenumber data), the same rules the API applies.
export default function PhoneField({ id = 'phone', label, value, onChange, error, required }) {
  const all = useMemo(() => VTPhone.countries(), []);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef(null);
  const search = useRef(null);
  const country = value.country;
  const current = all.find((c) => c.iso === country);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const needle = q.trim().toLowerCase().replace(/^\+/, '');
  const shown = needle
    ? all.filter((c) => c.name.toLowerCase().includes(needle) || c.iso.toLowerCase() === needle || c.callingCode.startsWith(needle))
    : all;

  const pick = (iso) => { onChange({ text: value.text, country: iso }); setOpen(false); setQ(''); };
  const type = (text) => {
    // "+44 ..." switches the selector to the United Kingdom, so what you see is what is submitted.
    let next = country;
    if (text.trim().startsWith('+')) { const r = VTPhone.parse(text); if (r.ok && r.country) next = r.country; }
    onChange({ text, country: next });
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="vt-phone">
        <div className="vt-cc" ref={box}>
          <button type="button" className="input vt-cc-btn" aria-haspopup="listbox" aria-expanded={open} aria-label="Country code"
            title={current ? `${current.name} (+${current.callingCode})` : ''}
            onClick={() => { setOpen((o) => !o); setTimeout(() => search.current && search.current.focus(), 0); }}>
            <span className="vt-cc-iso">{country}</span>
            <span>+{current ? current.callingCode : ''}</span>
            <i className="fa-solid fa-chevron-down vt-cc-caret" aria-hidden="true" />
          </button>
          {open && (
            <div className="vt-cc-panel">
              <input ref={search} type="search" className="vt-cc-search" placeholder="Search country or code" aria-label="Search country or dialing code"
                value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                  if (e.key === 'Enter') { e.preventDefault(); if (shown[0]) pick(shown[0].iso); }
                }} />
              <ul className="vt-cc-list" role="listbox">
                {shown.map((c) => (
                  <li key={c.iso} role="option" aria-selected={c.iso === country} className={`vt-cc-item${c.iso === country ? ' on' : ''}`} onClick={() => pick(c.iso)}>
                    <span>{c.name}</span><span className="vt-cc-dial">+{c.callingCode}</span>
                  </li>
                ))}
                {!shown.length && <li className="vt-cc-none">No matching country</li>}
              </ul>
            </div>
          )}
        </div>
        <input id={id} name={id} type="tel" inputMode="tel" autoComplete="tel-national" className={`input${error ? ' vt-phone-bad' : ''}`}
          required={required} aria-invalid={error ? 'true' : undefined} placeholder="Phone number"
          value={value.text} onChange={(e) => type(e.target.value)} />
      </div>
      <small className="muted">Choose the country, or type the number with its country code (e.g. +91 98765 43210).</small>
    </div>
  );
}
