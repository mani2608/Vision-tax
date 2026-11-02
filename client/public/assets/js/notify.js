/* Vision-Tax notifications.
   VTNotify.toast(type, title, message?, { duration })   type: success | error | warning | info
   VTNotify.dialog({ type, title, message, button, note, onClose })
   VTNotify.invalid(inputElement)  — flags a field and focuses it */
(function () {
  var ICONS = { success: 'fa-circle-check', error: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  var stack;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function toast(type, title, message, opts) {
    type = ICONS[type] ? type : 'info';
    var ms = (opts && opts.duration) || (type === 'error' ? 6000 : 4500);
    if (!stack) {
      stack = el('div', 'vt-toasts');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    var t = el('div', 'vt-toast ' + type,
      '<span class="vt-ico"><i class="fa-solid ' + ICONS[type] + '"></i></span>' +
      '<div class="vt-body"><div class="vt-title">' + esc(title) + '</div>' + (message ? '<div class="vt-msg">' + esc(message) + '</div>' : '') + '</div>' +
      '<button type="button" class="vt-x" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>' +
      '<span class="vt-bar" style="animation-duration:' + ms + 'ms"></span>');
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    var done = false;
    function close() {
      if (done) return; done = true;
      t.classList.add('out');
      setTimeout(function () { t.remove(); }, 220);
    }
    t.querySelector('.vt-x').addEventListener('click', close);
    t.querySelector('.vt-bar').addEventListener('animationend', close);
    stack.appendChild(t);
    while (stack.children.length > 4) stack.firstChild.remove();
    return close;
  }

  function dialog(o) {
    o = o || {};
    var type = o.type === 'error' ? 'error' : 'success';
    var overlay = el('div', 'vt-overlay');
    var box = el('div', 'vt-dialog ' + type,
      '<div class="vt-badge"><i class="fa-solid ' + (type === 'error' ? 'fa-xmark' : 'fa-check') + '"></i></div>' +
      '<h3>' + esc(o.title) + '</h3><p>' + esc(o.message) + '</p>' +
      '<button type="button" class="vt-btn">' + esc(o.button || 'Continue') + '</button>' +
      (o.note ? '<span class="vt-note">' + esc(o.note) + '</span>' : ''));
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', o.title || 'Notification');
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    var btn = box.querySelector('.vt-btn');
    btn.focus();
    var closed = false;
    function close() {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      if (o.onClose) o.onClose();
    }
    function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); } }
    btn.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return close;
  }

  function invalid(input) {
    if (!input) return;
    input.classList.add('vt-invalid');
    input.focus();
    input.addEventListener('input', function clear() { input.classList.remove('vt-invalid'); input.removeEventListener('input', clear); });
  }

  window.VTNotify = { toast: toast, dialog: dialog, invalid: invalid };
})();
