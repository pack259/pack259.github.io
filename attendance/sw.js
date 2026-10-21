/* Pack 259 attendance - keeps the pages on the phone so they open with no signal.
 * Pages come from the network when it answers within 3 seconds, otherwise from
 * the saved copy. Calls to the Google Sheet are not touched. */
var CACHE = 'pack259-attendance-v1';
var FILES = ['./', 'index.html', 'roster.html', 'app.css', 'common.js', 'app.js', 'roster.js',
             'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    var finish = function (res) { if (!done && res) { done = true; resolve(res); } };
    var cached = function () { return caches.match(req, { ignoreSearch: true }); };
    var timer = setTimeout(function () { cached().then(finish); }, 3000);
    fetch(req).then(function (res) {
      clearTimeout(timer);
      if (res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      finish(res);
    }).catch(function () {
      clearTimeout(timer);
      cached().then(function (res) { finish(res || Response.error()); });
    });
  }));
});
