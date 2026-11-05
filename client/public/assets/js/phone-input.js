/*
 * Searchable country-code selector + phone field for the static pages (sign-up, homepage Pay Now).
 * Needs vendor/libphonenumber-max.js and phone-core.js loaded first.
 *
 *   var pi = VTPhoneInput.mount(document.getElementById('signup-phone'), { defaultCountry: 'IN' });
 *   var r = pi.validate();      // { ok, e164, error, country, ... }  (shows the message under the field)
 *   pi.country();               // currently selected ISO code, e.g. 'IN'
 *   pi.setDefaultCountry('US'); // used by the config fetch once it returns
 */
(function (root) {
  'use strict';
  var P = root.VTPhone;
  if (!P) return;

  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function mount(input, opts) {
    opts = opts || {};
    var all = P.countries();
    var selected = P.isCountry(opts.defaultCountry) ? opts.defaultCountry.toUpperCase() : 'US';
    var userPicked = false;

    // ---- DOM: [country button + dropdown][phone input] + message ----
    var group = input.parentNode;
    if (!group.classList.contains('phone-input-group')) {
      group = el('div', 'phone-input-group');
      input.parentNode.insertBefore(group, input);
      group.appendChild(input);
    }
    var holder = el('div', 'vt-cc');
    var btn = el('button', 'form-control vt-cc-btn', { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': 'Country code' });
    var panel = el('div', 'vt-cc-panel');
    panel.hidden = true;
    var search = el('input', 'vt-cc-search', { type: 'search', placeholder: 'Search country or code', 'aria-label': 'Search country or dialing code', autocomplete: 'off' });
    var list = el('ul', 'vt-cc-list', { role: 'listbox' });
    panel.appendChild(search); panel.appendChild(list);
    holder.appendChild(btn); holder.appendChild(panel);
    group.insertBefore(holder, input);
    input.classList.add('phone-number-input');
    input.setAttribute('inputmode', 'tel');
    input.setAttribute('autocomplete', 'tel-national');
    input.removeAttribute('maxlength');

    var msg = el('small', 'vt-phone-msg', { role: 'alert', 'aria-live': 'polite' });
    group.parentNode.insertBefore(msg, group.nextSibling);

    function find(iso) { return all.filter(function (c) { return c.iso === iso; })[0]; }

    function paintButton() {
      var c = find(selected);
      btn.innerHTML = '';
      var iso = el('span', 'vt-cc-iso'); iso.textContent = selected;
      var code = el('span', 'vt-cc-code'); code.textContent = '+' + (c ? c.callingCode : '');
      var caret = el('i', 'fa-solid fa-chevron-down vt-cc-caret'); caret.setAttribute('aria-hidden', 'true');
      btn.appendChild(iso); btn.appendChild(code); btn.appendChild(caret);
      btn.title = c ? c.name + ' (+' + c.callingCode + ')' : '';
    }

    function renderList() {
      var q = search.value.trim().toLowerCase().replace(/^\+/, '');
      list.innerHTML = '';
      var shown = 0;
      all.forEach(function (c) {
        if (q && c.name.toLowerCase().indexOf(q) === -1 && c.iso.toLowerCase() !== q && c.callingCode.indexOf(q) !== 0) return;
        var li = el('li', 'vt-cc-item' + (c.iso === selected ? ' on' : ''), { role: 'option', 'data-iso': c.iso, 'aria-selected': c.iso === selected ? 'true' : 'false' });
        var n = el('span', 'vt-cc-name'); n.textContent = c.name;
        var d = el('span', 'vt-cc-dial'); d.textContent = '+' + c.callingCode;
        li.appendChild(n); li.appendChild(d);
        list.appendChild(li);
        shown++;
      });
      if (!shown) { var none = el('li', 'vt-cc-none'); none.textContent = 'No matching country'; list.appendChild(none); }
    }

    function open() {
      panel.hidden = false; btn.setAttribute('aria-expanded', 'true');
      search.value = ''; renderList(); search.focus();
      var on = list.querySelector('.on'); if (on) on.scrollIntoView({ block: 'center' });
    }
    function close() { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    function choose(iso) { selected = iso; userPicked = true; paintButton(); close(); clearMsg(); input.focus(); }

    btn.addEventListener('click', function () { panel.hidden ? open() : close(); });
    search.addEventListener('input', renderList);
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); btn.focus(); }
      if (e.key === 'Enter') { e.preventDefault(); var first = list.querySelector('.vt-cc-item'); if (first) choose(first.getAttribute('data-iso')); }
    });
    list.addEventListener('click', function (e) {
      var li = e.target.closest('.vt-cc-item'); if (li) choose(li.getAttribute('data-iso'));
    });
    document.addEventListener('click', function (e) { if (!holder.contains(e.target)) close(); });

    function clearMsg() { msg.textContent = ''; input.classList.remove('vt-phone-bad'); input.removeAttribute('aria-invalid'); }
    function showMsg(t) { msg.textContent = t; input.classList.add('vt-phone-bad'); input.setAttribute('aria-invalid', 'true'); }

    // Typing "+44 ..." switches the selector to the United Kingdom, so what you see is what is submitted.
    input.addEventListener('input', function () {
      clearMsg();
      if (input.value.trim().charAt(0) === '+') {
        var r = P.parse(input.value);
        if (r.ok && r.country && r.country !== selected) { selected = r.country; paintButton(); }
      }
    });
    input.addEventListener('blur', function () { if (input.value.trim()) validate(); });

    function validate() {
      var r = P.parse(input.value, selected);
      if (r.ok) { clearMsg(); } else { showMsg(r.error); }
      return r;
    }

    paintButton();
    return {
      validate: validate,
      country: function () { return selected; },
      setDefaultCountry: function (iso) { if (!userPicked && P.isCountry(iso)) { selected = iso.toUpperCase(); paintButton(); } },
      setError: showMsg,
    };
  }

  root.VTPhoneInput = { mount: mount };
})(typeof self !== 'undefined' ? self : this);
