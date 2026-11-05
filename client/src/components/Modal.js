'use client';
import { useEffect } from 'react';

// Minimal accessible dialog used for confirmations. Closes on Escape or backdrop click (unless busy).
export default function Modal({ title, children, onClose, busy = false }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose, busy]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal-box" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}
