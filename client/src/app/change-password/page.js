'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function ChangePassword() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/auth/me').then(() => setReady(true)).catch(() => window.location.replace('/signin.html'));
  }, []);

  async function submit(e) {
    e.preventDefault();
    const f = e.currentTarget.elements;
    if (f.next.value !== f.confirm.value) return setError('New passwords do not match.');
    setBusy(true); setError('');
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: f.current.value, newPassword: f.next.value } });
      const { user } = await api('/auth/me');
      window.location.replace(user.role === 'admin' ? '/admin' : '/dashboard');
    } catch (err) { setError(err.message); setBusy(false); }
  }

  if (!ready) return <div className="loading"><i className="fa-solid fa-spinner fa-spin" /></div>;
  return (
    <div className="center-page">
      <form className="card center-card" onSubmit={submit}>
        <span className="stat-icon g-violet" style={{ marginBottom: 16 }}><i className="fa-solid fa-shield-halved" /></span>
        <h1 className="page-title" style={{ fontSize: '1.45rem' }}>Change your password</h1>
        <p className="page-sub" style={{ marginBottom: 20 }}>For security, set a new password before continuing.</p>
        <div className="field"><label htmlFor="current">Current password</label><input id="current" name="current" type="password" className="input" required autoComplete="current-password" /></div>
        <div className="field"><label htmlFor="next">New password</label><input id="next" name="next" type="password" className="input" required autoComplete="new-password" /></div>
        <div className="field"><label htmlFor="confirm">Confirm new password</label><input id="confirm" name="confirm" type="password" className="input" required autoComplete="new-password" /></div>
        <p className="muted" style={{ fontSize: '.85rem' }}>8+ characters with an uppercase letter, a number and a symbol.</p>
        {error && <p role="alert" className="alert"><i className="fa-solid fa-circle-exclamation" />{error}</p>}
        <button className="btn block" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
      </form>
    </div>
  );
}
