/* Pack 259 Pinewood Derby - shared helpers for the check-in page and dashboard. */

var API_URL = 'https://script.google.com/macros/s/AKfycbzs7nfEqtRaQxXI9eTVfGgTfb1Og5MvLHDJCNLL3wpZ-bGMJvrPzarEJYe9gP6oI3TI/exec';

var GROUPS = ['Lion', 'Tiger', 'Wolf', 'Bear', 'Webelos', 'Arrow of Light', 'Outlaw'];

/* ---------- station code and station name (remembered on this device) */

function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key) || '';
    if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
  } catch (e) { return ''; }
  return val;
}
function getCode() { return store('pwd.code'); }
function setCode(c) { store('pwd.code', c); }
function getStation() { return store('pwd.station'); }
function setStation(s) { store('pwd.station', s); }
function signOut() { store('pwd.code', null); }

/* ---------- API: POST with text/plain so the browser skips the CORS preflight */

function api(action, payload, codeOverride) {
  var body = Object.assign({}, payload || {}, { action: action, code: codeOverride || getCode() });
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 30000) : null;
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow',
    signal: ctrl ? ctrl.signal : undefined
  }).then(function (r) {
    if (!r.ok) throw new Error('Server returned ' + r.status);
    return r.json();
  }).catch(function (err) {
    var msg = err && err.name === 'AbortError' ? 'The server took too long to answer.' : 'Could not reach the server.';
    return { ok: false, error: 'network', message: msg + ' Check the Wi-Fi or cell signal and try again.' };
  }).finally(function () { if (timer) clearTimeout(timer); });
}

/* ---------- car numbers */

/** Accepts a scanned URL (...?n=042), "42", "042" or "#42". Returns "042" or null. */
function parseCar(s) {
  s = String(s == null ? '' : s).trim();
  var m = s.match(/[?&]n=(\d{1,3})(?!\d)/) || s.match(/^#?(\d{1,3})$/);
  return m ? ('000' + parseInt(m[1], 10)).slice(-3) : null;
}

function el(tag, attrs, children) {
  var e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function (k) {
    if (k === 'text') e.textContent = attrs[k];
    else if (k === 'class') e.className = attrs[k];
    else e.setAttribute(k, attrs[k]);
  });
  (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return e;
}

function fmtTime(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtWeight(w) { return w === null || w === undefined || w === '' ? '' : Number(w).toFixed(2) + ' oz'; }

function rankClass(rank) { return 'rank-' + String(rank || '').toLowerCase().replace(/[^a-z]+/g, '-'); }

/* ---------- Windows-1252 encoding for the Race Manager CSV */

// Characters 0x80-0x9F in cp1252 that are not Latin-1.
var CP1252_EXTRA = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91,
  0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98,
  0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
};
// Letters that do not decompose to a base letter plus an accent.
var TRANSLIT = {
  0x0141: 'L', 0x0142: 'l', 0x0110: 'D', 0x0111: 'd', 0x0126: 'H', 0x0127: 'h', 0x0131: 'i',
  0x0132: 'IJ', 0x0133: 'ij', 0x013F: 'L', 0x0140: 'l', 0x014A: 'N', 0x014B: 'n', 0x0166: 'T',
  0x0167: 't', 0x0218: 'S', 0x0219: 's', 0x021A: 'T', 0x021B: 't', 0x02BC: "'", 0x2010: '-', 0x2011: '-'
};

function cp1252Byte(cp) {
  if (cp < 0x20) return cp === 0x0A || cp === 0x0D ? cp : cp === 0x09 ? 0x20 : -1;
  if (cp < 0x80) return cp;
  if (cp >= 0xA0 && cp <= 0xFF) return cp;
  if (CP1252_EXTRA[cp] !== undefined) return CP1252_EXTRA[cp];
  return -1;
}

/** Returns the string with every character outside Windows-1252 transliterated to plain letters or dropped. */
function cp1252Safe(str) {
  return Array.from(String(str == null ? '' : str)).map(function (ch) {
    var cp = ch.codePointAt(0);
    if (cp1252Byte(cp) >= 0) return ch;
    var alt = TRANSLIT[cp];
    if (alt === undefined) {
      alt = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (alt === ch) alt = '';
    }
    return Array.from(alt).filter(function (c) { return cp1252Byte(c.codePointAt(0)) >= 0; }).join('');
  }).join('');
}

/** Returns a Uint8Array of the string in Windows-1252 (characters outside it are transliterated first). */
function encodeCp1252(str) {
  var safe = cp1252Safe(str), out = new Uint8Array(safe.length);
  for (var i = 0; i < safe.length; i++) out[i] = cp1252Byte(safe.charCodeAt(i));
  return out;
}

var CSV_HEADER = ['Last Name', 'First Name', 'Group', 'Subgroup', 'Car#', 'Car Name',
                  'Passed inspection?', 'Image', 'Exclude?', 'Printed'];

/** Builds the Race Manager roster: one row per checked-in car (latest weigh-in), in car number order. */
function buildRaceManagerCsv(cars) {
  var rows = cars.filter(function (c) { return c.latest; })
    .sort(function (a, b) { return a.n < b.n ? -1 : a.n > b.n ? 1 : 0; })
    .map(function (c) {
      return [c.last, c.first, c.rank, '', c.n, '', c.latest.passed ? 'TRUE' : 'FALSE', '', 'FALSE', ''];
    });
  var q = function (v) { return '"' + cp1252Safe(v).replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"'; };
  var text = [CSV_HEADER].concat(rows).map(function (r) { return r.map(q).join(','); }).join('\r\n') + '\r\n';
  return { bytes: encodeCp1252(text), count: rows.length };
}

function csvFilename(d) {
  d = d || new Date();
  var p = function (n) { return ('0' + n).slice(-2); };
  return 'pack259-derby-roster-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.csv';
}

function downloadBytes(bytes, filename) {
  var blob = new Blob([bytes], { type: 'application/octet-stream' });
  var url = URL.createObjectURL(blob);
  var a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
}
