'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api, initials } from '@/lib/api';
import Notifications from './Notifications';

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
const UserCtx = createContext(null);
export const useUser = () => useContext(UserCtx);

const NAV = {
  user: [
    { href: '/dashboard', label: 'Dashboard', icon: 'fa-house', exact: true },
    { href: '/dashboard/forms', label: 'Download Tax Information Form', icon: 'fa-clipboard-list' },
    { href: '/dashboard/upload', label: 'Uploads Filing Documents', icon: 'fa-upload' },
    { href: '/dashboard/filings', label: 'View My Filings', icon: 'fa-folder-open' },
    { href: '/dashboard/payments', label: 'Payments', icon: 'fa-credit-card' },
    { href: '/dashboard/drafts', label: 'Download Tax Return Draft Copy', icon: 'fa-file-arrow-down' },
    { href: '/dashboard/finals', label: 'Download Tax Return Final Copy', icon: 'fa-cloud-arrow-down' },
  ],
  admin: [
    { href: '/admin', label: 'Dashboard', icon: 'fa-house', exact: true },
    { href: '/admin/pending', label: 'Pending Filing', icon: 'fa-clock' },
    { href: '/admin/ongoing', label: 'Ongoing Filing', icon: 'fa-hourglass-half' },
    { href: '/admin/completed', label: 'Completed Filings', icon: 'fa-circle-check' },
    { href: '/admin/users', label: 'User List', icon: 'fa-users' },
    { href: '/admin/qr', label: 'QR Code Management', icon: 'fa-qrcode' },
    { href: '/admin/upi', label: 'UPI Management', icon: 'fa-indian-rupee-sign' },
    { href: '/admin/references', label: 'Payment References', icon: 'fa-file-invoice' },
    { href: '/admin/payments', label: 'Payment History', icon: 'fa-money-bill-transfer' },
  ],
};

function useTheme() {
  const [theme, setTheme] = useState('light');
  useEffect(() => { setTheme(document.documentElement.dataset.theme || 'light'); }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('vt-theme', next); } catch { /* storage unavailable: theme just won't persist */ }
    setTheme(next);
  };
  return [theme, toggle];
}

export default function Shell({ role, children }) {
  const path = usePathname();
  const [user, setUser] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [theme, toggleTheme] = useTheme();
  const menuRef = useRef(null);

  const toast = useCallback((message, type = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  // Guard: confirm the session on mount and whenever the page is restored from the back/forward cache
  useEffect(() => {
    let alive = true;
    const check = () =>
      api('/auth/me')
        .then(({ user: u }) => {
          if (!alive) return;
          if (u.mustChangePassword) return window.location.replace('/change-password');
          if (u.role !== role) return window.location.replace(u.role === 'admin' ? '/admin' : '/dashboard');
          setUser(u);
        })
        .catch((e) => {
          if (e.name === 'AbortError') return;
          if (e.code === 'PASSWORD_CHANGE_REQUIRED') return window.location.replace('/change-password');
          if (e.status === 401 || e.status === 403) { setUser(null); window.location.replace('/signin.html'); }
        });
    check();
    const onShow = (e) => { if (e.persisted) check(); };
    window.addEventListener('pageshow', onShow);
    return () => { alive = false; window.removeEventListener('pageshow', onShow); };
  }, [role]);

  useEffect(() => { setOpen(false); setMenu(false); }, [path]);

  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);

  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* cookie is cleared server-side when reachable */ }
    setUser(null);
    window.location.replace('/signin.html');
  }

  if (!user) return <div className="loading"><i className="fa-solid fa-spinner fa-spin" aria-label="Loading" /></div>;

  const items = NAV[role];
  const isActive = (i) => (i.exact ? path === i.href : path === i.href || path.startsWith(i.href + '/'));
  const current = items.find(isActive);
  const homeHref = role === 'admin' ? '/admin' : '/dashboard';
  const displayName = role === 'admin' ? 'VisionTax Admin' : user.name;

  return (
    <UserCtx.Provider value={user}>
      <ToastCtx.Provider value={toast}>
        <div className={`shell${collapsed ? ' collapsed' : ''}${open ? ' open' : ''}`}>
          <aside className="sidebar" aria-label="Main navigation">
            <div className="sidebar-top">
              <Link href={homeHref} className="brand">
                <img src="/assets/images/logo.png" alt="" />
                <span>Vision<b>Tax</b></span>
              </Link>
              <button className="icon-btn collapse-btn" onClick={() => setCollapsed((c) => !c)} aria-label="Collapse sidebar">
                <i className={`fa-solid ${collapsed ? 'fa-angles-right' : 'fa-angles-left'}`} />
              </button>
            </div>
            <nav className="nav">
              <div className="nav-label">{role === 'admin' ? 'Administration' : 'My Account'}</div>
              {items.map((i) => (
                <Link key={i.href} href={i.href} className={`nav-item${isActive(i) ? ' active' : ''}`} aria-current={isActive(i) ? 'page' : undefined} title={i.label}>
                  <i className={`fa-solid ${i.icon}`} /><span>{i.label}</span>
                </Link>
              ))}
              <div className="nav-label" style={{ marginTop: 10 }}>Session</div>
              <button className="nav-item logout" onClick={logout} title="Logout">
                <i className="fa-solid fa-right-from-bracket" /><span>Logout</span>
              </button>
            </nav>
            <div className="sidebar-foot">
              <div className="help-card">
                <strong>Need help?</strong>
                Our tax team is happy to assist. <a href="/contact.html">Contact us →</a>
              </div>
            </div>
          </aside>
          <div className="overlay" onClick={() => setOpen(false)} />
          <div className="main">
            <header className="header">
              <div className="crumbs">
                <button className="icon-btn hamburger" onClick={() => setOpen(true)} aria-label="Open menu"><i className="fa-solid fa-bars" /></button>
                <span>{role === 'admin' ? 'Admin' : 'Portal'}</span>
                <i className="fa-solid fa-chevron-right" aria-hidden />
                <b>{current ? current.label : 'Dashboard'}</b>
              </div>
              <div className="header-actions">
                <Notifications onNew={(m) => toast(m)} paymentsHref={role === 'admin' ? '/admin/payments' : '/dashboard/payments'} />
                <button className="icon-btn theme-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title="Toggle theme">
                  <i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`} />
                </button>
                <div className="profile-wrap" ref={menuRef}>
                  <button className="profile" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
                    <span className="avatar" aria-hidden>{role === 'admin' ? 'VA' : initials(user.name)}</span>
                    <span className="who">{displayName}<small>{role === 'admin' ? 'Administrator' : 'Client'}</small></span>
                    <i className="fa-solid fa-chevron-down" style={{ fontSize: '.65rem', color: 'var(--muted)' }} aria-hidden />
                  </button>
                  {menu && (
                    <div className="menu" role="menu">
                      <div className="menu-head"><strong>{displayName}</strong><span>{user.email}</span></div>
                      <Link href="/change-password" role="menuitem"><i className="fa-solid fa-key" /> Change password</Link>
                      <a href="/index.html" role="menuitem"><i className="fa-solid fa-house" /> Return to Website</a>
                      <button className="danger" onClick={logout} role="menuitem"><i className="fa-solid fa-right-from-bracket" /> Logout</button>
                    </div>
                  )}
                </div>
              </div>
            </header>
            <main className="content" key={path}>{children}</main>
          </div>
          <div className="toasts" role="status" aria-live="polite">
            {toasts.map((t) => (
              <div key={t.id} className={`toast${t.type === 'error' ? ' error' : ''}`}>
                <i className={`fa-solid ${t.type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}`} />{t.message}
              </div>
            ))}
          </div>
        </div>
      </ToastCtx.Provider>
    </UserCtx.Provider>
  );
}
