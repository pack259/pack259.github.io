/* Pack 259 Pinewood Derby - check-in page. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  var pendingCar = null;   // car number waiting for a station code
  var current = null;      // last car response being shown
  var loadToken = 0;
  var scanner = null;

  var QR_LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js',
    'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'
  ];

  function show(id, on) { $(id).classList.toggle('hidden', !on); }

  function setMsg(kind, text) {
    var m = $('msg');
    m.innerHTML = '';
    if (text) m.appendChild(el('div', { class: 'banner ' + kind, text: text }));
  }

  function focusScan() {
    if (!finePointer || !$('codeCard').classList.contains('hidden')) return;
    $('scanInput').focus();
  }

  function updateStationLabel() {
    $('stationLabel').textContent = getCode() ? ('Station: ' + (getStation() || 'unnamed')) : 'Not signed in';
  }

  function clearQuery() {
    if (location.search && history.replaceState) history.replaceState(null, '', location.pathname);
  }

  /* ---------------- station code */

  function showCodePrompt(n, errText) {
    pendingCar = n || null;
    show('scanCard', false);
    show('carCard', false);
    setMsg('', '');
    show('codeCard', true);
    $('codeCarNo').textContent = n ? '#' + n : '';
    show('codeCarNo', !!n);
    $('stationInput').value = getStation() || (finePointer ? 'Laptop' : 'Phone');
    $('codeErr').textContent = errText || '';
    show('codeErr', !!errText);
    updateStationLabel();
    if (finePointer) $('codeInput').focus();
  }

  $('codeForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var code = $('codeInput').value.trim();
    if (!code) return;
    $('codeBtn').disabled = true;
    $('codeBtn').textContent = 'Checking...';
    api('ping', {}, code).then(function (r) {
      $('codeBtn').disabled = false;
      $('codeBtn').textContent = 'Save code';
      if (r.ok) {
        setCode(code);
        setStation($('stationInput').value.trim() || (finePointer ? 'Laptop' : 'Phone'));
        $('codeInput').value = '';
        if (r.event) $('event').textContent = r.event;
        show('codeCard', false);
        show('scanCard', true);
        updateStationLabel();
        if (pendingCar) loadCar(pendingCar); else focusScan();
      } else {
        $('codeErr').textContent = r.error === 'bad_code' ? 'That code is not right. Check it and try again.'
          : r.error === 'not_configured' ? 'The station code has not been set up in the Sheet yet.'
          : (r.message || 'Something went wrong. Try again.');
        show('codeErr', true);
      }
    });
  });

  $('signOutBtn').addEventListener('click', function () {
    if (getCode() && !confirm('Sign this device out? You will need the station code again.')) return;
    signOut();
    clearQuery();
    showCodePrompt(null);
  });

  /* ---------------- scanning */

  function handleScan(text) {
    var n = parseCar(text);
    $('scanInput').value = '';
    if (!n) { setMsg('bad', 'That is not a car number: "' + String(text).slice(0, 40) + '"'); focusScan(); return; }
    loadCar(n);
  }

  $('scanForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = $('scanInput').value.trim();
    if (v) handleScan(v);
  });

  // Keep the scan box focused on the race laptop whenever nothing else is in use.
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest('input, button, label, a, select, textarea, #camera')) focusScan();
  });

  /* ---------------- car */

  function loadCar(n) {
    var token = ++loadToken;
    current = null;
    setMsg('', '');
    show('carCard', true);
    $('carNo').textContent = '#' + n;
    $('carRank').className = 'badge hidden';
    $('carBody').innerHTML = '';
    $('carBody').appendChild(el('p', { class: 'muted', text: 'Loading...' }));
    api('car', { n: n }).then(function (r) {
      if (token !== loadToken) return;
      if (!r.ok) {
        if (r.error === 'bad_code' || r.error === 'not_configured') {
          signOut();
          showCodePrompt(n, 'The station code has changed. Enter the new code.');
          return;
        }
        $('carBody').innerHTML = '';
        if (r.error === 'unknown') {
          $('carBody').appendChild(el('div', { class: 'banner bad',
            text: 'Car #' + n + ' is not on the roster and is not a spare. Check the number, or use a spare label.' }));
        } else {
          $('carBody').appendChild(el('div', { class: 'banner bad', text: r.message || ('Error: ' + r.error) }));
          var retry = el('button', { type: 'button', class: 'btn secondary', text: 'Try again' });
          retry.onclick = function () { loadCar(n); };
          $('carBody').appendChild(retry);
        }
        focusScan();
        return;
      }
      if (r.event) $('event').textContent = r.event;
      current = r;
      renderCar(r);
    });
  }

  function renderCar(r) {
    var car = r.car, isOutlaw = car.rank === 'Outlaw', isNew = car.spare && !car.claimed;
    $('carNo').textContent = '#' + car.n;
    $('carRank').textContent = car.rank;
    $('carRank').className = 'badge ' + rankClass(car.rank);
    var b = $('carBody');
    b.innerHTML = '';

    if (isNew) {
      b.appendChild(el('div', { class: 'banner new', text: 'New entry - ' + (isOutlaw ? 'Outlaw car' : car.rank + ' walk-up') }));
      b.appendChild(el('label', { for: 'firstName', text: 'First Name' }));
      b.appendChild(el('input', { type: 'text', id: 'firstName', autocomplete: 'off', autocapitalize: 'words', maxlength: '40' }));
      b.appendChild(el('label', { for: 'lastName', text: 'Last Name' }));
      b.appendChild(el('input', { type: 'text', id: 'lastName', autocomplete: 'off', autocapitalize: 'words', maxlength: '40' }));
    } else {
      b.appendChild(el('div', { class: 'name', text: car.first + ' ' + car.last }));
      if (car.spare) b.appendChild(el('div', { class: 'hint', text: 'Walk-up entry. Confirm this is the right racer.' }));
    }

    if (r.latest) {
      var L = r.latest;
      var txt = 'Last weigh-in ' + fmtTime(L.ts) + ': ' + (L.weight === null ? 'no weight' : fmtWeight(L.weight)) +
        ', ' + (L.passed ? 'PASSED' : 'NOT PASSED') + (L.fits ? '' : ' (did not fit in box)') +
        (L.station ? ' - ' + L.station : '') + '. Weighed ' + r.weighIns + (r.weighIns === 1 ? ' time' : ' times') +
        '. Saving again records a re-weigh; the history is kept.';
      b.appendChild(el('div', { class: 'last', text: txt }));
    }

    var chk = el('input', { type: 'checkbox', id: 'fits' });
    b.appendChild(el('label', { class: 'check', for: 'fits' }, [chk, 'Fits in box']));

    b.appendChild(el('label', { for: 'weight', text: isOutlaw ? 'Weight (optional)' : 'Weight' }));
    var w = el('input', { type: 'text', id: 'weight', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off', maxlength: '6' });
    b.appendChild(el('div', { class: 'weight' }, [w, el('span', { text: 'oz' })]));
    if (!isOutlaw) b.appendChild(el('div', { class: 'hint', text: 'Limit ' + Number(r.limit).toFixed(2) + ' oz' }));
    var warn = el('div', { class: 'warn hidden', id: 'warn', text: 'Over limit - send to fix-it table' });
    b.appendChild(warn);

    var save = el('button', { type: 'button', class: 'btn green', id: 'saveBtn', text: 'Confirm and save' });
    b.appendChild(save);
    var cancel = el('button', { type: 'button', class: 'linkbtn', text: 'Cancel' });
    cancel.style.marginTop = '10px';
    b.appendChild(cancel);

    w.addEventListener('input', function () {
      var v = parseWeight(w.value);
      warn.classList.toggle('hidden', isOutlaw || !(v > r.limit + 1e-9));
    });
    save.addEventListener('click', saveCar);
    cancel.addEventListener('click', function () { show('carCard', false); current = null; clearQuery(); focusScan(); });

    // A scanner that fires while a form field has focus types a URL into it; treat that as a new scan.
    Array.prototype.forEach.call(b.querySelectorAll('input[type=text]'), function (inp) {
      inp.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        var m = inp.value.match(/(https?:\/\/\S*|\S*[?&]n=\d+\S*)$/i);
        if (m) {
          inp.value = inp.value.slice(0, m.index);
          handleScan(m[1]);
        } else if (inp.id === 'weight') {
          saveCar();
        } else {
          var next = inp.id === 'firstName' ? $('lastName') : $('weight');
          if (next) next.focus();
        }
      });
    });

    if (finePointer) (isNew ? $('firstName') : w).focus();
  }

  function parseWeight(s) {
    s = String(s || '').trim().replace(',', '.');
    if (!s) return null;
    if (!/^\d*\.?\d*$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 100) / 100;
  }

  function saveCar() {
    if (!current) return;
    var car = current.car, isOutlaw = car.rank === 'Outlaw', isNew = car.spare && !car.claimed;
    var first = '', last = '';
    if (isNew) {
      first = $('firstName').value.trim();
      last = $('lastName').value.trim();
      if (!first || !last) { alert('Enter both the first and last name.'); (first ? $('lastName') : $('firstName')).focus(); return; }
    }
    var weight = parseWeight($('weight').value);
    if (weight !== null && !(weight > 0 && weight < 50)) { alert('The weight does not look right. Enter it like 4.98'); $('weight').focus(); return; }
    if (!isOutlaw && weight === null) { alert('Enter the weight.'); $('weight').focus(); return; }
    var fits = $('fits').checked;
    if (!fits && !confirm('"Fits in box" is not checked. Save this car as NOT passed?')) return;

    var btn = $('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    var n = car.n;
    api('save', { n: n, first: first, last: last, fits: fits, weight: weight, station: getStation() }).then(function (r) {
      if (!r.ok) {
        btn.disabled = false;
        btn.textContent = 'Confirm and save';
        if (r.error === 'bad_code' || r.error === 'not_configured') {
          signOut(); showCodePrompt(n, 'The station code has changed. Enter the new code, then scan the car again.'); return;
        }
        var why = {
          already_claimed: r.car ? ('Car #' + n + ' was just claimed by ' + r.car.first + ' ' + r.car.last +
                           ' at another station. Use a different spare label.') : 'That spare was just claimed at another station.',
          name_required: 'Enter both the first and last name.',
          weight_required: 'Enter the weight.',
          bad_weight: 'The weight does not look right.',
          busy: 'Another station is saving right now. Tap save again.',
          unknown: 'Car #' + n + ' is no longer on the roster.'
        }[r.error] || r.message || ('Error: ' + r.error);
        setMsg('bad', 'Not saved. ' + why);
        return;
      }
      var s = r.saved, wtxt = s.weight === null ? '' : ', ' + Number(s.weight).toFixed(2) + ' oz';
      if (s.passed) {
        setMsg('ok', '#' + n + ' checked in' + wtxt + ' - write ' + (s.weight === null ? '' : 'weight and ') + 'initials on the sheet');
      } else {
        var reason = r.overLimit ? 'Over limit - send to fix-it table' : 'Did not fit in box - send to fix-it table';
        if (r.overLimit && !s.fits) reason = 'Over limit and did not fit in box - send to fix-it table';
        setMsg('bad', '#' + n + ' saved, NOT passed' + wtxt + '. ' + reason + '. Write weight and initials on the sheet.');
      }
      current = null;
      show('carCard', false);
      clearQuery();
      focusScan();
    });
  }

  /* ---------------- camera */

  function loadScript(urls) {
    return new Promise(function (resolve, reject) {
      if (window.Html5Qrcode) return resolve();
      var i = 0;
      (function next() {
        if (i >= urls.length) return reject(new Error('Could not load the camera scanner.'));
        var s = document.createElement('script');
        s.src = urls[i++];
        s.onload = function () { window.Html5Qrcode ? resolve() : next(); };
        s.onerror = next;
        document.head.appendChild(s);
      })();
    });
  }

  function stopCamera() {
    var s = scanner;
    scanner = null;
    show('camera', false);
    if (s) s.stop().catch(function () {}).then(function () { try { s.clear(); } catch (e) {} });
  }

  $('cameraBtn').addEventListener('click', function () {
    show('camera', true);
    $('cameraMsg').textContent = 'Starting camera...';
    loadScript(QR_LIBS).then(function () {
      scanner = new Html5Qrcode('reader');
      var done = false;
      return scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } },
        function (text) {
          if (done) return;
          var n = parseCar(text);
          if (!n) { $('cameraMsg').textContent = 'That QR code is not a car label.'; return; }
          done = true;
          stopCamera();
          loadCar(n);
        }, function () {}).then(function () {
          $('cameraMsg').textContent = 'Point the camera at the QR code on the bottom of the car.';
        });
    }).catch(function (err) {
      $('cameraMsg').textContent = 'Camera not available: ' + (err && err.message ? err.message : err) +
        '. Allow camera access for this site, or type the car number instead.';
    });
  });
  $('cameraCancel').addEventListener('click', function () { stopCamera(); focusScan(); });

  /* ---------------- start */

  var startCar = parseCar(location.search);
  if (!getCode()) {
    showCodePrompt(startCar);
  } else {
    show('scanCard', true);
    updateStationLabel();
    if (startCar) loadCar(startCar); else focusScan();
  }
})();
