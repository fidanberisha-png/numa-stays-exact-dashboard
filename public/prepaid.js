// PrePaid dashboard for Numa Stays.
// The page only draws what the server sends. All the reading, the cleaning of
// double bookings and the amortisation itself happen in prepaid-routes.js, so
// the numbers on the screen are the numbers of Exact Online.
(function () {
  var ENT = [
    ['HQ', 1000, 3784237, 'Numa Group SE'],
    ['DACH', 900, 3745758, 'Numa Deutschland GmbH'],
    ['DACH', 901, 3745759, 'COSI Hamburg Sued GmbH'],
    ['DACH', 902, 3745760, 'COSI Koeln Nord GmbH'],
    ['DACH', 801, 3745740, 'Numa Oesterreich GmbH'],
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
    ['SOUTH', 700, 3725452, 'Numa Stays Espana S.L.'],
    ['SOUTH', 710, 3732987, 'NUMA PORTUGAL, UNIPESSOAL, LDA.'],
    ['SOUTH', 711, 4166557, 'numa Lisbon South, unipessoal Lda'],
    ['SOUTH', 720, 3745729, 'Numa Italia S.r.l.']
  ];
  var REGIONS = ['HQ', 'DACH', 'WEST', 'SOUTH'];
  var YEARS = [2027, 2026, 2025, 2024];
  var CODE = '160100';
  var NL = String.fromCharCode(10);
  var QT = String.fromCharCode(34);

  var S = {
    entity: '', year: '2025', journal: 'all', mode: 'period',
    cut: 'year', cutDate: '', from: '', to: '', q: '',
    open: {}, data: null, fresh: false, busy: false, err: ''
  };

  function el(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function eur(n) {
    return (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  function n0(n) { return (Number(n) || 0).toLocaleString('de-DE'); }
  function division(code) {
    for (var i = 0; i < ENT.length; i++) { if (String(ENT[i][1]) === String(code)) return ENT[i][2]; }
    return null;
  }
  function entName(code) {
    for (var i = 0; i < ENT.length; i++) { if (String(ENT[i][1]) === String(code)) return ENT[i][1] + ' - ' + ENT[i][3]; }
    return '';
  }
  // dd-mm-yyyy to a number that can be compared, and the same for yyyy-mm-dd.
  function dnum(dmy) {
    var s = String(dmy || '');
    if (s.length < 10) return 0;
    return Number(s.slice(6, 10) + s.slice(3, 5) + s.slice(0, 2)) || 0;
  }
  function isoToNum(iso) {
    var s = String(iso || '');
    if (s.length < 10) return 0;
    return Number(s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 10)) || 0;
  }

  // The style of the Accrued page is copied in, so both dashboards keep exactly
  // the same look and there is only one copy of the style to maintain.
  async function skin() {
    try {
      var r = await fetch('/accrued.html', { credentials: 'same-origin' });
      var t = await r.text();
      var a = t.indexOf('<style');
      var b = t.indexOf('</style>');
      if (a >= 0 && b > a) document.head.insertAdjacentHTML('beforeend', t.slice(a, b + 8));
    } catch (e) { }
    var extra = '<style>' +
      '.pcard{background:#fdeaf3;border:1px solid #f3d5e4;border-radius:10px;padding:12px 14px;margin:14px 0}' +
      '.pcard h3{margin:0 0 8px 0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a6e7d}' +
      '.jtab{width:100%;border-collapse:collapse;font-size:13px}' +
      '.jtab th{text-align:left;color:#8a6e7d;font-weight:600;padding:4px 8px;border-bottom:1px solid #f3d5e4}' +
      '.jtab td{padding:4px 8px;border-bottom:1px solid #fdeaf3}' +
      '.jtab td.r,.jtab th.r{text-align:right}' +
      '.tag{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;border:1px solid #f3d5e4}' +
      '.tag.ok{color:#0f9d76;border-color:#8fd8b4}' +
      '.tag.man{color:#b45309;border-color:#e6b56a}' +
      '.warn{color:#b45309}' +
      '.muted{color:#8a6e7d}' +
      '.gbar{display:flex;align-items:center;gap:8px;margin:0 0 8px 0}' +
      '.grp{border:1px solid #f3d5e4;border-radius:10px;margin-bottom:8px;overflow:hidden}' +
      '.ghead{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fdeaf3;cursor:pointer}' +
      '.ghead:hover{background:#fce3ef}' +
      '.ghead .arw{width:14px;color:#8a6e7d}' +
      '.ghead .gcode{font-weight:700;min-width:90px}' +
      '.ghead .gname{flex:1;color:#8a6e7d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.ghead .gnum{min-width:130px;text-align:right}' +
      '.ghead .gpre{font-weight:700}' +
      '.ghead.gtot{background:#fff2f8;border:1px solid #f3d5e4;border-radius:10px;cursor:default;font-weight:700}' +
      '.gbody{padding:6px 10px 10px 10px;background:#fff2f8}' +
      '.ctl input[type=date],.ctl input[type=text],.ctl select{min-width:150px}' +
      '</style>';
    document.head.insertAdjacentHTML('beforeend', extra);
  }

  function shell() {
    var opts = '<option value="">Choose an entity</option>';
    REGIONS.forEach(function (reg) {
      opts += '<optgroup label="' + reg + '">';
      ENT.filter(function (m) { return m[0] === reg; }).forEach(function (m) {
        opts += '<option value="' + m[1] + '">' + esc(m[1] + ' - ' + m[3]) + '</option>';
      });
      opts += '</optgroup>';
    });
    var yopts = '';
    YEARS.forEach(function (y) { yopts += '<option value="' + y + '">' + y + '</option>'; });
    document.body.innerHTML = [
      '<header>',
      '<div class="brand">Numa Stays</div>',
      '<select class="company" id="company" title="Entity">' + opts + '</select>',
      '<select class="company" id="dashboard" title="Dashboards">',
      '<option value="prepaid">Dashboards: PrePaid</option>',
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
      '',
      '<h1>PrePaid</h1>',
      '<div class="sub" id="asof">Prepaid expenses on G/L account ' + CODE + ' - live data from Exact Online</div>',
      '<div class="controls">',
      '<div class="ctl"><label for="year">FINANCIAL YEAR</label><select id="year">' + yopts + '</select></div>',
      '<div class="ctl"><label for="gl">G/L ACCOUNT</label><select id="gl"><option value="' + CODE + '">Prepaid Expenses (' + CODE + ')</option></select></div>',
      '<div class="ctl"><label for="journal">JOURNAL</label><select id="journal"><option value="all">All journals (one amount per invoice)</option></select></div>',
      '<div class="ctl"><label for="cut">AMORTISED UNTIL</label><select id="cut"><option value="year">End of the financial year</option><option value="today">Today</option><option value="date">A date I choose</option></select></div>',
      '<div class="ctl" id="cutDateBox" style="display:none"><label for="cutDate">DATE</label><input id="cutDate" type="date"></div>',
      '<div class="ctl"><label for="mode">AMORTISATION STARTS</label><select id="mode"><option value="period">On the period in the text</option><option value="invoice">On the invoice month</option></select></div>',
      '<div class="ctl"><label for="from">BOOKED FROM</label><input id="from" type="date"></div>',
      '<div class="ctl"><label for="to">BOOKED UNTIL</label><input id="to" type="date"></div>',
      '<div class="ctl grow"><label for="q">SEARCH</label><input id="q" type="text" placeholder="Description, invoice, supplier, cost centre or journal"></div>',
      '<div class="ctl"><label>&nbsp;</label><button class="btn" id="apply">Apply</button></div>',
      '<div class="ctl"><label>&nbsp;</label><button class="btn sec" id="clear">Clear filters</button></div>',
      '<div class="ctl"><label>&nbsp;</label><button class="btn sec" id="csv">Export CSV</button></div>',
      '</div>',
      '<div class="kpis" id="kpis"></div>',
      '<div id="jbox"></div>',
      '<div class="wrap" id="wrap"><div class="state">Choose an entity and a financial year, then press Apply</div></div>',
      '<div id="left"></div>',
      '<div class="note" id="note"></div>'
    ].join('');

    el('company').value = S.entity;
    el('year').value = S.year;
    el('gl').value = CODE;
    el('company').onchange = function () {
      S.entity = this.value; S.data = null; S.journal = 'all';
      draw(); setState('Press Apply to read the prepaid lines of this entity');
    };
    el('year').onchange = function () { S.year = this.value; };
    el('journal').onchange = function () { S.journal = this.value; if (S.entity) run(); };
    el('cut').onchange = function () {
      S.cut = this.value;
      el('cutDateBox').style.display = (S.cut === 'date') ? '' : 'none';
      if (S.cut !== 'date' && S.entity && S.data) run();
    };
    el('cutDate').onchange = function () { S.cutDate = this.value; if (S.entity && S.cutDate) run(); };
    el('mode').onchange = function () { S.mode = this.value; if (S.entity && S.data) run(); };
    el('from').onchange = function () { S.from = this.value; draw(); };
    el('to').onchange = function () { S.to = this.value; draw(); };
    el('q').oninput = function () { S.q = this.value; draw(); };
    el('apply').onclick = function () { S.fresh = false; run(); };
    el('refresh').onclick = function () { S.fresh = true; run(); };
    el('clear').onclick = function () {
      S.journal = 'all'; S.mode = 'period'; S.cut = 'year'; S.cutDate = ''; S.from = ''; S.to = ''; S.q = '';
      S.open = {};
      el('journal').value = 'all'; el('mode').value = 'period'; el('cut').value = 'year';
      el('cutDateBox').style.display = 'none'; el('cutDate').value = '';
      el('from').value = ''; el('to').value = ''; el('q').value = '';
      if (S.entity) run(); else draw();
    };
    el('csv').onclick = function () { csv(); };
    el('dashboard').value = 'prepaid';
    el('dashboard').onchange = function () {
      var v = this.value;
      if (v === 'prepaid') return;
      if (v === 'accrued') { window.location.href = '/accrued'; return; }
      window.location.href = '/?dashboard=' + v;
    };
    kpis();
    note();
  }

  function setState(msg) {
    var w = el('wrap');
    if (w) w.innerHTML = '<div class="state">' + esc(msg) + '</div>';
  }

  async function conn() {
    var p = el('conn');
    if (!p) return;
    try {
      var r = await fetch('/api/status', { credentials: 'same-origin' });
      var j = await r.json();
      p.textContent = j.authenticated ? 'Connected to Exact Online' : 'Not connected';
      p.className = 'pill' + (j.authenticated ? ' ok' : '');
    } catch (e) {
      p.textContent = 'Not connected';
      p.className = 'pill';
    }
  }

  async function run() {
    if (S.busy) return;
    if (!S.entity) { setState('Choose an entity first'); return; }
    var dv = division(S.entity);
    if (!dv) { setState('This entity has no division number'); return; }
    S.busy = true; S.err = '';
    setState('Reading the prepaid lines of ' + entName(S.entity) + ' out of Exact Online, this can take a moment...');
    var until = (S.cut === 'date') ? (S.cutDate || 'year') : S.cut;
    var url = '/api/prepaid/schedule?division=' + encodeURIComponent(dv) +
      '&year=' + encodeURIComponent(S.year) +
      '&code=' + encodeURIComponent(CODE) +
      '&journal=' + encodeURIComponent(S.journal) +
      '&mode=' + encodeURIComponent(S.mode) +
      '&until=' + encodeURIComponent(until) +
      (S.fresh ? '&fresh=1' : '');
    try {
      var r = await fetch(url, { credentials: 'same-origin' });
      var j = null;
      try { j = await r.json(); } catch (e2) { j = {}; }
      if (!r.ok) {
        S.data = null;
        S.err = (r.status === 401)
          ? 'Not connected to Exact Online. Press Connect Exact Online in the top right and try again.'
          : (j.error || ('Exact answered with status ' + r.status));
      } else {
        S.data = j;
      }
    } catch (e) {
      S.data = null;
      S.err = 'The server did not answer: ' + String(e.message || e);
    }
    S.busy = false; S.fresh = false;
    fillJournals();
    draw();
    conn();
  }

  function fillJournals() {
    var sel = el('journal');
    if (!sel) return;
    var html = '<option value="all">All journals (one amount per invoice)</option>';
    var js = (S.data && S.data.journals) ? S.data.journals : [];
    js.forEach(function (j) {
      html += '<option value="' + esc(j.code) + '">Journal ' + esc(j.code) +
        (j.automatic ? ' (automatic)' : '') +
        (j.description ? ' - ' + esc(j.description) : '') + '</option>';
    });
    sel.innerHTML = html;
    sel.value = S.journal;
    if (sel.value !== S.journal) { S.journal = 'all'; sel.value = 'all'; }
  }

  // The filters that work on the rows that are already on the page.
  function rowsNow() {
    var rows = (S.data && S.data.rows) ? S.data.rows : [];
    var from = S.from ? isoToNum(S.from) : 0;
    var to = S.to ? isoToNum(S.to) : 0;
    var q = String(S.q || '').trim().toLowerCase();
    return rows.filter(function (r) {
      var d = dnum(r.date);
      if (from && d && d < from) return false;
      if (to && d && d > to) return false;
      if (!q) return true;
      var hay = [r.description, r.invoice, r.supplier, r.cost, r.costName, r.acc, r.accName, r.journal, r.journalName, r.date]
        .join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sums(rows) {
    var t = { count: rows.length, total: 0, expensed: 0, prepaid: 0, monthly: 0 };
    rows.forEach(function (r) { t.total += r.total; t.expensed += r.expensed; t.prepaid += r.prepaid; t.monthly += r.monthly; });
    return t;
  }

  function kpi(t, v, s) {
    return '<div class="kpi"><div class="t">' + esc(t) + '</div><div class="v">' + v + '</div><div class="s">' + esc(s || '') + '</div></div>';
  }

  function kpis() {
    var box = el('kpis');
    if (!box) return;
    var y = Number(S.year) || 0;
    var rows = rowsNow();
    var t = sums(rows);
    box.innerHTML = [
      kpi('INVOICES', n0(t.count), 'one amount per invoice'),
      kpi('TOTAL PAID IN ADVANCE', eur(t.total), 'booked on ' + CODE + ' in ' + y),
      kpi('EXPENSED ' + y, eur(t.expensed), 'the months that are already used'),
      kpi('PREPAID ' + (y + 1), eur(t.prepaid), 'still to be carried to ' + (y + 1))
    ].join('');
  }

  function journalBox() {
    var box = el('jbox');
    if (!box) return;
    var js = (S.data && S.data.journals) ? S.data.journals : [];
    if (!js.length) { box.innerHTML = ''; return; }
    var body = '';
    js.forEach(function (j) {
      body += '<tr>' +
        '<td>' + esc(j.code) + '</td>' +
        '<td>' + esc(j.description || '') + '</td>' +
        '<td class="r">' + n0(j.count) + '</td>' +
        '<td class="r">' + eur(j.debit) + '</td>' +
        '<td class="r">' + eur(j.credit) + '</td>' +
        '<td class="r">' + eur(j.net) + '</td>' +
        '</tr>';
    });
    box.innerHTML = '<div class="pcard"><h3>Journals on account ' + CODE + '</h3>' +
      '<table class="jtab"><thead><tr><th>Journal</th><th>Name</th><th class="r">Lines</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Net</th></tr></thead><tbody>' +
      body + '</tbody></table>' +
      '<div class="muted" style="margin-top:6px">Every journal is read in the same way and they all stand in the same list. Use the JOURNAL filter to look at one of them on its own.</div>' +
      '</div>';
  }

  // The rows are put together per account of the Accc column, closed by
  // default. One click opens a group, so the page stays short.
  function draw() {
    kpis();
    journalBox();
    var w = el('wrap');
    if (!w) return;
    var y = Number(S.year) || 0;
    if (S.err) {
      w.innerHTML = '<div class="state" style="color:#d92d20">' + esc(S.err) + '</div>';
      leftBox(); note(); return;
    }
    if (!S.data) {
      w.innerHTML = '<div class="state">Choose an entity and a financial year, then press Apply</div>';
      leftBox(); note(); return;
    }
    var rows = rowsNow();
    var asof = el('asof');
    if (asof) {
      asof.textContent = 'Prepaid expenses on G/L account ' + CODE + ' - ' + entName(S.entity) +
        ' - financial year ' + y + ' - amortised until ' + (S.data.cut || '') +
        ' - read from Exact Online at ' + String(S.data.lastUpdated || '').slice(0, 19).replace('T', ' ');
    }
    if (!rows.length) {
      w.innerHTML = '<div class="state">No prepaid invoice found with these filters</div>';
      leftBox(); note(); return;
    }
    var t = sums(rows);
    var groups = {};
    var order = [];
    rows.forEach(function (r) {
      var k = r.acc || 'no account';
      if (!groups[k]) { groups[k] = { code: k, name: r.accName || '', rows: [] }; order.push(k); }
      if (!groups[k].name && r.accName) groups[k].name = r.accName;
      groups[k].rows.push(r);
    });
    order.sort();
    var html = '<div class="gbar"><b>' + n0(order.length) + ' accounts, ' + n0(rows.length) + ' invoices</b>' +
      '<span style="flex:1"></span>' +
      '<button class="btn sec" id="openAll">Open all</button>' +
      '<button class="btn sec" id="closeAll">Close all</button></div>';
    order.forEach(function (k) {
      var g = groups[k];
      var gt = sums(g.rows);
      var open = !!S.open[k];
      html += '<div class="grp">' +
        '<div class="ghead" data-k="' + esc(k) + '">' +
        '<span class="arw">' + (open ? '▾' : '▸') + '</span>' +
        '<span class="gcode">' + esc(g.code) + '</span>' +
        '<span class="gname">' + esc(g.name || '') + '</span>' +
        '<span class="gnum">' + n0(g.rows.length) + ' invoices</span>' +
        '<span class="gnum">' + eur(gt.total) + '</span>' +
        '<span class="gnum">' + eur(gt.expensed) + '</span>' +
        '<span class="gnum gpre">' + eur(gt.prepaid) + '</span>' +
        '</div>' +
        (open ? '<div class="gbody">' + tableFor(g.rows, y) + '</div>' : '') +
        '</div>';
    });
    html += '<div class="ghead gtot">' +
      '<span class="arw"></span>' +
      '<span class="gcode">TOTAL</span>' +
      '<span class="gname"></span>' +
      '<span class="gnum">' + n0(t.count) + ' invoices</span>' +
      '<span class="gnum">' + eur(t.total) + '</span>' +
      '<span class="gnum">' + eur(t.expensed) + '</span>' +
      '<span class="gnum gpre">' + eur(t.prepaid) + '</span></div>';
    w.innerHTML = html;
    var hs = w.getElementsByClassName('ghead');
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].className.indexOf('gtot') >= 0) continue;
      hs[i].onclick = function () {
        var k = this.getAttribute('data-k');
        S.open[k] = !S.open[k];
        draw();
      };
    }
    if (el('openAll')) el('openAll').onclick = function () { order.forEach(function (k) { S.open[k] = true; }); draw(); };
    if (el('closeAll')) el('closeAll').onclick = function () { S.open = {}; draw(); };
    leftBox();
    note();
  }

  // One group of invoices, drawn exactly like the schedule in Excel.
  function tableFor(rows, y) {
    var head = '<thead><tr>' +
      '<th>No.</th><th>Date</th><th>Cost</th><th>Accc</th><th>Description</th><th>Invoice</th>' +
      '<th class="r">Total (€)</th><th>Start Date</th><th>End Date</th>' +
      '<th class="r">Total Months</th><th class="r">Months Used (' + y + ')</th><th class="r">Months Left (' + (y + 1) + ')</th>' +
      '<th class="r">Monthly Amort (€)</th><th class="r">Expensed ' + y + ' (€)</th><th class="r">Prepaid ' + (y + 1) + ' (€)</th>' +
      '<th>Journal</th></tr></thead>';
    var body = '';
    rows.forEach(function (r, i) {
      body += '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(r.date) + '</td>' +
        '<td title="' + esc(r.costName || '') + '">' + esc(r.cost || '') + '</td>' +
        '<td title="' + esc(r.accName || '') + '">' + esc(r.acc || '') + '</td>' +
        '<td title="' + esc(r.supplier || '') + '">' + esc(r.description) + '</td>' +
        '<td>' + esc(r.invoice || '') + '</td>' +
        '<td class="r">' + eur(r.total) + '</td>' +
        '<td>' + esc(r.start) + '</td>' +
        '<td>' + esc(r.end) + '</td>' +
        '<td class="r">' + r.months + '</td>' +
        '<td class="r">' + r.used + '</td>' +
        '<td class="r">' + r.left + '</td>' +
        '<td class="r">' + eur(r.monthly) + '</td>' +
        '<td class="r">' + (r.expensed ? eur(r.expensed) : '-') + '</td>' +
        '<td class="r"><b>' + eur(r.prepaid) + '</b></td>' +
        '<td title="' + esc(r.journalName || '') + '">' + esc(r.journal || '') + '</td>' +
        '</tr>';
    });
    var gt = sums(rows);
    var foot = '<tfoot><tr>' +
      '<td colspan="6"><b>Subtotal</b></td>' +
      '<td class="r"><b>' + eur(gt.total) + '</b></td>' +
      '<td colspan="5"></td>' +
      '<td class="r"><b>' + eur(gt.expensed) + '</b></td>' +
      '<td class="r"><b>' + eur(gt.prepaid) + '</b></td>' +
      '<td></td></tr></tfoot>';
    return '<div style="overflow:auto"><table class="jtab">' + head + '<tbody>' + body + '</tbody>' + foot + '</table></div>';
  }

  // Invoices that carry no period in their text: they are shown apart and never
  // guessed, so nobody can say the dashboard invented a number.
  function leftBox() {
    var box = el('left');
    if (!box) return;
    var sk = (S.data && S.data.skipped) ? S.data.skipped : [];
    if (!sk.length) { box.innerHTML = ''; return; }
    var body = '';
    var tot = 0;
    sk.forEach(function (s) {
      tot += s.amount;
      body += '<tr><td>' + esc(s.date) + '</td><td>' + esc(s.journal || '') + '</td><td>' + esc(s.invoice || '') + '</td>' +
        '<td>' + esc(s.description || '') + '</td><td class="r">' + eur(s.amount) + '</td></tr>';
    });
    box.innerHTML = '<div class="pcard"><h3 class="warn">Without a period in the text (' + n0(sk.length) + ' lines, ' + eur(tot) + ')</h3>' +
      '<table class="jtab"><thead><tr><th>Date</th><th>Journal</th><th>Invoice</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody>' +
      body + '</tbody></table>' +
      '<div class="muted" style="margin-top:6px">These lines are left out of the schedule because Exact does not say which months they cover. Write the period in the description, for example (01-01-2026 - 31-12-2026), and they come in by themselves.</div></div>';
  }

  function csv() {
    var rows = rowsNow();
    if (!rows.length) return;
    var y = Number(S.year) || 0;
    var cols = ['No.', 'Date', 'Cost', 'Accc', 'Description', 'Invoice', 'Total', 'Start Date', 'End Date',
      'Total Months', 'Months Used ' + y, 'Months Left ' + (y + 1), 'Monthly Amort', 'Expensed ' + y, 'Prepaid ' + (y + 1), 'Journal'];
    function cell(v) {
      var s = String(v === null || v === undefined ? '' : v);
      if (s.indexOf(';') >= 0 || s.indexOf(QT) >= 0 || s.indexOf(NL) >= 0) s = QT + s.split(QT).join(QT + QT) + QT;
      return s;
    }
    var out = cols.join(';');
    rows.forEach(function (r, i) {
      out += NL + [i + 1, r.date, r.cost, r.acc, r.description, r.invoice, r.total, r.start, r.end,
        r.months, r.used, r.left, r.monthly, r.expensed, r.prepaid, r.journal].map(cell).join(';');
    });
    var t = sums(rows);
    out += NL + ['', '', '', '', 'TOTAL', '', t.total, '', '', '', '', '', '', t.expensed, t.prepaid, ''].map(cell).join(';');
    var blob = new Blob([out], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'prepaid-' + CODE + '-' + S.entity + '-' + S.year + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // The same Information block as on the Accrued dashboard: it says in plain
  // words where every number comes from, so it is clear that no value is touched.
  function note() {
    var n = el('note');
    if (!n) return;
    var y = Number(S.year) || 0;
    var txt = 'Information. How the numbers are built: ' +
      '(1) every line of G/L account ' + CODE + ' of the chosen entity and financial year is read live from Exact Online, out of all journals together; ' +
      '(2) every journal is read in the same way, none of them is treated differently and nothing is left out because of the journal it stands in; ' +
      '(3) the lines of one entry that carry the same text belong to the same invoice, so they make one row with one amount and no amount is added twice; ' +
      '(4) the period comes from the text of the booking, for example (01-01-2026 - 31-12-2026), and the months are counted from the first to the last month, both included; ' +
      '(5) the monthly amount is the invoice amount divided by those months and the months used are the months up to the cut off, that is the end of ' + y + ', today, or the date chosen above; ' +
      '(6) expensed is the monthly amount times the months used and the prepaid amount is the invoice amount minus the expensed part, so a row always adds up to the amount that stands in Exact; ' +
      '(7) amounts are never rounded up or down and never corrected, a line without a period is not guessed but shown apart at the bottom, and the credit lines (the releases) stay out of the schedule and are visible in the journal overview.';
    n.textContent = txt;
  }

  async function boot() {
    await skin();
    shell();
    conn();
    setInterval(conn, 60000);
  }

  boot();
})();
