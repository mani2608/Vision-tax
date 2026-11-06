/**
 * Vision-Tax public site: logged-in account menu (shared by Client and Admin).
 * Asks the server who is signed in (GET /api/auth/me, httpOnly cookie, nothing stored in the browser).
 * Signed out -> the page is left exactly as designed. Signed in -> Sign In / Sign Up are replaced by the account dropdown.
 * Password change and logout reuse the existing endpoints: POST /api/auth/change-password and POST /api/auth/logout.
 */
(function () {
  'use strict';

  var HOME = '/index.html';
  var STRONG = function (s) { return s.length >= 8 && s.length <= 128 && /[A-Z]/.test(s) && /[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s); };

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function icon(cls) { return el('i', { class: 'fa-solid ' + cls, 'aria-hidden': 'true' }); }
  function initials(name) {
    var p = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return p.map(function (s) { return s[0].toUpperCase(); }).join('') || 'U';
  }
  function toast(type, title, msg) {
    if (window.VTNotify && window.VTNotify.toast) window.VTNotify.toast(type, title, msg, { duration: 3500 });
  }
  function post(path, body) {
    return fetch('/api/' + path, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.'); return d; }); });
  }

  function logout() {
    post('auth/logout').catch(function () { /* cookie is cleared server-side when reachable */ }).then(function () {
      if (/\/(index\.html)?$/.test(location.pathname)) location.reload(); else location.href = HOME;
    });
  }

  // ---- Change password modal ----
  function passwordField(id, label, autocomplete) {
    var input = el('input', { type: 'password', id: id, autocomplete: autocomplete, required: 'required' });
    var eye = el('button', { type: 'button', class: 'am-eye', 'aria-label': 'Show ' + label.toLowerCase(), title: 'Show / hide' }, [icon('fa-eye')]);
    eye.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.firstChild.className = 'fa-solid ' + (show ? 'fa-eye-slash' : 'fa-eye');
      eye.setAttribute('aria-label', (show ? 'Hide ' : 'Show ') + label.toLowerCase());
    });
    return { input: input, node: el('div', { class: 'am-field' }, [el('label', { for: id, text: label }), el('div', { class: 'am-input' }, [input, eye])]) };
  }

  function openPasswordModal() {
    var cur = passwordField('am-cur', 'Current Password', 'current-password');
    var nxt = passwordField('am-new', 'New Password', 'new-password');
    var cnf = passwordField('am-cnf', 'Confirm New Password', 'new-password');
    var err = el('p', { class: 'am-error', role: 'alert' });
    var hint = el('p', { class: 'am-hint', text: 'Use 8+ characters with an uppercase letter, a number and a symbol.' });
    var submit = el('button', { type: 'submit', class: 'am-btn am-btn-primary', text: 'Update Password' });
    var cancel = el('button', { type: 'button', class: 'am-btn am-btn-ghost', text: 'Cancel' });
    var form = el('form', { novalidate: 'novalidate' }, [cur.node, nxt.node, hint, cnf.node, err, el('div', { class: 'am-actions' }, [cancel, submit])]);
    var close = el('button', { type: 'button', class: 'am-x', 'aria-label': 'Close' }, [icon('fa-xmark')]);
    var box = el('div', { class: 'am-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'am-title' }, [
      el('div', { class: 'am-modal-head' }, [el('h3', { id: 'am-title', text: 'Change Password' }), close]), form,
    ]);
    var overlay = el('div', { class: 'am-overlay' }, [box]);
    function shut() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') shut(); }
    close.addEventListener('click', shut); cancel.addEventListener('click', shut);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) shut(); });
    document.addEventListener('keydown', onKey);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.textContent = '';
      var a = cur.input.value, b = nxt.input.value, c = cnf.input.value;
      if (!a || !b || !c) { err.textContent = 'Please fill in all three fields.'; return; }
      if (!STRONG(b)) { err.textContent = 'Use 8+ characters with an uppercase letter, a number and a symbol.'; return; }
      if (b !== c) { err.textContent = 'The new password and confirmation do not match.'; return; }
      if (b === a) { err.textContent = 'The new password must differ from the current one.'; return; }
      submit.disabled = true; submit.textContent = 'Updating…';
      post('auth/change-password', { currentPassword: a, newPassword: b }).then(function () {
        shut();
        toast('success', 'Password updated', 'Your password was changed. You are still signed in.');
      }).catch(function (x) {
        err.textContent = x.message; submit.disabled = false; submit.textContent = 'Update Password';
      });
    });
    document.body.appendChild(overlay);
    cur.input.focus();
  }

  // ---- Dropdown ----
  function buildMenu(user) {
    var isAdmin = user.role === 'admin';
    var roleLabel = isAdmin ? 'Admin' : 'Client';
    var dash = isAdmin ? '/admin' : '/dashboard';

    var avatar = el('span', { class: 'am-avatar', 'aria-hidden': 'true', text: initials(user.name) });
    var who = el('span', { class: 'am-who' }, [el('span', { class: 'am-name', text: user.name }), el('small', { text: roleLabel })]);
    var trigger = el('button', { type: 'button', class: 'am-trigger', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [avatar, who, icon('fa-chevron-down am-caret')]);

    function item(iconCls, label, cls) { return el('button', { type: 'button', role: 'menuitem', class: 'am-item' + (cls ? ' ' + cls : '') }, [icon(iconCls), el('span', { text: label })]); }
    var changePw = item('fa-key', 'Change Password');
    var dashBtn = item('fa-gauge', 'Dashboard');
    var out = item('fa-right-from-bracket', 'Logout', 'am-danger');

    var panel = el('div', { class: 'am-panel', role: 'menu' }, [
      el('div', { class: 'am-head' }, [el('span', { class: 'am-avatar am-avatar-lg', 'aria-hidden': 'true', text: initials(user.name) }),
        el('div', { class: 'am-head-text' }, [el('strong', { text: user.name }), el('span', { text: user.email })])]),
      el('div', { class: 'am-sep' }), dashBtn, changePw, el('div', { class: 'am-sep' }), out,
    ]);
    var wrap = el('div', { class: 'am-wrap', 'data-role': user.role }, [trigger, panel]);

    function setOpen(open) { wrap.classList.toggle('open', open); trigger.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    trigger.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!wrap.classList.contains('open')); });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    changePw.addEventListener('click', function () { setOpen(false); openPasswordModal(); });
    dashBtn.addEventListener('click', function () { setOpen(false); location.href = dash; });
    out.addEventListener('click', function () { setOpen(false); logout(); });
    return wrap;
  }

  // ---- Mobile drawer: same actions as plain links ----
  function mobileBlock(user) {
    var isAdmin = user.role === 'admin';
    function row(iconCls, label, fn, cls) { var b = el('button', { type: 'button', class: 'am-drawer-btn' + (cls ? ' ' + cls : '') }, [icon(iconCls), el('span', { text: label })]); b.addEventListener('click', fn); return b; }
    return el('div', { class: 'am-drawer' }, [
      el('div', { class: 'am-drawer-user' }, [el('span', { class: 'am-avatar', 'aria-hidden': 'true', text: initials(user.name) }),
        el('div', {}, [el('strong', { text: user.name }), el('small', { text: user.email + ' · ' + (isAdmin ? 'Admin' : 'Client') })])]),
      row('fa-gauge', 'Dashboard', function () { location.href = isAdmin ? '/admin' : '/dashboard'; }),
      row('fa-key', 'Change Password', openPasswordModal),
      row('fa-right-from-bracket', 'Logout', logout, 'am-danger'),
    ]);
  }

  function apply(user) {
    var signin = document.querySelector('.desktop-nav .nav-signin-link');
    var signup = document.querySelector('.desktop-nav .nav-start-filing-btn');
    if (signin || signup) {
      var menu = buildMenu(user);
      (signin || signup).parentNode.insertBefore(menu, signin || signup);
      if (signin) signin.remove();
      if (signup) signup.remove();
    }
    var drawer = document.querySelector('.mobile-drawer');
    if (drawer) {
      var authLinks = drawer.querySelectorAll('a[href="signin.html"], a[href="signup.html"]');
      if (authLinks.length) {
        authLinks[0].parentNode.insertBefore(mobileBlock(user), authLinks[0]);
        authLinks.forEach(function (a) { a.remove(); });
      }
    }
    document.documentElement.classList.add('am-signed-in');
  }

  function init() {
    fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.user) apply(d.user); })
      .catch(function () { /* offline or API down: keep the normal signed-out navbar */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
