/*
 * Vision-Tax international phone rules (UMD).
 *
 * ONE rule set for every place a phone number is validated. This exact file is used by:
 *   - the browser (static pages load it after libphonenumber-max.js; the Next.js app imports it), and
 *   - the Express API (server/src/phone-core.js is a byte-identical copy; scripts/check-phone-core-sync.js
 *     fails if the two ever drift apart).
 * Validation is delegated to Google's libphonenumber data (libphonenumber-js "max" metadata), never to
 * a hand-written country regex. Numbers are normalised to E.164 (+<country code><national number>).
 *
 * A number is accepted when it is a valid number for a real country. It does not matter which country.
 * Numbers typed with a leading "+" (or "00") are international and carry their own country code.
 * Numbers typed without one need a selected country; otherwise the caller gets a clear message.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('libphonenumber-js/max'));
  else root.VTPhone = factory(root.libphonenumber);
})(typeof self !== 'undefined' ? self : this, function (lib) {
  'use strict';

  var CHARS = /^\+?[\d\s\-().]+$/;
  var regionNames = null;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { /* very old runtime: fall back to ISO codes */ }

  function countryName(iso) {
    try { return (regionNames && regionNames.of(iso)) || iso; } catch (e) { return iso; }
  }

  function isCountry(iso) {
    return typeof iso === 'string' && /^[A-Za-z]{2}$/.test(iso) && lib.isSupportedCountry(iso.toUpperCase());
  }

  // All supported countries as [{ iso, name, callingCode }] sorted by name.
  var countryCache = null;
  function countries() {
    if (!countryCache) {
      countryCache = lib.getCountries().map(function (iso) {
        return { iso: iso, name: countryName(iso), callingCode: lib.getCountryCallingCode(iso) };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    }
    return countryCache;
  }

  // Parse + validate. `country` (ISO 3166-1 alpha-2) is only used for numbers typed without a country code.
  // Returns { ok: true, e164, international, national, country, callingCode }  or  { ok: false, error }.
  function parse(raw, country) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { ok: false, error: 'Phone number is required.' };
    if (!CHARS.test(s)) return { ok: false, error: 'Phone number may contain only digits, spaces, dashes, dots and parentheses.' };
    if (s.indexOf('00') === 0) s = '+' + s.slice(2); // 0044... is the same as +44...
    var iso = isCountry(country) ? String(country).toUpperCase() : undefined;
    var international = s.charAt(0) === '+';
    if (!international && !iso) {
      return { ok: false, error: 'Select your country, or start the number with a country code such as +91 or +1.' };
    }
    var num;
    try { num = lib.parsePhoneNumberFromString(s, international ? undefined : iso); } catch (e) { num = undefined; }
    if (!num) {
      var why = lib.validatePhoneNumberLength(s, international ? undefined : iso);
      if (why === 'INVALID_COUNTRY') return { ok: false, error: 'That country code is not recognised. Check the number starts with a valid code such as +91 or +1.' };
      if (why === 'TOO_SHORT') return { ok: false, error: 'That phone number is too short.' };
      if (why === 'TOO_LONG') return { ok: false, error: 'That phone number is too long.' };
      return { ok: false, error: 'Enter a valid phone number.' };
    }
    if (!num.isValid()) {
      var where = num.country ? countryName(num.country) + ' (+' + num.countryCallingCode + ')' : '+' + num.countryCallingCode;
      var len = lib.validatePhoneNumberLength(num.number);
      if (len === 'TOO_SHORT') return { ok: false, error: 'That phone number is too short for ' + where + '.' };
      if (len === 'TOO_LONG') return { ok: false, error: 'That phone number is too long for ' + where + '.' };
      return { ok: false, error: 'That does not look like a valid phone number for ' + where + '. Check the digits and try again.' };
    }
    return {
      ok: true,
      e164: num.number,
      international: num.formatInternational(),
      national: num.formatNational(),
      country: num.country || null,
      callingCode: num.countryCallingCode,
    };
  }

  // Readable form for stored values: "+919876543210" -> "+91 98765 43210". Also copes with legacy rows that were
  // stored as bare digits ("919876543210"). Anything unparseable is returned unchanged, never hidden or altered.
  function format(stored) {
    var s = String(stored == null ? '' : stored).trim();
    if (!s) return '';
    var candidate = s.charAt(0) === '+' ? s : (/^\d{8,15}$/.test(s) ? '+' + s : null);
    if (candidate) {
      try {
        var num = lib.parsePhoneNumberFromString(candidate);
        if (num && num.isValid()) return num.formatInternational();
      } catch (e) { /* fall through */ }
    }
    return s;
  }

  // Splits a stored value into { country, national } for pre-filling an edit form, or null if it cannot be read.
  function split(stored) {
    var s = String(stored == null ? '' : stored).trim();
    var candidate = s.charAt(0) === '+' ? s : (/^\d{8,15}$/.test(s) ? '+' + s : null);
    if (!candidate) return null;
    try {
      var num = lib.parsePhoneNumberFromString(candidate);
      if (num && num.isValid()) return { country: num.country || null, callingCode: num.countryCallingCode, national: num.formatNational() };
    } catch (e) { /* fall through */ }
    return null;
  }

  return { parse: parse, format: format, split: split, countries: countries, countryName: countryName, isCountry: isCountry };
});
