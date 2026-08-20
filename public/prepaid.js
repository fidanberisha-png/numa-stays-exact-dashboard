// PrePaid dashboard for Numa Stays - live data from Exact Online (/api/prepaid/*).
// The header, the entity picker and the filter row are the same as on the Accrued
// dashboard. The table below is the prepaid schedule: what was paid up front, over
// which period it runs, how much of it belongs to the chosen financial year and how
// much of it is carried into the next one.
(function () {
  var ENT = [
    ['HQ', 1000, 3784237, 'Numa Group SE'],
    ['DACH', 900, 3745758, 'Numa Deutschland GmbH'],
    ['DACH', 901, 3745759, 'COSI Hamburg Süd GmbH'],
    ['DACH', 902, 3745760, 'COSI Köln Nord GmbH'],
    ['DACH', 801, 3745740, 'Numa Österreich GmbH'],
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
    ['SOUTH', 700, 3725452, 'Numa Stays España S.L.'],
    ['SOUTH', 710, 3732987, 'NUMA PORTUGAL, UNIPESSOAL, LDA.'],
    ['SOUTH', 711, 4166557, 'numa Lisbon South, unipessoal Lda'],
    ['SOUTH', 720, 3745729, 'Numa Italia S.r.l.']
  ];
  var REGIONS = ['HQ', 'DACH', 'WEST', 'SOUTH'];
  var YEARS = [2026, 2025, 2024];
  var DEF = '160100';
  var S = {
    entity: '', year: '2025', code: DEF, cut: 'year', q: '',
    rows: [], accounts: null, fresh: false, errs: [], busy: false, updated: ''
  };

  function el(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function eur(n) {
    return (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  function p2(x) { return (x < 10 ? '0' : '') + x; }
  // Exact sends the dates as /Date(1767225600000)/, so the number is read out of
  // the text and everything else is left to the browser.
  function nsTime(v) {
    if (v instanceof Date) return v;
    var s = String(v || '');
    var i = s.indexOf('Date(');
    if (i >= 0) {
      var ms = parseInt(s.slice(i + 5), 10);
      if (!isNaN(ms)) return new Date(ms);
    }
    if (!s) return null;
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(v) {
    var d = nsTime(v);
    if (!d) return '-';
    return p2(d.getDate()) + '-' + p2(d.getMonth() + 1) + '-' + d.getFullYear();
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
  function yearNum() { return parseInt(S.year, 10); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // The CSS lives on the Accrued page. It is copied in from there so both
  // dashboards keep the same look and there is only one copy of the style.
  async function skin() {
    try {
      var r = await fetch('/accrued.html', { credentials: 'same-origin' });
      var t = await r.text();
      var a = t.indexOf('<style');
      var b = t.indexOf('</style>');
      if (a >= 0 && b > a) document.head.insertAdjacentHTML('beforeend', t.slice(a, b + 8));
    } catch (e) { }
  }

  // ---- the period of a prepayment ------------------------------------------
  // The period is written in the text of the booking, for example
  // "Lift maintenance 2026 (01-01-2026 - 31-12-2026)". Dots, slashes and dashes
  // are all accepted and a two digit year is read as 20xx. The dates inside the
  // brackets win, because the text often starts with the invoice date.
  function isDigit(c) { return c >= '0' && c <= '9'; }
  function isSep(c) { return c === '-' || c === '.' || c === '/'; }
  function digits(s, i) {
    var n = '';
    while (i < s.length && isDigit(s.charAt(i))) { n += s.charAt(i); i++; }
    return n;
  }
  function mkDate(d, m, y) {
    var yy = parseInt(y, 10);
    if (yy < 100) yy += 2000;
    var dd = parseInt(d, 10), mm = parseInt(m, 10);
    if (!dd || !mm || mm > 12 || dd > 31 || yy < 1990 || yy > 2100) return null;
    return new Date(yy, mm - 1, dd);
  }
  function readDate(s, i) {
    var d = digits(s, i);
    if (!d || d.length > 2) return null;
    var j = i + d.length;
    if (!isSep(s.charAt(j))) return null;
    var m = digits(s, j + 1);
    if (!m || m.length > 2) return null;
    var k = j + 1 + m.length;
    if (!isSep(s.charAt(k))) return null;
    var y = digits(s, k + 1);
    if (y.length !== 2 && y.length !== 4) return null;
    var dt = mkDate(d, m, y);
    return dt ? { date: dt, end: k + 1 + y.length } : null;
  }
  function dates(text) {
    var s = String(text || '');
    var out = [];
    for (var i = 0; i < s.length; i++) {
      if (!isDigit(s.charAt(i))) continue;
      if (i > 0 && isDigit(s.charAt(i - 1))) continue;
      var r = readDate(s, i);
      if (r) { out.push(r.date); i = r.end - 1; }
    }
    return out;
  }
  function period(desc) {
    var s = String(desc || '');
    var best = null;
    var i = 0;
    while (true) {
      var a = s.indexOf('(', i);
      if (a < 0) break;
      var b = s.indexOf(')', a);
      if (b < 0) break;
      var inside = dates(s.slice(a + 1, b));
      if (inside.length >= 2) best = { start: inside[0], end: inside[inside.length - 1] };
      i = b + 1;
    }
    if (!best) {
      var all = dates(s);
      if (all.length >= 2) best = { start: all[0], end: all[all.length - 1] };
    }
    if (!best || best.end < best.start) return null;
    return best;
  }
  function mIdx(d) { return d.getFullYear() * 12 + d.getMonth(); }
  function cutIndex() {
    if (S.cut === 'today') return mIdx(new Date());
    return yearNum() * 12 + 11;
  }
  function cutLabel() { return S.cut === 'today' ? 'today' : '31-12-' + yearNum(); }

  // ---- the header and the filters -------------------------------------------
  function glOptions() {
    var list = (S.accounts && S.accounts.length) ? S.accounts.slice() : [{ code: DEF, description: 'Prepaid Expenses' }];
    var has = false;
    list.forEach(function (a) { if (String(a.code) === String(S.code)) has = true; });
    if (!has) list = [{ code: S.code, description: 'G/L ' + S.code }].concat(list);
    var out = '';
    list.forEach(function (a) {
      out += '<option value="' + esc(a.code) + '">' + esc(a.description + ' (' + a.code + ')') + '</option>';
    });
    return out;
  }
  function paintGL() {
    var sel = el('gl');
    if (!sel) return;
    sel.innerHTML = glOptions();
    sel.value = S.code;
  }
  async function loadAccounts() {
    var e = entOf(S.entity);
    S.accounts = null;
    paintGL();
    if (!e) return;
    try {
      var r = await fetch('/api/prepaid/accounts?division=' + e[2], { credentials: 'same-origin' });
      var j = await r.json();
      if (r.ok && j && j.accounts && j.accounts.length) S.accounts = j.accounts;
    } catch (err) { S.accounts = null; }
    paintGL();
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
    opts += '<optgroup label="ALL"><option value="consolidated">Consolidated (all entities)</option></optgroup>';
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
      '<div class="sub" id="asof">Prepaid expenses | G/L Account - live data from Exact Online</div>',
      '<div class="controls">',
      '<div class="ctl"><label for="year">FINANCIAL YEAR</label><select id="year">' + yopts + '</select></div>',
      '<div class="ctl"><label for="gl">G/L ACCOUNT</label><select id="gl">' + glOptions() + '</select></div>',
      '<div class="ctl"><label for="cut">AMORTISED UNTIL</label><select id="cut"><option value="year">End of the financial year</option><option value="today">Today</option></select></div>',
      '<div class="ctl grow"><label for="q">SEARCH</label><input id="q" type="text" placeholder="Description, invoice, cost centre or supplier"></div>',
      '<div class="ctl"><label>&nbsp;</label><button class="btn" id="apply">Apply</button></div>',
      '</div>',
      '<div class="kpis" id="kpis"></div>',
      '<div class="wrap" id="wrap"><div class="state">Choose an entity, financial year and G/L account, then press Apply</div></div>',
      '<div class="note" id="note"></div>'
    ].join('');
    el('company').value = S.entity;
    el('year').value = String(S.year);
    el('cut').value = S.cut;
    el('gl').value = S.code;
    el('company').onchange = function () {
      S.entity = this.value;
      S.rows = [];
      setStatus('Press Apply to read the prepaid lines of this entity');
      loadAccounts();
    };
    el('year').onchange = function () { S.year = this.value; };
    el('gl').onchange = function () { S.code = this.value; };
    el('cut').onchange = function () { S.cut = this.value; if (S.rows.length) { recut(); draw(); } };
    el('q').oninput = function () { S.q = this.value; draw(); };
    el('apply').onclick = function () { S.fresh = false; run(); };
    el('refresh').onclick = function () { S.fresh = true; run(); };
    el('dashboard').value = 'prepaid';
    el('dashboard').onchange = function () {
      var v = this.value;
      if (v === 'prepaid') return;
      if (v === 'accrued') { window.location.href = '/accrued'; return; }
      window.location.href = '/?dashboard=' + v;
    };
    kpis(null);
    note();
  }
  async function conn() {
    var p = el('conn');
    if (!p) return;
    try {
      var r = await fetch('/api/status', { credentials: 'same-origin' });
      var j = await r.json();
      var ok = !!(j && (j.authenticated || j.connected));
      p.className = 'pill ' + (ok ? 'ok' : 'bad');
      p.textContent = ok ? 'Connected to Exact Online' : 'Not connected';
    } catch (e) {
      p.className = 'pill bad';
      p.textContent = 'Not connected';
    }
  }
  function setStatus(t) {
    var w = el('wrap');
    if (w) w.innerHTML = '<div class="state">' + esc(t) + '</div>';
  }

  // ---- reading the lines and building the schedule --------------------------
  async function get(div, year, code) {
    for (var a = 0; a < 2; a++) {
      try {
        var u = '/api/prepaid/lines?division=' + div + '&year=' + year + '&code=' + encodeURIComponent(code) + (S.fresh ? '&fresh=1' : '');
        var r = await fetch(u, { credentials: 'same-origin' });
        var j = await r.json();
        if (r.ok && j && !j.error) return j;
        if (r.status === 401) return { error: 'Not connected to Exact Online, press Connect Exact Online' };
        if (a === 1) return { error: (j && (j.error || j.detail)) || ('HTTP ' + r.status) };
      } catch (e) {
        if (a === 1) return { error: String(e) };
      }
      await sleep(1200);
    }
    return { error: 'unknown' };
  }
  // One row per invoice: the lines of the same invoice on the prepaid account are
  // added up, so the amount is exactly what stands in Exact. The debit is what was
  // paid in advance, the credit is what Exact has already released.
  function build(lines) {
    var by = {}, order = [];
    lines.forEach(function (l) {
      var inv = l.invoice || ('entry ' + l.entryNumber);
      var key = [l.entity, inv, l.description, l.costCenter, l.costUnit].join('|');
      if (!by[key]) {
        by[key] = {
          entity: l.entity, entityName: l.entityName, invoice: l.invoice,
          description: l.description, costCenter: l.costCenter, costCenterName: l.costCenterName,
          costUnit: l.costUnit, glCode: l.glCode, supplier: l.supplier,
          entries: [], total: 0, released: 0, date: null
        };
        order.push(key);
      }
      var g = by[key];
      g.total += Number(l.debit) || 0;
      g.released += Number(l.credit) || 0;
      if (g.entries.indexOf(l.entryNumber) < 0) g.entries.push(l.entryNumber);
      var d = nsTime(l.date);
      if (d && (!g.date || d < g.date)) g.date = d;
    });
    var out = [];
    order.forEach(function (k) {
      var g = by[k];
      var per = period(g.description);
      out.push({
        entity: g.entity, entityName: g.entityName, date: g.date,
        costUnit: g.costUnit, costCenter: g.costCenter, costCenterName: g.costCenterName,
        description: g.description, invoice: g.invoice || ('#' + g.entries.join(', ')),
        supplier: g.supplier, glCode: g.glCode, total: g.total, released: g.released,
        start: per ? per.start : null, end: per ? per.end : null, dated: !!per,
        months: 0, used: 0, left: 0, monthly: 0, expensed: 0, prepaid: g.total - g.released
      });
    });
    out.sort(function (a, b) {
      return (a.date ? a.date.getTime() : 0) - (b.date ? b.date.getTime() : 0);
    });
    return out;
  }
  // The months are counted with the first and the last month included, and the
  // part that belongs to the time until the cut off date is the expensed part.
  function recut() {
    var cut = cutIndex();
    S.rows.forEach(function (r) {
      if (!r.dated) { r.months = 0; r.used = 0; r.left = 0; r.monthly = 0; r.expensed = 0; r.prepaid = r.total - r.released; return; }
      r.months = mIdx(r.end) - mIdx(r.start) + 1;
      r.monthly = r.months ? r.total / r.months : 0;
      r.used = Math.max(0, Math.min(r.months, cut - mIdx(r.start) + 1));
      r.left = r.months - r.used;
      r.expensed = r.monthly * r.used;
      r.prepaid = r.total - r.expensed;
    });
  }
  async function run() {
    var t = targets();
    if (!t.length) { setStatus('Choose an entity, financial year and G/L account, then press Apply'); return; }
    if (S.busy) return;
    S.busy = true;
    S.errs = [];
    S.rows = [];
    var y = yearNum();
    var all = [];
    var done = 0;
    setStatus('Loading the prepaid lines from Exact Online (0/' + t.length + ')');
    for (var i = 0; i < t.length; i++) {
      var e = t[i];
      var j = await get(e[2], y, S.code);
      if (j.error) {
        S.errs.push(e[1] + ' ' + y + ' ' + S.code + ': ' + j.error);
      } else {
        (j.lines || []).forEach(function (l) {
          l.entity = e[1];
          l.entityName = e[3];
          all.push(l);
        });
        if (j.lastUpdated) S.updated = j.lastUpdated;
      }
      done += 1;
      if (done < t.length) setStatus('Loading the prepaid lines from Exact Online (' + done + '/' + t.length + ')');
    }
    S.rows = build(all);
    recut();
    S.busy = false;
    S.fresh = false;
    var sub = el('asof');
    if (sub) {
      var who = S.entity === 'consolidated' ? 'All entities' : (entOf(S.entity) ? entOf(S.entity)[1] + ' - ' + entOf(S.entity)[3] : '');
      sub.textContent = who + ' · G/L ' + S.code + ' · financial year ' + y + ' · amortised until ' + cutLabel();
    }
    draw();
  }

  // ---- the table ------------------------------------------------------------
  function match(r) {
    var q = String(S.q || '').trim().toLowerCase();
    if (!q) return true;
    return [r.description, r.invoice, r.costCenter, r.costCenterName, r.costUnit, r.supplier, r.glCode, r.entityName]
      .join(' ').toLowerCase().indexOf(q) >= 0;
  }
  function card(t, v, s) {
    return '<div class="kpi"><div class="t">' + esc(t) + '</div><div class="v">' + esc(String(v)) + '</div><div class="s">' + esc(s) + '</div></div>';
  }
  function kpis(sum) {
    var k = el('kpis');
    if (!k) return;
    k.innerHTML = [
      card('ITEMS', sum ? sum.items : 0, 'invoices on the prepaid account'),
      card('TOTAL PAID IN ADVANCE', eur(sum ? sum.total : 0), 'debit booked on the prepaid account'),
      card('EXPENSED', eur(sum ? sum.expensed : 0), 'belongs to the time until ' + cutLabel()),
      card('PREPAID LEFT', eur(sum ? sum.prepaid : 0), 'runs after ' + cutLabel())
    ].join('');
  }
  function note() {
    var n = el('note');
    if (!n) return;
    var txt = 'How the schedule is built: (1) every line of the chosen prepaid account is read live from Exact Online for the selected financial year; (2) the lines of one invoice are added together, so the amount is exactly what stands on the prepaid account; (3) the period comes from the text of the booking, for example (01-01-2026 - 31-12-2026), and the months are counted with the first and the last month included; (4) the monthly amortisation is the amount divided by those months, the part that belongs to the time until ' + cutLabel() + ' is shown as expensed and the rest stays prepaid; (5) a line without a readable period keeps the full amount as prepaid and shows a dash - that has to be corrected in the description in Exact, not here.';
    var err = S.errs.length ? '<div style="color:#ff5c5c;margin-bottom:8px">Errors: ' + esc(S.errs.join(' | ')) + '</div>' : '';
    n.innerHTML = err + '<div>' + esc(txt) + '</div>';
  }
  function draw() {
    var rows = S.rows.filter(match);
    var sum = { items: rows.length, total: 0, expensed: 0, prepaid: 0, monthly: 0, released: 0 };
    rows.forEach(function (r) {
      sum.total += r.total; sum.expensed += r.expensed; sum.prepaid += r.prepaid;
      sum.monthly += r.monthly; sum.released += r.released;
    });
    kpis(sum);
    note();
    var w = el('wrap');
    if (!w) return;
    if (!rows.length) {
      setStatus(S.rows.length ? 'No prepaid line matches the search' : 'No prepaid lines for this entity, financial year and account');
      return;
    }
    var multi = S.entity === 'consolidated';
    var h = ['<table><thead><tr>', '<th class="num">No.</th>'];
    if (multi) h.push('<th>Entity</th>');
    h.push('<th>Date</th><th>Cost</th><th>Acc</th><th class="desc">Description</th><th>Invoice</th>');
    h.push('<th class="num">Total (€)</th><th>Start Date</th><th>End Date</th>');
    h.push('<th class="num">Total Months</th><th class="num">Months Used</th><th class="num">Months Left</th>');
    h.push('<th class="num">Monthly Amort (€)</th><th class="num">Expensed (€)</th><th class="num">Prepaid (€)</th>');
    h.push('</tr></thead><tbody>');
    rows.forEach(function (r, i) {
      h.push('<tr>');
      h.push('<td class="num">' + (i + 1) + '</td>');
      if (multi) h.push('<td>' + esc(r.entity) + '</td>');
      h.push('<td class="mono">' + esc(fmtDate(r.date)) + '</td>');
      h.push('<td>' + esc(r.costUnit || '-') + '</td>');
      h.push('<td>' + esc(r.costCenter || '-') + '</td>');
      h.push('<td class="desc" title="' + esc(r.description) + '">' + esc(r.description || '-') + '</td>');
      h.push('<td class="mono">' + esc(r.invoice) + '</td>');
      h.push('<td class="num">' + esc(eur(r.total)) + '</td>');
      h.push('<td class="mono">' + esc(fmtDate(r.start)) + '</td>');
      h.push('<td class="mono">' + esc(fmtDate(r.end)) + '</td>');
      h.push('<td class="num">' + (r.dated ? r.months : '-') + '</td>');
      h.push('<td class="num">' + (r.dated ? r.used : '-') + '</td>');
      h.push('<td class="num">' + (r.dated ? r.left : '-') + '</td>');
      h.push('<td class="num">' + (r.dated ? esc(eur(r.monthly)) : '-') + '</td>');
      h.push('<td class="num">' + (r.dated ? esc(eur(r.expensed)) : '-') + '</td>');
      h.push('<td class="num">' + esc(eur(r.prepaid)) + '</td>');
      h.push('</tr>');
    });
    h.push('</tbody><tfoot><tr>');
    h.push('<th colspan="' + (multi ? 7 : 6) + '">Grand total (' + rows.length + ' invoices)</th>');
    h.push('<th class="num">' + esc(eur(sum.total)) + '</th>');
    h.push('<th></th><th></th><th></th><th></th><th></th>');
    h.push('<th class="num">' + esc(eur(sum.monthly)) + '</th>');
    h.push('<th class="num">' + esc(eur(sum.expensed)) + '</th>');
    h.push('<th class="num">' + esc(eur(sum.prepaid)) + '</th>');
    h.push('</tr></tfoot></table>');
    w.innerHTML = h.join('');
  }

  skin().then(function () {
    shell();
    conn();
    setInterval(conn, 60000);
  });
})();
