/* Pack 259 attendance - the page leaders use to mark who is at an activity.
 *
 * Every tap is saved on the phone first (localStorage "att.queue") and sent to
 * the Sheet in the background, so a page closed early or a campsite with no
 * signal loses nothing: the taps go out the next time the page is open online.
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var OTHER = '__other__';

  var roster = readJson('att.roster', { scouts: [], dens: DEFAULT_DENS });
  var queue = readJson('att.queue', []).map(function (op) { delete op.sent; return op; });
  var group = store('att.group');
  var date = todayIso(), dateChosen = false;
  var snap = null;               // what the Sheet last said about this date
  var eventName = '', customEvent = '', otherMode = false;
  var sending = false, flushTimer = null, failures = 0, lastError = '', loadToken = 0;

  function getCode() { return store('att.code'); }
  function getName() { return store('att.name'); }
  function show(id, on) { $(id).classList.toggle('hidden', !on); }
  function ekey(s) { return nameKey(s); }

  function setMsg(kind, text) {
    var m = $('msg');
    m.innerHTML = '';
    if (text) m.appendChild(el('div', { class: 'banner ' + kind, text: text }));
  }

  /* ---------------- what is marked: the Sheet's answer plus taps not yet sent */

  function toSnap(r) {
    var s = { calendar: r.calendar || [], events: {} };
    (r.events || []).forEach(function (ev) {
      var present = {};
      ev.present.forEach(function (n) { present[n] = true; });
      s.events[ekey(ev.name)] = { name: ev.name, present: present };
    });
    return s;
  }

  function snapFor(d) { return readJson('att.day.' + d, null); }

  function saveSnap(d, s) {
    writeJson('att.day.' + d, s);
    var days = readJson('att.days', []).filter(function (x) { return x !== d; });
    days.unshift(d);
    days.slice(14).forEach(function (old) { store('att.day.' + old, null); });
    writeJson('att.days', days.slice(0, 14));
  }

  function applyOps(s, d, ops) {
    ops.forEach(function (op) {
      if (op.k !== 'mark' || op.date !== d) return;
      var k = ekey(op.event);
      var ev = s.events[k] || (s.events[k] = { name: op.event, present: {} });
      if (op.present) ev.present[op.name] = true; else delete ev.present[op.name];
    });
    return s;
  }

  function current() {
    var base = snap ? JSON.parse(JSON.stringify(snap)) : { calendar: [], events: {} };
    return applyOps(base, date, queue);
  }

  /** The roster, plus scouts added on this phone that have not reached the Sheet yet. */
  function scouts() {
    var list = roster.scouts.slice(), have = {};
    list.forEach(function (s) { have[nameKey(s.n)] = true; });
    queue.forEach(function (op) {
      if (op.k !== 'add' || have[nameKey(op.name)]) return;
      have[nameKey(op.name)] = true;
      list.push({ n: op.name, d: op.den, a: 1 });
    });
    return list;
  }

  function hereMap() {
    var ev = eventName ? current().events[ekey(eventName)] : null;
    return ev ? ev.present : {};
  }

  /* ---------------- events */

  function eventChoices(s) {
    var list = [], seen = {};
    var add = function (n) {
      var k = ekey(n);
      if (n && !seen[k]) { seen[k] = true; list.push(n); }
    };
    s.calendar.forEach(add);
    Object.keys(s.events).forEach(function (k) { add(s.events[k].name); });
    add('Den Meeting');
    add('Pack Meeting');
    add(customEvent);
    return list;
  }

  function defaultEvent(s) {
    if (s.calendar.length) return s.calendar[0];
    var keys = Object.keys(s.events);
    if (keys.length) return s.events[keys[0]].name;
    return group === WHOLE_PACK ? 'Pack Meeting' : 'Den Meeting';
  }

  /* ---------------- drawing */

  function render() {
    var signedIn = !!getCode();
    show('codeCard', !signedIn);
    show('mainCard', signedIn);
    $('who').textContent = signedIn ? 'Signed in as ' + (getName() || 'leader') : '';
    showSync();
    if (!signedIn) {
      $('nameInput').value = $('nameInput').value || getName();
      return;
    }

    var dens = roster.dens && roster.dens.length ? roster.dens : DEFAULT_DENS;
    var gs = $('groupSel');
    gs.innerHTML = '';
    if (!group) gs.appendChild(el('option', { value: '', text: 'Choose your den' }));
    dens.concat([WHOLE_PACK]).forEach(function (g) {
      gs.appendChild(el('option', { value: g, text: g === WHOLE_PACK ? 'Whole pack (all dens)' : g }));
    });
    gs.value = group;

    $('dateInput').value = date;

    var s = current(), choices = eventChoices(s);
    if (!otherMode && (!eventName || !choices.some(function (c) { return ekey(c) === ekey(eventName); }))) {
      eventName = defaultEvent(s);
      choices = eventChoices(s);
    }
    var es = $('eventSel');
    es.innerHTML = '';
    choices.forEach(function (c) { es.appendChild(el('option', { value: c, text: c })); });
    es.appendChild(el('option', { value: OTHER, text: 'Other (type a name)\u2026' }));
    if (otherMode) {
      es.value = OTHER;
    } else {
      choices.forEach(function (c) { if (ekey(c) === ekey(eventName)) es.value = c; });
    }
    show('otherInput', otherMode);
    renderList();
  }

  /* The list is rebuilt only when the names on it change. Otherwise the
     buttons are updated in place, so a background refresh never swaps a
     button out from under a finger mid-tap. */
  var listSig = '', buttons = {}, heads = {};

  function renderList() {
    show('listArea', !!group);
    var area = $('list');
    if (!group) { area.innerHTML = ''; listSig = ''; return; }
    var pack = group === WHOLE_PACK;
    show('search', pack);
    var here = hereMap(), all = scouts(), q = pack ? nameKey($('search').value) : '';
    var dens = pack ? (roster.dens && roster.dens.length ? roster.dens : DEFAULT_DENS) : [group];
    var groups = [], total = 0, marked = 0;

    dens.forEach(function (den) {
      var list = all.filter(function (x) { return x.d === den; })
        .sort(function (a, b) { return lastFirst(a.n) < lastFirst(b.n) ? -1 : 1; });
      var denHere = list.filter(function (x) { return here[x.n]; }).length;
      total += list.length;
      marked += denHere;
      var shown = q ? list.filter(function (x) { return nameKey(x.n).indexOf(q) >= 0; }) : list;
      if (pack && !shown.length) return;
      groups.push({ den: den, size: list.length, here: denHere, shown: shown });
    });

    var sig = group + '|' + q + '|' + JSON.stringify(groups.map(function (g) {
      return [g.den, g.shown.map(function (x) { return x.n + (x.a ? '*' : ''); })];
    }));
    if (sig !== listSig) {
      listSig = sig;
      area.innerHTML = '';
      buttons = {};
      heads = {};
      groups.forEach(function (g) {
        if (pack) area.appendChild(heads[g.den] = el('div', { class: 'denhead' }));
        var box = el('div', { class: 'list' });
        g.shown.forEach(function (x) { box.appendChild(buttons[x.n] = scoutButton(x)); });
        if (!g.size) {
          box.appendChild(el('div', { class: 'empty', text: 'No scouts are on the ' + g.den +
            ' list yet. Add them with the button below, or ask the roster keeper to upload the Scoutbook roster.' }));
        }
        area.appendChild(box);
      });
      if (pack && !groups.length) {
        area.appendChild(el('div', { class: 'list' }, [el('div', { class: 'empty',
          text: q ? 'No scout on the list matches \u201c' + $('search').value.trim() + '\u201d.' : 'The roster is empty.' })]));
      }
    }
    Object.keys(buttons).forEach(function (n) { buttons[n].setAttribute('aria-pressed', here[n] ? 'true' : 'false'); });
    groups.forEach(function (g) { if (heads[g.den]) heads[g.den].textContent = g.den + ' \u00b7 ' + g.here + ' of ' + g.size; });
    $('count').textContent = marked + ' of ' + total + ' here';
  }

  function scoutButton(x) {
    var b = el('button', { type: 'button', class: 'scout', 'aria-pressed': 'false' });
    var box = el('span', { class: 'box' });
    box.innerHTML = CHECK;
    b.appendChild(box);
    b.appendChild(el('span', { text: x.n }));
    if (x.a) b.appendChild(el('span', { class: 'tag', text: 'new', title: 'Added by a leader; not in Scoutbook yet' }));
    b.addEventListener('click', function () { toggle(x.n); });
    return b;
  }

  function showSync() {
    var b = $('sync'), n = queue.length;
    b.className = 'sync';
    if (!getCode()) { b.textContent = ''; return; }
    if (!n) { b.textContent = '\u2713 Saved'; return; }
    if (sending || !lastError) { b.classList.add('busy'); b.textContent = 'Saving\u2026'; return; }
    b.classList.add('warn');
    b.textContent = n + ' waiting \u00b7 Retry';
  }

  /* ---------------- taps and sending */

  var lastTap = { name: '', t: 0 };

  function toggle(name) {
    if (!eventName) {
      setMsg('warn', 'Type the name of the event first.');
      $('otherInput').focus();
      return;
    }
    // An accidental double tap should not undo itself.
    var now = Date.now();
    if (lastTap.name === name && now - lastTap.t < 400) return;
    lastTap = { name: name, t: now };
    var on = !hereMap()[name];
    enqueue({ k: 'mark', date: date, event: eventName, group: group, name: name, present: on, t: Date.now() });
    renderList();
  }

  function enqueue(op) {
    op.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    if (op.k === 'mark') {
      queue = queue.filter(function (q) {
        return q.sent || !(q.k === 'mark' && q.date === op.date && ekey(q.event) === ekey(op.event) && q.name === op.name);
      });
    }
    queue.push(op);
    writeJson('att.queue', queue);
    scheduleFlush(700);
  }

  function scheduleFlush(ms) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, ms);
    showSync();
  }

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (sending || !queue.length || !getCode()) { showSync(); return; }
    sending = true;
    var batch = queue.slice(0, 200);
    batch.forEach(function (op) { op.sent = true; });
    showSync();
    var ops = batch.map(function (op) {
      var o = Object.assign({}, op);
      delete o.id;
      delete o.sent;
      return o;
    });
    api('save', { by: getName(), ops: ops }, getCode()).then(function (r) {
      sending = false;
      batch.forEach(function (op) { delete op.sent; });
      if (r.ok) {
        var ids = {};
        batch.forEach(function (op) { ids[op.id] = true; });
        queue = queue.filter(function (q) { return !ids[q.id]; });
        writeJson('att.queue', queue);
        foldIn(batch);
        failures = 0;
        lastError = '';
        if ($('msg').querySelector('.offline')) setMsg('', '');
        if (queue.length) scheduleFlush(300);
        if (batch.some(function (op) { return op.k === 'add'; })) load();
      } else if (r.error === 'bad_code') {
        lastError = r.error;
        store('att.code', null);
        render();
        $('codeErr').textContent = 'The leader code has changed. Enter the new one. Your taps are kept on this phone.';
        show('codeErr', true);
      } else {
        failures++;
        lastError = r.error || 'server';
        setMsg('warn offline', 'Your taps are saved on this phone and will be sent when the signal comes back. ' +
          'You can close the page; they go out the next time it is open.');
        scheduleFlush(Math.min(60000, 5000 * failures));
      }
      showSync();
    });
  }

  /** After a batch is saved, folds it into the saved copies so the list is right with no signal. */
  function foldIn(batch) {
    var dates = {};
    batch.forEach(function (op) { if (op.k === 'mark') dates[op.date] = true; });
    Object.keys(dates).forEach(function (d) {
      var s = d === date ? snap : snapFor(d);
      if (!s) return;
      applyOps(s, d, batch);
      saveSnap(d, s);
    });
    batch.forEach(function (op) {
      if (op.k !== 'add' || roster.scouts.some(function (x) { return nameKey(x.n) === nameKey(op.name); })) return;
      roster.scouts.push({ n: op.name, d: op.den, a: 1 });
    });
    writeJson('att.roster', roster);
  }

  /* ---------------- loading */

  function load() {
    var d = date, token = ++loadToken;
    snap = snapFor(d);
    render();
    if (!getCode()) return;
    api('load', { date: d }, getCode()).then(function (r) {
      if (token !== loadToken) return;
      if (r.ok) {
        roster = { scouts: r.roster, dens: r.dens };
        writeJson('att.roster', roster);
        snap = toSnap(r);
        saveSnap(d, snap);
        if (!lastError) setMsg('', '');
      } else if (r.error === 'bad_code') {
        store('att.code', null);
        render();
        $('codeErr').textContent = 'The leader code has changed. Enter the new one.';
        show('codeErr', true);
        return;
      } else if (!roster.scouts.length) {
        setMsg('bad', 'Could not load the scout list. ' + errorText(r));
      } else {
        setMsg('info offline', 'No signal right now. This is the list saved on this phone. Your taps are kept here and sent when the signal comes back.');
      }
      render();
    });
  }

  /* ---------------- controls */

  $('codeForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var code = $('codeInput').value.trim(), name = $('nameInput').value.replace(/\s+/g, ' ').trim();
    if (!code || !name) return;
    $('codeBtn').disabled = true;
    $('codeBtn').textContent = 'Checking\u2026';
    show('codeErr', false);
    api('ping', {}, code).then(function (r) {
      $('codeBtn').disabled = false;
      $('codeBtn').textContent = 'Sign in';
      if (!r.ok) {
        $('codeErr').textContent = errorText(r);
        show('codeErr', true);
        return;
      }
      store('att.code', code);
      store('att.name', name);
      $('codeInput').value = '';
      lastError = '';
      load();
      flush();
    });
  });

  $('signOutBtn').addEventListener('click', function () {
    if (queue.length && !confirm(queue.length + ' tap(s) have not been sent yet. They stay on this phone and go out after you sign in again. Sign out?')) return;
    store('att.code', null);
    render();
  });

  $('groupSel').addEventListener('change', function () {
    group = this.value;
    store('att.group', group);
    $('search').value = '';
    closeAdd();
    render();
  });

  $('dateInput').addEventListener('change', function () {
    date = /^\d{4}-\d{2}-\d{2}$/.test(this.value) ? this.value : todayIso();
    dateChosen = date !== todayIso();
    eventName = '';
    customEvent = '';
    otherMode = false;
    load();
  });

  $('eventSel').addEventListener('change', function () {
    if (this.value === OTHER) {
      otherMode = true;
      eventName = $('otherInput').value.replace(/\s+/g, ' ').trim();
      show('otherInput', true);
      $('otherInput').focus();
    } else {
      otherMode = false;
      eventName = this.value;
      show('otherInput', false);
    }
    setMsg('', '');
    renderList();
  });

  $('otherInput').addEventListener('input', function () {
    eventName = this.value.replace(/\s+/g, ' ').trim();
    customEvent = eventName;
    renderList();
  });

  $('search').addEventListener('input', renderList);

  $('sync').addEventListener('click', function () { failures = 0; flush(); });

  function closeAdd() {
    show('addForm', false);
    show('addBtn', true);
    show('addErr', false);
  }

  $('addBtn').addEventListener('click', function () {
    var dens = roster.dens && roster.dens.length ? roster.dens : DEFAULT_DENS;
    var sel = $('addDen');
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: '', text: 'Choose a den' }));
    dens.forEach(function (d) { sel.appendChild(el('option', { value: d, text: d })); });
    show('addDenWrap', group === WHOLE_PACK);
    show('addBtn', false);
    show('addForm', true);
    $('addFirst').focus();
  });

  $('addCancel').addEventListener('click', closeAdd);

  $('addForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var tidy = function (s) { return s.replace(/\s+/g, ' ').trim(); };
    var name = tidy($('addFirst').value) + ' ' + tidy($('addLast').value);
    var den = group === WHOLE_PACK ? $('addDen').value : group;
    var err = !tidy($('addFirst').value) || !tidy($('addLast').value) ? 'Enter a first and last name.'
      : !den ? 'Choose the den.' : !eventName ? 'Type the name of the event first.' : '';
    if (err) {
      $('addErr').textContent = err;
      show('addErr', true);
      return;
    }
    var existing = scouts().filter(function (x) { return nameKey(x.n) === nameKey(name); })[0];
    if (existing) {
      if (!hereMap()[existing.n]) toggle(existing.n);
      setMsg('info', existing.n + ' is already on the ' + existing.d + ' list and is marked here.');
    } else {
      enqueue({ k: 'add', name: name, den: den, t: Date.now() });
      enqueue({ k: 'mark', date: date, event: eventName, group: group, name: name, present: true, t: Date.now() });
      setMsg('ok', name + ' was added to the ' + den + ' list and marked here.');
    }
    $('addFirst').value = '';
    $('addLast').value = '';
    closeAdd();
    renderList();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (!dateChosen && date !== todayIso()) {
      date = todayIso();
      eventName = '';
    }
    flush();
    load();
  });
  window.addEventListener('online', function () { failures = 0; flush(); load(); });
  window.addEventListener('offline', showSync);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  load();
  flush();
})();
