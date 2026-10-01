/* Pack 259 Pinewood Derby - race laptop dashboard. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var REFRESH_MS = 15000;
  var timer = null, lastData = null;

  function show(id, on) { $(id).classList.toggle('hidden', !on); }

  function showCodePrompt(errText) {
    if (timer) { clearInterval(timer); timer = null; }
    show('main', false);
    show('codeCard', true);
    $('updated').textContent = 'Not signed in';
    $('codeErr').textContent = errText || '';
    show('codeErr', !!errText);
    $('codeInput').focus();
  }

  $('codeForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var code = $('codeInput').value.trim();
    if (!code) return;
    $('codeBtn').disabled = true;
    api('ping', {}, code).then(function (r) {
      $('codeBtn').disabled = false;
      if (r.ok) {
        setCode(code);
        if (!getStation()) setStation('Laptop');
        $('codeInput').value = '';
        start();
      } else {
        $('codeErr').textContent = r.error === 'bad_code' ? 'That code is not right.' : (r.message || 'Something went wrong.');
        show('codeErr', true);
      }
    });
  });

  $('signOutBtn').addEventListener('click', function () {
    if (getCode() && !confirm('Sign this device out? You will need the station code again.')) return;
    signOut();
    showCodePrompt();
  });

  function refresh() {
    return api('all').then(function (r) {
      if (!r.ok) {
        if (r.error === 'bad_code' || r.error === 'not_configured') { signOut(); showCodePrompt('The station code has changed. Enter the new code.'); return null; }
        $('updated').innerHTML = '';
        $('updated').appendChild(el('span', { class: 'err', text: (r.message || r.error) + ' Retrying...' }));
        return null;
      }
      lastData = r;
      render(r);
      return r;
    });
  }

  function render(r) {
    if (r.event) $('event').textContent = r.event + ' - Dashboard';
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) + ' (refreshes every 15 seconds)';
    var racers = r.cars.filter(function (c) { return c.claimed; });

    // counts by rank
    var tb = $('countsTable').tBodies[0];
    tb.innerHTML = '';
    var allIn = 0, allTotal = 0;
    GROUPS.forEach(function (g) {
      var inRank = racers.filter(function (c) { return c.rank === g; });
      var checked = inRank.filter(function (c) { return c.latest; });
      var passed = checked.filter(function (c) { return c.latest.passed; });
      allIn += checked.length; allTotal += inRank.length;
      tb.appendChild(el('tr', null, [
        el('td', null, [el('span', { class: 'badge ' + rankClass(g), text: g })]),
        el('td', { class: 'num', text: checked.length + ' / ' + inRank.length }),
        el('td', { class: 'num', text: String(passed.length) })
      ]));
    });
    $('totalIn').textContent = allIn;
    $('totalOf').textContent = 'of ' + allTotal + ' checked in';

    // not passed
    var np = racers.filter(function (c) { return c.latest && !c.latest.passed; });
    var npBox = $('notPassed');
    npBox.innerHTML = '';
    if (!np.length) npBox.appendChild(el('p', { class: 'muted', text: 'None.' }));
    else {
      var t = el('table', null, [el('thead', null, [el('tr', null, [
        el('th', { text: 'Car' }), el('th', { text: 'Name' }), el('th', { text: 'Weight' }), el('th', { text: 'Problem' })])])]);
      var body = el('tbody');
      np.forEach(function (c) {
        var over = c.rank !== 'Outlaw' && c.latest.weight !== null && c.latest.weight > r.limit + 1e-9;
        var why = [over ? 'Over limit' : '', c.latest.fits ? '' : 'Box'].filter(Boolean).join(' + ');
        body.appendChild(el('tr', null, [
          el('td', { class: 'num', text: c.n }), el('td', { text: c.first + ' ' + c.last }),
          el('td', { text: fmtWeight(c.latest.weight) }), el('td', { text: why })]));
      });
      t.appendChild(body);
      npBox.appendChild(t);
    }

    // assigned scouts not yet checked in
    var out = r.cars.filter(function (c) { return c.status === 'assigned' && !c.latest; });
    var niBox = $('notIn');
    niBox.innerHTML = '';
    if (!out.length) niBox.appendChild(el('p', { class: 'muted', text: 'Everyone on the roster is checked in.' }));
    GROUPS.forEach(function (g) {
      var list = out.filter(function (c) { return c.rank === g; })
        .sort(function (a, b) { return (a.last + ' ' + a.first).localeCompare(b.last + ' ' + b.first); });
      if (!list.length) return;
      niBox.appendChild(el('h3', { text: g + ' (' + list.length + ')' }));
      niBox.appendChild(el('div', { text: list.map(function (c) { return c.n + ' ' + c.first + ' ' + c.last; }).join(', ') }));
    });

    var nExport = r.cars.filter(function (c) { return c.latest; }).length;
    $('exportBtn').textContent = 'Export CSV (' + nExport + ' cars)';
  }

  $('exportBtn').addEventListener('click', function () {
    var btn = $('exportBtn');
    btn.disabled = true;
    $('exportResult').textContent = 'Getting the latest data...';
    refresh().then(function (r) {
      btn.disabled = false;
      if (!r) { $('exportResult').textContent = 'Export failed: could not get the latest data. Try again.'; return; }
      var csv = buildRaceManagerCsv(r.cars);
      var name = csvFilename();
      downloadBytes(csv.bytes, name);
      $('exportResult').textContent = 'Exported ' + csv.count + ' cars to ' + name + ' at ' +
        new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.';
    });
  });

  function start() {
    show('codeCard', false);
    show('main', true);
    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, REFRESH_MS);
  }

  if (getCode()) start(); else showCodePrompt();
})();
