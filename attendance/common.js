/* Pack 259 attendance - shared helpers for the attendance page and the roster page. */

var API_URL = 'https://script.google.com/macros/s/AKfycbyiWErvue40iB48c3MEjW3J_TZOJcEiezEJ5TjZcXVWK1QFj4u9oxT2WsDG8eO68qcP/exec';
// Local testing (test/serve.py) answers on the same server.
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) API_URL = '/api';

var WHOLE_PACK = 'Whole pack';
var DEFAULT_DENS = ['Lions', 'Tigers', 'Wolves', 'Bears', 'Webelos', 'AOLs', 'No den'];

/* ---------- values remembered on this device */

function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key) || '';
    if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
  } catch (e) { return ''; }
  return val;
}
function readJson(key, fallback) {
  try { var v = JSON.parse(store(key) || 'null'); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function writeJson(key, val) { store(key, JSON.stringify(val)); }

/* ---------- API: POST with text/plain so the browser skips the CORS preflight */

function api(action, payload, code) {
  var body = Object.assign({}, payload || {}, { action: action, code: code });
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
    return { ok: false, error: 'network', message: msg };
  }).finally(function () { if (timer) clearTimeout(timer); });
}

function errorText(r) {
  if (r.error === 'bad_code') return 'That code is not right. Check it and try again.';
  if (r.error === 'not_configured') return 'The codes have not been set up in the Sheet yet.';
  if (r.error === 'busy') return 'The Sheet is busy. Try again in a moment.';
  if (r.error === 'network') return r.message + ' Check the Wi-Fi or cell signal.';
  return r.message || 'Something went wrong. Try again.';
}

/* ---------- small DOM helpers */

function el(tag, attrs, children) {
  var e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function (k) {
    if (k === 'text') e.textContent = attrs[k];
    else if (k === 'class') e.className = attrs[k];
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  });
  (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return e;
}

function nameKey(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }

/** Sort key: last name (ignoring Jr., III and the like), then the whole name. */
function lastFirst(name) {
  var w = nameKey(name).replace(/\./g, '').split(' ');
  while (w.length > 1 && /^(jr|junior|sr|senior|ii|iii|iv|v)$/.test(w[w.length - 1])) w.pop();
  return w[w.length - 1] + ' ' + nameKey(name);
}

function todayIso() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
