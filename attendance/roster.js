/* Pack 259 attendance - roster page. Reads a Scoutbook roster export on this
 * device, sends only names and dens, shows what will change, then applies it. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var HIDE = '__hide__';
  var scouts = null, fileName = '';

  function getCode() { return store('att.rosterCode'); }
  function show(id, on) { $(id).classList.toggle('hidden', !on); }

  function setMsg(kind, text) {
    var m = $('msg');
    m.innerHTML = '';
    if (text) m.appendChild(el('div', { class: 'banner ' + kind, text: text }));
  }

  function render() {
    show('codeCard', !getCode());
    show('fileCard', !!getCode());
  }

  /* ---------------- reading the file */

  /** Splits CSV text into rows of cells (quoted cells may hold commas and line breaks). */
  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /**
   * Finds the youth section of a Scoutbook roster report (or any CSV with
   * First Name / Last Name or Scout columns) and returns [{name, den}].
   */
  function readRoster(text) {
    var tidy = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
    var rows = parseCsv(text).map(function (r) { return r.map(tidy); });
    var marker = function (r) {
      var cells = r.filter(Boolean);
      return cells.length === 1 && /^[a-z ]*members$/i.test(cells[0]) ? cells[0].toUpperCase() : '';
    };
    var start = 0, sawSection = false;
    for (var i = 0; i < rows.length; i++) {
      var m = marker(rows[i]);
      if (m) sawSection = true;
      if (m === 'YOUTH MEMBERS') { start = i + 1; break; }
    }
    if (sawSection && !start) return { error: 'This file has no youth members section. Download the roster report that lists the scouts.' };

    var cols = null, h = -1;
    for (i = start; i < rows.length && h < 0; i++) {
      var low = rows[i].map(function (c) { return c.toLowerCase(); });
      var first = low.indexOf('first name'), last = low.indexOf('last name'), name = low.indexOf('scout');
      if (name < 0) name = low.indexOf('name');
      if ((first >= 0 && last >= 0) || name >= 0) {
        h = i;
        cols = { first: first, last: last, suffix: low.indexOf('suffix'), name: first >= 0 && last >= 0 ? -1 : name,
                 den: low.indexOf('den') };
      }
    }
    if (h < 0) return { error: 'Could not find the First Name and Last Name columns in this file.' };

    var out = [], seen = {};
    for (i = h + 1; i < rows.length; i++) {
      var r = rows[i];
      if (marker(r)) break;
      if (!r.some(Boolean)) continue;
      var full = cols.name >= 0 ? r[cols.name]
        : tidy([r[cols.first], r[cols.last], cols.suffix >= 0 ? r[cols.suffix] : ''].join(' '));
      if (!full || full.length < 2 || seen[nameKey(full)]) continue;
      seen[nameKey(full)] = true;
      out.push({ name: full, den: cols.den >= 0 ? (r[cols.den] || '') : '' });
    }
    if (!out.length) return { error: 'No scouts were found in this file.' };
    return { scouts: out, hasDen: cols.den >= 0 };
  }

  /** Scoutbook exports are usually UTF-8; older ones are Windows-1252. */
  function readText(file) {
    return file.arrayBuffer().then(function (buf) {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
      catch (e) { return new TextDecoder('windows-1252').decode(buf); }
    });
  }

  /* ---------------- showing the changes */

  function section(title, items, line) {
    if (!items.length) return null;
    return el('div', null, [
      el('h3', null, [title + ' ', el('span', { class: 'n', text: '(' + items.length + ')' })]),
      el('ul', null, items.map(function (x) { return el('li', { text: line(x) }); }))
    ]);
  }

  function showCheck(r) {
    var c = r.check, body = $('checkBody');
    body.innerHTML = '';
    $('checkTitle').textContent = 'Changes from ' + fileName;
    body.appendChild(el('p', { class: 'hint', text: 'The file lists ' + r.count + ' scouts. ' +
      c.same + ' are already on the attendance roster with no change.' }));
    if (r.was && r.count < r.was * 0.6) {
      body.appendChild(el('div', { class: 'banner warn', text: 'This file has ' + r.count + ' scouts, but the attendance roster has ' +
        r.was + ' from Scoutbook. Make sure it is the whole pack roster before you update.' }));
    }
    if (c.unknownDens.length) {
      body.appendChild(el('div', { class: 'banner warn', text: 'These den names were not recognized, so those scouts go under "No den": ' +
        c.unknownDens.join(', ') + '.' }));
    }
    var parts = [
      section('New scouts', c.add, function (x) { return x.name + ' (' + x.den + ')'; }),
      section('Changing den', c.move, function (x) { return x.name + ': ' + x.from + ' to ' + x.to; }),
      section('Back on the roster', c.back, function (x) { return x.name + ' (' + x.den + ')'; }),
      section('Added by a leader, now in Scoutbook', c.registered, function (x) { return x.name + ' (' + x.den + ')'; }),
      section('Not in this file, so they come off the phones (their attendance is kept)', c.leave,
        function (x) { return x.name + ' (' + x.den + ')'; })
    ];
    parts.forEach(function (p) { if (p) body.appendChild(p); });

    if (c.unmatched.length) {
      body.appendChild(el('h3', null, ['Added by leaders, not in Scoutbook ', el('span', { class: 'n', text: '(' + c.unmatched.length + ')' })]));
      body.appendChild(el('p', { class: 'hint', text: 'If one of these is a Scoutbook scout under another name (a nickname or a typo), ' +
        'choose that name and the attendance moves over. Otherwise leave them on the list, or take them off the phones.' }));
      var allNames = scouts.map(function (s) { return s.name; }).sort(function (a, b) { return lastFirst(a) < lastFirst(b) ? -1 : 1; });
      c.unmatched.forEach(function (u) {
        var sel = el('select', { 'data-name': u.name, 'aria-label': 'What to do with ' + u.name });
        sel.appendChild(el('option', { value: '', text: 'Keep on the list as is' }));
        sel.appendChild(el('option', { value: HIDE, text: 'Take off the phones (visitor or left)' }));
        var group = el('optgroup', { label: 'Same scout as (Scoutbook name)' });
        var listed = {};
        u.suggestions.concat(allNames).forEach(function (n) {
          if (listed[n]) return;
          listed[n] = true;
          group.appendChild(el('option', { value: n, text: n }));
        });
        sel.appendChild(group);
        var who = u.name + ' (' + u.den + ')' + (u.by ? ', added by ' + u.by : '') + (u.on ? ' on ' + u.on : '');
        var hint = u.suggestions.length ? 'Possible match: ' + u.suggestions.join(', ') : '';
        body.appendChild(el('div', { class: 'match' }, [el('div', { class: 'who', text: who }),
          hint ? el('div', { class: 'hint', text: hint }) : null, sel]));
      });
    }
    var nothing = !c.add.length && !c.move.length && !c.back.length && !c.registered.length && !c.leave.length && !c.unmatched.length;
    if (nothing) body.appendChild(el('div', { class: 'banner ok', text: 'The attendance roster already matches this file.' }));
    $('applyBtn').disabled = false;
    $('applyBtn').textContent = 'Update the roster';
    show('applyBtn', !nothing);
    show('checkCard', true);
  }

  function matches() {
    var out = {};
    Array.prototype.forEach.call($('checkBody').querySelectorAll('select[data-name]'), function (s) {
      if (s.value) out[s.getAttribute('data-name')] = s.value;
    });
    return out;
  }

  /* ---------------- controls */

  $('codeForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var code = $('codeInput').value.trim();
    if (!code) return;
    $('codeBtn').disabled = true;
    show('codeErr', false);
    api('ping', {}, code).then(function (r) {
      $('codeBtn').disabled = false;
      if (r.ok && r.role === 'roster') {
        store('att.rosterCode', code);
        $('codeInput').value = '';
        render();
      } else {
        $('codeErr').textContent = r.ok ? 'That is the leader code. This page needs the roster code from the Config tab.' : errorText(r);
        show('codeErr', true);
      }
    });
  });

  $('signOutBtn').addEventListener('click', function () {
    store('att.rosterCode', null);
    show('checkCard', false);
    setMsg('', '');
    render();
  });

  $('fileInput').addEventListener('change', function () {
    var file = this.files && this.files[0];
    show('fileErr', false);
    show('checkCard', false);
    setMsg('', '');
    if (!file) return;
    fileName = file.name;
    readText(file).then(function (text) {
      var parsed = readRoster(text);
      if (parsed.error) {
        $('fileErr').textContent = parsed.error;
        show('fileErr', true);
        return;
      }
      scouts = parsed.scouts;
      setMsg('info', 'Checking ' + scouts.length + ' scouts against the attendance roster\u2026');
      return api('rosterCheck', { scouts: scouts }, getCode()).then(function (r) {
        if (!r.ok) {
          if (r.error === 'bad_code') store('att.rosterCode', null);
          setMsg('bad', errorText(r));
          render();
          return;
        }
        setMsg('', '');
        showCheck(r);
      });
    });
  });

  $('applyBtn').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Updating\u2026';
    api('rosterApply', { scouts: scouts, matches: matches() }, getCode()).then(function (r) {
      if (!r.ok) {
        btn.disabled = false;
        btn.textContent = 'Update the roster';
        setMsg('bad', errorText(r));
        return;
      }
      var c = r.result, bits = [];
      if (c.add.length) bits.push(c.add.length + ' added');
      if (c.move.length) bits.push(c.move.length + ' changed den');
      if (c.back.length) bits.push(c.back.length + ' back on the roster');
      if (c.merge.length) bits.push(c.merge.length + ' matched to their Scoutbook name');
      if (c.leave.length + c.hide.length) bits.push((c.leave.length + c.hide.length) + ' taken off the phones');
      show('checkCard', false);
      $('fileInput').value = '';
      setMsg('ok', 'The roster is updated' + (bits.length ? ': ' + bits.join(', ') : '') +
        '. Leaders see the new list the next time they open the attendance page.');
    });
  });

  render();
})();
