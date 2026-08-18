// Accrued dashboard for Numa Stays - live data from Exact Online (/api/accrued/*)
// Entities, financial year and G/L account (Accrued Expenses 272200) are filterable.
(function () {
  var ENT = [
    ['HQ', 1000, 3784237, 'Numa Group SE'],
    ['DACH', 900, 3745758, 'Numa Deutschland GmbH'],
    ['DACH', 901, 3745759, 'COSI Hamburg S\u00fcd GmbH'],
    ['DACH', 902, 3745760, 'COSI K\u00f6ln Nord GmbH'],
    ['DACH', 801, 3745740, 'Numa \u00d6sterreich GmbH'],
    ['DACH', 500, 3751399, 'Numa Prague s.r.o.'],
    ['DACH', 302, 3708480, 'Numa Schweiz GmbH'],
    ['WEST', 99, 3642741, 'Numa Netherlands B.V.'],
    ['WEST', 104, 2657065, 'Numa Nederland Operations B.V.'],
    ['WEST', 400, 3383979, 'YAYS Frankrijklei B.V.'],
    ['WEST', 401, 3693157, 'Numa Belgium North SRL'],
    ['WEST', 300, 3706020, 'Numa Norge AS'],
    ['WEST', 301, 3716405, 'numa Danmark ApS'],
    ['WEST', 203, 3741441, 'NUMA France S.A.S.'],
    ['WEST', 600, 3717706, 'numa stays UK Ltd'],
    ['WEST', 610, 3900740, 'Native Places Limited'],
    ['SOUTH', 700, 3725452, 'Numa Stays Espa\u00f1a S.L.'],
    ['SOUTH', 710, 3732987, 'NUMA PORTUGAL, UNIPESSOAL, LDA.'],
    ['SOUTH', 711, 4166557, 'numa Lisbon South, unipessoal Lda'],
    ['SOUTH', 720, 3745729, 'Numa Italia S.r.l.']
  ];
  var GLS = [
    ['272200', 'Accrued Expenses'],
    ['251150', 'Accrued Expenses - AP'],
    ['272205', 'Accrued Expenses - Yokoy'],
    ['272210', 'Accrued Expenses - Budget'],
    ['160200', 'Accrued income']
  ];
  var YEARS = [2026, 2025, 2024];
  var REGIONS = ['HQ', 'DACH', 'WEST', 'SOUTH'];
  var S = { entity: 'consolidated', year: 'all', code: '272200', rows: [], open: {}, det: {}, busy: false, errors: [], q: '', done: 0, total: 0 };

  function el(id) { return document.getElementById(id); }
  function esc(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    s = s.split('&').join('&amp;');
    s = s.split('<').join('&lt;');
    s = s.split('>').join('&gt;');
    s = s.split(String.fromCharCode(34)).join('&quot;');
    return s;
  }
  function eur(n) {
    var v = Number(n || 0);
    return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20ac';
  }
  function fmtDate(v) {
    if (!v) return '';
    var s = String(v);
    var m = s.match(/\/Date\((\-?[0-9]+)/);
    var d = m ? new Date(Number(m[1])) : new Date(s);
    if (isNaN(d.getTime())) return esc(s.slice(0, 10));
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear();
  }
  function entOf(code) {
    for (var i = 0; i < ENT.length; i++) { if (String(ENT[i][1]) === String(code)) return ENT[i]; }
    return null;
  }
  function targets() {
    if (S.entity === 'consolidated') return ENT.slice();
    var e = entOf(S.entity);
    return e ? [e] : [];
  }
  function years() { return S.year === 'all' ? [2024, 2025, 2026] : [parseInt(S.year, 10)]; }
  function shell() {
    var opts = '<option value="consolidated">Consolidated (' + ENT.length + ' selected entities)</option>';
    REGIONS.forEach(function (reg) {
      opts += '<optgroup label="' + reg + '">';
      ENT.filter(function (m) { return m[0] === reg; }).forEach(function (m) {
        opts += '<option value="' + m[1] + '">' + esc(m[1] + ' - ' + m[3]) + '</option>';
      });
      opts += '</optgroup>';
    });
    var yopts = '<option value="all">2024 - 2026 (all)</option>';
    YEARS.forEach(function (y) { yopts += '<option value="' + y + '">' + y + '</option>'; });
    var gopts = '';
    GLS.forEach(function (g) { gopts += '<option value="' + g[0] + '">' + esc(g[1] + ' (' + g[0] + ')') + '</option>'; });
    document.body.innerHTML = [
      '<header>',
      '<div class="brand">Numa Stays</div>',
      '<select class="company" id="company" title="Entity">' + opts + '</select>',
      '<select class="company" id="dashboard" title="Dashboards">',
      '<option value="accrued">Dashboards: Accrued</option>',
      '<option value="ap">Dashboards: AP Ageing</option>',
      '<option value="ar">Dashboards: AR Ageing</option>',
      '<option value="ic">Dashboards: InterCompany</option>',
      '</select>',
      '<span class="pill" id="conn">Checking connection</span>',
      '<div class="spacer"></div>',
      '<button class="btn sec" id="refresh">Refresh</button>',
      '<a class="btn" href="/auth/login">Connect Exact Online</a>',
      '</header>',
      '<div id="entTabs" class="tabs"></div>',
      '<h1>Accrued</h1>',
      '<div class="sub" id="asof">Transactions | G/L Account - live data from Exact Online</div>',
      '<div class="controls">',
      '<div class="ctl"><label for="year">FINANCIAL YEAR</label><select id="year">' + yopts + '</select></div>',
      '<div class="ctl"><label for="gl">G/L ACCOUNT</label><select id="gl">' + gopts + '</select></div>',
      '<div class="ctl grow"><label for="q">SEARCH</label><input id="q" type="text" placeholder="Entry no., description, account"></div>',
      '<div class="ctl"><label>&nbsp;</label><button class="btn" id="apply">Apply</button></div>',
      '<div class="ctl"><label>&nbsp;</label><button class="btn sec" id="expandAll">Expand all</button></div>',
      '</div>',
      '<div class="kpis" id="kpis"></div>',
      '<div class="wrap" id="wrap"><div class="state">Choose a financial year and press Apply</div></div>',
      '<div class="note" id="note"></div>'
    ].join('');
    el('company').value = S.entity;
    el('year').value = String(S.year);
    el('gl').value = S.code;
    el('company').onchange = function () { S.entity = this.value; paintTabs(); run(); };
    el('year').onchange = function () { S.year = this.value; };
    el('gl').onchange = function () { S.code = this.value; };
    el('apply').onclick = function () { run(); };
    el('refresh').onclick = function () { run(); };
    el('expandAll').onclick = function () { expandAll(); };
    el('q').oninput = function () { S.q = this.value; draw(); };
    el('dashboard').value = 'accrued';
    el('dashboard').onchange = function () {
      var v = this.value;
      if (v !== 'accrued') { window.location.href = '/?dashboard=' + v; }
    };
    paintTabs();
  }
  function paintTabs() {
    var bar = el('entTabs');
    if (!bar) return;
    var h = '<button type="button" class="tab' + (S.entity === 'consolidated' ? ' on' : '') + '" data-e="consolidated">Consolidated (' + ENT.length + ')</button>';
    REGIONS.forEach(function (reg) {
      h += '<span class="tabsep">' + reg + '</span>';
      ENT.filter(function (m) { return m[0] === reg; }).forEach(function (m) {
        h += '<button type="button" class="tab' + (String(S.entity) === String(m[1]) ? ' on' : '') + '" data-e="' + m[1] + '" title="' + esc(m[3]) + '">' + esc(m[1] + ' - ' + shortName(m[3])) + '</button>';
      });
    });
    bar.innerHTML = h;
    var bs = bar.querySelectorAll('button.tab');
    for (var i = 0; i < bs.length; i++) {
      bs[i].onclick = function () {
        S.entity = this.getAttribute('data-e');
        if (el('company')) el('company').value = S.entity;
        paintTabs();
        run();
      };
    }
  }
  function shortName(n) {
    var s = String(n || '');
    s = s.replace(/ GmbH| B\.V\.| S\.L\.| S\.r\.l\.| SRL| ApS| AS| SE| Ltd| Limited| s\.r\.o\.| S\.A\.S\.|, unipessoal Lda|, UNIPESSOAL, LDA\.|LDA\./g, '');
    return s.trim();
  }

  function conn() {
    fetch('/api/status', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      var p = el('conn');
      if (!p) return;
      var ok = j && (j.authenticated || j.connected || j.status === 'ok');
      p.className = 'pill ' + (ok ? 'ok' : 'bad');
      p.textContent = ok ? 'Connected to Exact Online' : 'Not connected';
    }).catch(function () {
      var p = el('conn');
      if (p) { p.className = 'pill bad'; p.textContent = 'Connection unknown'; }
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function fetchOne(div, year) {
    for (var a = 0; a < 3; a++) {
      try {
        var r = await fetch('/api/accrued/transactions?division=' + div + '&year=' + year + '&code=' + encodeURIComponent(S.code), { credentials: 'same-origin' });
        var j = await r.json();
        if (r.ok && j && !j.error) return j;
        if (r.status === 401) return { error: 'Not connected to Exact Online' };
        if (a === 2) return { error: (j && (j.error || j.detail)) || ('HTTP ' + r.status) };
      } catch (e) {
        if (a === 2) return { error: String(e) };
      }
      await sleep(1200);
    }
    return { error: 'unknown' };
  }

  async function run() {
    if (S.busy) return;
    S.busy = true;
    S.rows = [];
    S.open = {};
    S.det = {};
    S.errors = [];
    var list = targets();
    var ys = years();
    S.total = list.length * ys.length;
    S.done = 0;
    draw();
    for (var i = 0; i < list.length; i++) {
      for (var k = 0; k < ys.length; k++) {
        var m = list[i];
        setStatus('Loading ' + (S.done + 1) + '/' + S.total + ' - ' + m[1] + ' ' + m[3] + ' (' + ys[k] + ')');
        var j = await fetchOne(m[2], ys[k]);
        S.done++;
        if (j.error) {
          S.errors.push(m[1] + ' ' + ys[k] + ': ' + j.error);
        } else {
          (j.lines || []).forEach(function (l) {
            l.entityCode = m[1];
            l.entityName = m[3];
            l.division = m[2];
            S.rows.push(l);
          });
        }
        draw();
      }
    }
    S.busy = false;
    setStatus('');
    draw();
  }

  function setStatus(t) {
    var a = el('asof');
    if (!a) return;
    a.textContent = t || ('Transactions | G/L Account ' + S.code + ' - ' + (S.year === 'all' ? '2024 - 2026' : S.year) + ' - updated ' + new Date().toLocaleTimeString('de-DE'));
  }
  function filtered() {
    var q = (S.q || '').trim().toLowerCase();
    if (!q) return S.rows;
    return S.rows.filter(function (l) {
      var hay = [l.entryNumber, l.description, l.accountCode, l.accountName, l.journalCode, l.journalDescription, l.entityName, l.entityCode].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function keyOf(l) { return l.division + '-' + l.entryNumber; }

  function draw() {
    var rows = filtered();
    var d = 0, c = 0, ents = {};
    rows.forEach(function (l) { d += l.debit; c += l.credit; ents[l.entityCode] = 1; });
    var bal = d - c;
    var okBal = Math.abs(bal) < 0.005;
    var k = el('kpis');
    if (k) {
      k.innerHTML = [
        kpi('TRANSACTION LINES', String(rows.length), (S.busy ? 'loading ' + S.done + '/' + S.total : Object.keys(ents).length + ' entities')),
        kpi('TOTAL DEBIT', eur(d), 'sum of all debit lines'),
        kpi('TOTAL CREDIT', eur(c), 'sum of all credit lines'),
        kpi('BALANCE (DEBIT - CREDIT)', eur(bal), okBal ? 'balanced' : 'not balanced', okBal ? 'var(--green)' : 'var(--yellow)')
      ].join('');
    }
    var w = el('wrap');
    if (!w) return;
    if (!rows.length) {
      w.innerHTML = '<div class="state">' + (S.busy ? 'Loading data from Exact Online (' + S.done + '/' + S.total + ')' : 'No transactions for this selection') + '</div>';
      note();
      return;
    }
    var cons = S.entity === 'consolidated';
    var h = '<table><thead><tr>';
    h += '<th style="width:22px"></th>';
    if (cons) h += '<th>Entity</th>';
    h += '<th>Date</th><th>Entry no.</th><th>Journal</th><th>Description</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th>';
    h += '</tr></thead><tbody>';
    rows.forEach(function (l) {
      var key = keyOf(l);
      var isOpen = !!S.open[key];
      h += '<tr class="row" data-k="' + esc(key) + '" data-e="' + esc(l.entryNumber) + '" data-d="' + esc(l.division) + '" data-y="' + esc(l.year) + '">';
      h += '<td class="caret">' + (isOpen ? '\u25be' : '\u25b8') + '</td>';
      if (cons) h += '<td>' + esc(l.entityCode + ' - ' + shortName(l.entityName)) + '</td>';
      h += '<td>' + fmtDate(l.date) + '</td>';
      h += '<td class="mono link">' + esc(l.entryNumber) + '</td>';
      h += '<td>' + esc(l.journalCode + (l.journalDescription ? ' - ' + l.journalDescription : '')) + '</td>';
      h += '<td>' + esc(l.description) + '</td>';
      h += '<td>' + esc(l.accountCode ? (l.accountCode + ' - ' + l.accountName) : l.accountName) + '</td>';
      h += '<td class="num">' + (l.debit ? eur(l.debit) : '') + '</td>';
      h += '<td class="num">' + (l.credit ? eur(l.credit) : '') + '</td>';
      h += '</tr>';
      if (isOpen) {
        h += '<tr class="detail"><td colspan="' + (cons ? 9 : 8) + '">' + detailHtml(key) + '</td></tr>';
      }
    });
    h += '</tbody><tfoot>';
    h += '<tr><td colspan="' + (cons ? 6 : 5) + '">Total</td><td></td><td class="num">' + eur(d) + '</td><td class="num">' + eur(c) + '</td></tr>';
    h += '<tr><td colspan="' + (cons ? 6 : 5) + '">Balance (Debit - Credit)</td><td></td><td class="num" colspan="2" style="color:' + (okBal ? '#33d755' : '#ffc107') + '">' + eur(bal) + (okBal ? '  \u2713 balanced' : '  \u26a0 not balanced') + '</td></tr>';
    h += '</tfoot></table>';
    w.innerHTML = h;
    var trs = w.querySelectorAll('tr.row');
    for (var i = 0; i < trs.length; i++) {
      trs[i].onclick = function () { toggle(this.getAttribute('data-k'), this.getAttribute('data-d'), this.getAttribute('data-e'), this.getAttribute('data-y')); };
    }
    note();
  }

  function kpi(t, v, s, color) {
    return '<div class="kpi"><div class="t">' + esc(t) + '</div><div class="v"' + (color ? ' style="color:' + color + '"' : '') + '>' + v + '</div><div class="s">' + esc(s || '') + '</div></div>';
  }

  function note() {
    var n = el('note');
    if (!n) return;
    var t = 'Click a row (Entry no.) to open the full entry: G/L Account, Description, Debit, Credit and the entry total (balance check).';
    if (S.errors.length) t += ' Errors: ' + S.errors.join(' | ');
    n.textContent = t;
  }
  function detailHtml(key) {
    var dt = S.det[key];
    if (!dt) return '<div class="dstate">Loading entry ...</div>';
    if (dt.error) return '<div class="dstate" style="color:#ff5c5c">' + esc(dt.error) + '</div>';
    var lines = dt.lines || [];
    var h = '<div class="dhead">Entry number ' + esc(dt.entryNumber) + (dt.journal ? ' &middot; Journal ' + esc(dt.journal) : '') + (dt.year ? ' &middot; Financial year / Period ' + esc(dt.year) + ' - ' + esc(dt.period) : '') + '</div>';
    h += '<table class="inner"><thead><tr><th>No.</th><th>Date</th><th>G/L Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>';
    lines.forEach(function (l) {
      h += '<tr>';
      h += '<td>' + esc(l.lineNumber) + '</td>';
      h += '<td>' + fmtDate(l.date) + '</td>';
      h += '<td>' + esc(l.glCode + (l.glDescription ? ' - ' + l.glDescription : '')) + '</td>';
      h += '<td>' + esc(l.description) + '</td>';
      h += '<td class="num">' + (l.debit ? eur(l.debit) : '') + '</td>';
      h += '<td class="num">' + (l.credit ? eur(l.credit) : '') + '</td>';
      h += '</tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="4">Total</td><td class="num">' + eur(dt.totals.debit) + '</td><td class="num">' + eur(dt.totals.credit) + '</td></tr>';
    h += '<tr><td colspan="4">Balance check</td><td colspan="2" class="num" style="color:' + (dt.totals.balanced ? '#33d755' : '#ffc107') + '">' + (dt.totals.balanced ? 'Debit = Credit \u2713' : 'Difference ' + eur(dt.totals.balance) + ' \u26a0') + '</td></tr>';
    h += '</tfoot></table>';
    return h;
  }

  async function loadDetail(key, div, entry, year) {
    if (S.det[key]) return;
    S.det[key] = null;
    try {
      var url = '/api/accrued/entry?division=' + div + '&entry=' + encodeURIComponent(entry) + (year ? '&year=' + encodeURIComponent(year) : '');
      var r = await fetch(url, { credentials: 'same-origin' });
      var j = await r.json();
      if (!r.ok || (j && j.error)) {
        S.det[key] = { error: (j && (j.error || j.detail)) || ('HTTP ' + r.status) };
      } else {
        S.det[key] = j;
      }
    } catch (e) {
      S.det[key] = { error: String(e) };
    }
    draw();
  }

  function toggle(key, div, entry, year) {
    if (S.open[key]) { delete S.open[key]; draw(); return; }
    S.open[key] = 1;
    draw();
    if (!S.det[key]) loadDetail(key, div, entry, year);
  }

  async function expandAll() {
    var rows = filtered().slice(0, 15);
    for (var i = 0; i < rows.length; i++) {
      var l = rows[i];
      var key = keyOf(l);
      S.open[key] = 1;
      draw();
      if (!S.det[key]) await loadDetail(key, l.division, l.entryNumber, l.year);
    }
  }

  shell();
  conn();
  setStatus('');
  run();
  setInterval(conn, 300000);
})();
