// A/P Ageing dashboard for Numa Stays - live data from Exact Online (/api/ageing-ap)
var S = { data: null, sort: 'total', dir: -1, q: '', bucket: 'all', open: {}, division: 'consolidated', dashboard: 'ap' };
var COLS = [
  ['code', 'Code', 0],
  ['name', 'Name', 0],
  ['b1', '0 - 30', 1],
  ['b2', '31 - 60', 1],
  ['b3', '61 - 90', 1],
  ['b4', 'Over 90', 1],
  ['total', 'Outstanding', 1],
  ['average', 'Average', 1]
  ];
function el(id) { return document.getElementById(id); }
function fmt(v) {
  var n = Number(v || 0);
  return n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function esc(v) {
  var s = (v === null || v === undefined) ? '' : String(v);
  s = s.split('&').join('&amp;');
  s = s.split('<').join('&lt;');
  s = s.split('>').join('&gt;');
  s = s.split(String.fromCharCode(34)).join('&quot;');
  return s;
}
function money(v, extra) {
  var n = Number(v || 0);
  var c = Math.abs(n) < 0.005 ? 'zero' : (n < 0 ? 'neg' : (extra || ''));
  return '<td class="num ' + c + '">' + fmt(n) + '</td>';
}
function today() {
  var d = new Date();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}
function shell() {
  document.body.innerHTML = [
    '<header>',
    '<div class="brand">Numa Stays</div>',
    '<select class="company" id="company" title="Entity"><option value="consolidated">Consolidated (all entities)</option><option value="300">300 - Numa Norge AS</option></select>',
    '<select class="company" id="dashboard" title="Dashboards"><option value="ap">Dashboards: AP Ageing</option><option value="ar">Dashboards: AR Ageing</option><option value="ic">Dashboards: InterCompany</option></select>',
    '<span class="pill" id="conn">Checking connection</span>',
    '<div class="spacer"></div>',
    '<button class="btn sec" id="refresh">Refresh</button>',
    '<a class="btn" href="/auth/login">Connect Exact Online</a>',
    '</header>',
    '<h1>Ageing analysis: A/P</h1>',
    '<div class="sub" id="asof">Loading live data from Exact Online</div>',
    '<div class="controls">',
    '<div class="ctl"><label for="refdate">REFERENCE DATE</label><input type="date" id="refdate" value="' + today() + '"></div>',
    '<div class="ctl"><label for="referto">AGE BY</label><select id="referto"><option value="date">Invoice date</option><option value="duedate">Due date</option></select></div>',
    '<div class="ctl"><label for="bucket">OVERDUE BUCKET</label><select id="bucket"><option value="all">All buckets</option><option value="b1">0 - 30 days</option><option value="b2">31 - 60 days</option><option value="b3">61 - 90 days</option><option value="b4">Over 90 days</option></select></div>',
    '<div class="ctl grow"><label for="q">ACCOUNT / NAME</label><input type="text" id="q" placeholder="Search code or supplier name"></div>',
    '</div>',
    '<div class="kpis" id="kpis"></div>',
    '<div class="wrap"><div id="table" class="state">Loading live data from Exact Online</div></div>',
    '<div class="note" id="note"></div>'
    ].join('');
  el('refresh').onclick = function () { load(); };
  el('refdate').onchange = function () { load(); };
  el('referto').onchange = function () { load(); };
  el('bucket').onchange = function () { S.bucket = el('bucket').value; draw(); };
  el('q').oninput = function () { S.q = el('q').value; draw(); };
  el('company').onchange = function () { S.division = el('company').value; load(); };
  el('dashboard').onchange = function () { onDashboardChange(el('dashboard').value); };
}
function load() {
  var box = el('table');
  box.className = 'state';
  box.textContent = 'Loading live data from Exact Online...';
  var div = (S.division || (el('company') ? el('company').value : '') || 'consolidated');
  var endpoint = (S.dashboard === 'ar') ? '/api/ageing-ar' : '/api/ageing-ap';
  var url = endpoint + '?referTo=' + encodeURIComponent(el('referto').value) + '&date=' + encodeURIComponent(el('refdate').value) + '&division=' + encodeURIComponent(div);
  fetch(url, { credentials: 'same-origin' }).then(function (r) {
    return r.json().then(function (j) { return { ok: r.ok, j: j }; });
  }).then(function (res) {
    if (!res.ok || (res.j && res.j.error)) { fail(res.j); return; }
    S.data = res.j;
    S.open = {};
    draw();
    stamp();
  }).catch(function (e) { fail({ error: String(e) }); });
}
function fail(j) {
  var box = el('table');
  box.className = 'state';
  if (j && j.error === 'Not authenticated') {
    box.innerHTML = 'Not connected to Exact Online. Click <b>Connect Exact Online</b> at the top, then press Refresh.';
  } else {
    box.innerHTML = 'Could not load the ageing data.<br>' + esc(JSON.stringify(j));
  }
  el('kpis').innerHTML = '';
}
function stamp() {
  var d = S.data;
  var w = d.lastUpdated ? new Date(d.lastUpdated) : new Date();
  var by = d.referTo === 'duedate' ? 'due date' : 'invoice date';
  el('asof').innerHTML = 'As of <b>' + esc(d.referenceDate || el('refdate').value) + '</b> - aged by ' + by + ' - live from Exact Online, refreshed ' + w.toLocaleString('nb-NO') + ' - all amounts converted to <b>EUR</b>';
  var extra = '';
  if (d.errors && Object.keys(d.errors).length) { extra = ' - notes: ' + esc(JSON.stringify(d.errors)); }
  el('note').innerHTML = 'Division ' + esc(d.division) + ' - source ' + esc(d.source) + ' - ' + (d.itemCount || 0) + ' open items' + extra;
}
function filtered() {
  var list = (S.data && S.data.accounts) ? S.data.accounts.slice() : [];
  var q = S.q.trim().toLowerCase();
  if (q) {
    list = list.filter(function (r) {
      return (String(r.code || '') + ' ' + String(r.name || '')).toLowerCase().indexOf(q) >= 0;
    });
  }
  if (S.bucket !== 'all') {
    list = list.filter(function (r) { return Math.abs(Number(r[S.bucket] || 0)) > 0.004; });
  }
  var k = S.sort;
  var dir = S.dir;
  list.sort(function (a, b) {
    if (k === 'code' || k === 'name') {
      return String(a[k] || '').localeCompare(String(b[k] || '')) * dir;
    }
    return ((Number(a[k]) || 0) - (Number(b[k]) || 0)) * dir;
  });
  return list;
}
function totalsOf(list) {
  var t = { b1: 0, b2: 0, b3: 0, b4: 0, total: 0 };
  var w = 0;
  var a = 0;
  list.forEach(function (r) {
    t.b1 += Number(r.b1 || 0);
    t.b2 += Number(r.b2 || 0);
    t.b3 += Number(r.b3 || 0);
    t.b4 += Number(r.b4 || 0);
    t.total += Number(r.total || 0);
    w += Number(r.average || 0) * Math.abs(Number(r.total || 0));
    a += Math.abs(Number(r.total || 0));
  });
  t.average = a ? Math.round(w / a) : 0;
  return t;
}
function kpis(list, t) {
  var colors = { b1: 'var(--green)', b2: 'var(--yellow)', b3: 'var(--orange)', b4: 'var(--red)' };
  var labels = { b1: '0 - 30 DAYS', b2: '31 - 60 DAYS', b3: '61 - 90 DAYS', b4: 'OVER 90 DAYS' };
  var h = '<div class="kpi big"><div class="t">TOTAL OUTSTANDING (EUR)</div><div class="v">' + fmt(t.total) + '</div>';
  h += '<div class="s">' + list.length + ' suppliers - average ' + t.average + ' days</div></div>';
  ['b1', 'b2', 'b3', 'b4'].forEach(function (k) {
    var p = t.total ? Math.round(t[k] / t.total * 100) : 0;
    var w = Math.max(0, Math.min(100, p));
    h += '<div class="kpi"><div class="t">' + labels[k] + '</div>';
    h += '<div class="v" style="color:' + colors[k] + '">' + fmt(t[k]) + '</div>';
    h += '<div class="bar"><span style="width:' + w + '%;background:' + colors[k] + '"></span></div>';
    h += '<div class="s">' + p + '% of outstanding</div></div>';
  });
  el('kpis').innerHTML = h;
}
function draw() {
  if (!S.data) { return; }
  var list = filtered();
  var t = totalsOf(list);
  kpis(list, t);
  var h = '<table><thead><tr>';
  COLS.forEach(function (c) {
    var on = S.sort === c[0];
    var arrow = on ? (S.dir > 0 ? ' \u25b2' : ' \u25bc') : '';
    h += '<th data-k="' + c[0] + '" class="' + (c[2] ? 'num' : 'txt') + (on ? ' on' : '') + '">' + c[1] + arrow + '</th>';
  });
  h += '</tr></thead><tbody>';
  if (!list.length) {
    h += '<tr><td colspan="8" class="state">No open purchase invoices for this selection.</td></tr>';
  }
  list.forEach(function (r) {
    var risk = Math.abs(Number(r.b4 || 0)) > 0.004 ? ' risk' : '';
    h += '<tr class="row' + risk + '" data-code="' + esc(r.code) + '">';
    h += '<td class="mono">' + esc(r.code) + '</td><td>' + esc(r.name) + '</td>';
    h += money(r.b1) + money(r.b2, 'warn') + money(r.b3, 'hot') + money(r.b4, 'bad') + money(r.total, 'strong');
    h += '<td class="num">' + (r.average === null || r.average === undefined ? '' : r.average) + '</td></tr>';
    if (S.open[r.code]) { h += detail(r); }
  });
  h += '</tbody><tfoot><tr><td>TOTAL</td><td>' + list.length + ' suppliers</td>';
  h += money(t.b1) + money(t.b2) + money(t.b3) + money(t.b4) + money(t.total);
  h += '<td class="num">' + t.average + '</td></tr></tfoot></table>';
  var box = el('table');
  box.className = '';
  box.innerHTML = h;
  bind(box);
}
function bind(box) {
  var ths = box.querySelectorAll('th[data-k]');
  for (var i = 0; i < ths.length; i++) {
    ths[i].onclick = function () {
      var k = this.getAttribute('data-k');
      if (S.sort === k) { S.dir = -S.dir; } else { S.sort = k; S.dir = (k === 'code' || k === 'name') ? 1 : -1; }
      draw();
    };
  }
  var trs = box.querySelectorAll('tr.row');
  for (var j = 0; j < trs.length; j++) {
    trs[j].onclick = function () {
      var c = this.getAttribute('data-code');
      if (S.open[c]) { delete S.open[c]; } else { S.open[c] = true; }
      draw();
    };
  }
}
function detail(r) {
  var its = r.items || [];
  var h = '<tr class="detail"><td colspan="8"><table class="inner"><thead><tr>';
  h += '<th>Invoice</th><th>Description</th><th>Your reference</th><th>Invoice date</th><th>Due date</th>';
  h += '<th class="num">Days</th><th class="num">Amount</th></tr></thead><tbody>';
  its.forEach(function (it) {
    h += '<tr><td class="mono">' + esc(it.invoiceNumber) + '</td><td>' + esc(it.description) + '</td>';
    h += '<td>' + esc(it.yourRef) + '</td><td>' + esc(it.invoiceDate) + '</td><td>' + esc(it.dueDate) + '</td>';
    h += '<td class="num">' + (it.age === null || it.age === undefined ? '' : it.age) + '</td>';
    h += money(it.amount) + '</tr>';
  });
  return h + '</tbody></table></td></tr>';
}
function conn() {
  fetch('/api/status', { credentials: 'same-origin' }).then(function (r) {
    return r.json();
  }).then(function (j) {
    var p = el('conn');
    if (!p) { return; }
    if (j && j.authenticated) {
      p.className = 'pill ok';
      p.textContent = 'Exact Online connected';
    } else {
      p.className = 'pill bad';
      p.textContent = 'Not connected to Exact Online';
    }
  }).catch(function () {});
}
// Populate the entity dropdown from Exact Online (all entities the token can access).
function loadDivisions() {
  fetch('/api/divisions', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
    var sel = el('company');
    if (!sel || !j || !j.divisions) { return; }
    var cur = j.current ? String(j.current) : null;
    var html = '<option value="consolidated">Consolidated (all entities)</option>';
    for (var i = 0; i < j.divisions.length; i++) { var d = j.divisions[i]; html += '<option value="' + esc(d.code) + '">' + esc(d.label) + '</option>'; }
    sel.innerHTML = html;
    var def = 'consolidated';
    for (var k = 0; k < j.divisions.length; k++) { var code = String(j.divisions[k].code); var name = String(j.divisions[k].name || ''); if ((cur && code === cur) || /Numa Norge/i.test(name)) { def = code; break; } }
    sel.value = def; S.division = sel.value; load();
  }).catch(function () {});
}
function onDashboardChange(v) {
  S.dashboard = v;
  var h1 = document.querySelector('h1');
  if (v === 'ic') {
    if (h1) { h1.textContent = 'InterCompany report'; }
    if (window.__numaShowIC) { window.__numaShowIC(); }
    return;
  }
  if (h1) { h1.textContent = (v === 'ar') ? 'Ageing analysis: A/R' : 'Ageing analysis: A/P'; }
  if (window.__numaHideIC) { window.__numaHideIC(); }
  load();
}

shell();
conn();
loadDivisions();
setInterval(function () { conn(); load(); }, 300000);

// ===== NUMA: entity whitelist + consolidated view + UI extensions =====
(function () {
  if (window.__numaPatch) return;
  window.__numaPatch = 1;
  var NF = window.fetch, AMT = 'all', LAST = null, SIG = '', FIRST = true, VIEW = 'details', ACTIVE_ENT = null, SAVED_DETAILS_DIV = null;
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
    ['SOUTH', 720, 3745729, 'Numa Italia S.r.l.']
    ];
  window.NUMA_ENTITIES = ENT;
  function jr(o) { return new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  function nap(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function eur(n) { var s = Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\./g, ' '); return (n < 0 ? '\u2212' : '') + s + ' \u20ac'; }
  function pnum(t) { var s = (t || '').replace(/\u2212/g, '-').replace(/[^0-9,\-]/g, '').replace(/,/g, '.'); var v = parseFloat(s); return isNaN(v) ? 0 : v; }
  async function getOne(ep, div, date, rt) {
    for (var a = 0; a < 3; a++) {
      try {
        var r = await NF.call(window, ep + '?division=' + div + '&date=' + date + '&referTo=' + rt, { credentials: 'same-origin' });
        var j = await r.json();
        var bad = j && j.errors && !Array.isArray(j.errors) && Object.keys(j.errors).length > 0;
        if (r.status === 200 && !bad) return j;
      } catch (e) { }
      await nap(1500);
    }
    return { accounts: [], totals: { b1: 0, b2: 0, b3: 0, b4: 0, total: 0 }, itemCount: 0, __err: 1 };
  }
  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : ((input && input.url) || '');
    if (url.indexOf('/api/divisions') > -1) {
      return NF.call(window, input, init).then(function (r) { return r.json(); }).then(function (j) {
        var out = ENT.map(function (m) { return { code: m[2], human: m[1], region: m[0], name: m[3], label: m[1] + ' - ' + m[3], currency: 'EUR' }; });
        return jr({ current: j && j.current, divisions: out });
      });
    }
    if (url.indexOf('/api/ageing-') > -1 && url.indexOf('division=selected') > -1) {
      var u = new URL(url, location.origin), ep = u.pathname, date = u.searchParams.get('date'), rt = u.searchParams.get('referTo');
      return (async function () {
        var acc = [], T = { b1: 0, b2: 0, b3: 0, b4: 0, total: 0 }, n = 0, errs = [], per = [];
        for (var i = 0; i < ENT.length; i++) {
          var m = ENT[i], j = await getOne(ep, m[2], date, rt), t = j.totals || {};
          ['b1', 'b2', 'b3', 'b4', 'total'].forEach(function (k) { T[k] += (Number(t[k]) || 0); });
          n += Number(j.itemCount) || 0;
          if (j.__err) errs.push(m[1] + ': not available');
          per.push({ region: m[0], human: m[1], name: m[3], b1: Number(t.b1) || 0, b2: Number(t.b2) || 0, b3: Number(t.b3) || 0, b4: Number(t.b4) || 0, total: Number(t.total) || 0, accounts: Number(j.itemCount) || 0 });
          (Array.isArray(j.accounts) ? j.accounts : []).forEach(function (a) { a.name = (a.name || '') + ' [' + m[1] + ']'; a.entity = m[1]; a.region = m[0]; acc.push(a); });
          await nap(250);
        }
        acc.sort(function (x, y) { return (Number(y.total) || 0) - (Number(x.total) || 0); });
        window.NUMA_PER_ENTITY = per;
        LAST = { totals: T, accounts: acc };
        SIG = '';
        return jr({ referTo: rt, referenceDate: date, division: ENT.length + ' selected entities (HQ/DACH/WEST/SOUTH)', consolidated: true, currency: 'EUR', source: 'Exact Online', accounts: acc, totals: T, itemCount: n, errors: errs, lastUpdated: new Date().toISOString() });
      })();
    }
    var p = NF.call(window, input, init);
    if (url.indexOf('/api/ageing-') > -1) {
      return p.then(function (r) {
        return r.clone().json().then(function (j) { LAST = { totals: j.totals || null, accounts: Array.isArray(j.accounts) ? j.accounts : [] }; SIG = ''; return r; }).catch(function () { return r; });
      });
    }
    return p;
  };
  function fillSelect() {
    var sel = document.getElementById('company');
    if (!sel || (sel.querySelector('option[value="selected"]') && sel.options.length === ENT.length + 1)) return;
    var cur = sel.value;
    sel.innerHTML = '';
    var first = document.createElement('option');
    first.value = 'selected';
    first.text = 'Consolidated (' + ENT.length + ' selected entities)';
    sel.appendChild(first);
    ['HQ', 'DACH', 'WEST', 'SOUTH'].forEach(function (reg) {
      var g = document.createElement('optgroup');
      g.label = reg;
      ENT.filter(function (m) { return m[0] === reg; }).forEach(function (m) {
        var op = document.createElement('option');
        op.value = String(m[2]);
        op.text = m[1] + ' - ' + m[3];
        g.appendChild(op);
      });
      sel.appendChild(g);
    });
    sel.dataset.numa = '1';
    var want = 'selected'; try { want = sessionStorage.getItem('numaDiv') || 'selected'; } catch (e) { } var keep = [].slice.call(sel.options).some(function (o) { return o.value === want; });
    sel.value = keep ? want : 'selected'; if (!sel.__numaLs) { sel.__numaLs = 1; sel.addEventListener('change', function () { try { sessionStorage.setItem('numaDiv', sel.value); } catch (e) { } }); }
    if (sel.value !== cur && sel.onchange) sel.onchange();
  }
  function ui() {
ensureTabs();
if (VIEW === 'summary') { renderSummary(); return; }
fillSelect();
    var tb = document.querySelector('table');
    if (!tb) return;
    var bs = document.getElementById('bucket');
    if (bs && !document.getElementById('amount')) {
      var w = document.createElement('div');
      w.className = 'ctl';
      var lab = document.createElement('label');
      lab.setAttribute('for', 'amount');
      lab.textContent = 'AMOUNT';
      var s = document.createElement('select');
      s.id = 'amount';
      [['all', 'All amounts'], ['pos', 'Positive only (+)'], ['neg', 'Negative only (\u2212)']].forEach(function (o) {
        var op = document.createElement('option');
        op.value = o[0];
        op.text = o[1];
        s.appendChild(op);
      });
      s.value = AMT;
      s.onchange = function () { AMT = s.value; SIG = ''; ui(); };
      w.appendChild(lab);
      w.appendChild(s);
      bs.parentElement.parentElement.insertBefore(w, bs.parentElement.nextSibling);
    }
    [].slice.call(tb.querySelectorAll('thead th')).forEach(function (th) { if (th.textContent.indexOf('Over 90') > -1) th.textContent = th.textContent.replace('Over 90', '> 90'); });
    var rows = [].slice.call(tb.querySelectorAll('tbody tr')).filter(function (tr) { return tr.children.length === 8; });
    rows.forEach(function (tr) {
      var v = pnum(tr.children[6].textContent);
      tr.style.display = ((AMT === 'pos' && v < 0) || (AMT === 'neg' && v >= 0)) ? 'none' : '';
    });
    var D = LAST || { accounts: [], totals: null };
    var use = (D.accounts || []).filter(function (a) { var t = Number(a.total) || 0; return AMT === 'all' || (AMT === 'pos' ? t >= 0 : t < 0); });
    var S = [0, 0, 0, 0, 0];
    if (AMT === 'all' && D.totals) {
      S = [Number(D.totals.b1) || 0, Number(D.totals.b2) || 0, Number(D.totals.b3) || 0, Number(D.totals.b4) || 0, Number(D.totals.total) || 0];
    } else {
      use.forEach(function (a) { S[0] += Number(a.b1) || 0; S[1] += Number(a.b2) || 0; S[2] += Number(a.b3) || 0; S[3] += Number(a.b4) || 0; S[4] += Number(a.total) || 0; });
    }
    var sel = document.getElementById('company');
    var isAP = (document.getElementById('dashboard') || {}).value === 'ap';
    var who = isAP ? 'suppliers' : 'customers';
    var cnt = use.length;
    var tag = AMT === 'all' ? '' : (AMT === 'pos' ? ' \u00b7 positive only' : ' \u00b7 negative only');
    var f = tb.querySelector('tfoot tr');
    if (f && f.children.length === 8) {
      var c = f.children;
      c[0].textContent = 'TOTAL';
      c[1].textContent = cnt + ' ' + who + tag;
      [2, 3, 4, 5, 6].forEach(function (i, k) { c[i].textContent = eur(S[k]); c[i].style.color = S[k] < 0 ? '#7fb2ff' : ''; });
      c[7].textContent = '';
      f.style.fontWeight = '700';
    }
    var cards = [].slice.call(document.querySelectorAll('#kpis .kpi'));
    if (cards.length === 5) {
      var ent = (sel && sel.value === 'selected') ? (ENT.length + ' entities') : ((sel && sel.selectedOptions[0]) ? sel.selectedOptions[0].text : '1 entity');
      cards.forEach(function (k, i) {
        var bar = k.querySelector('.bar');
        if (bar) bar.remove();
        var sub = k.querySelector('.s'), v = k.querySelector('.v'), t = k.querySelector('.t');
        if (i === 0) {
          if (v) v.textContent = eur(S[4]);
          if (sub) sub.textContent = ent + ' \u00b7 ' + cnt + ' ' + who + tag;
        } else {
          var key = ['b1', 'b2', 'b3', 'b4'][i - 1];
          if (v) v.textContent = eur(S[i - 1]);
          if (sub) sub.textContent = use.filter(function (a) { return (Number(a[key]) || 0) !== 0; }).length + ' ' + who + ' in this bucket';
          if (t && t.textContent.indexOf('OVER 90') > -1) t.textContent = '> 90 DAYS';
        }
      });
    }
  }
  setInterval(function () {
    var tb = document.querySelector('table tbody');
    if (!tb) { fillSelect(); return; }
    var sel0 = document.getElementById('company'); var sig = tb.children.length + '|' + (tb.firstElementChild ? tb.firstElementChild.textContent.slice(0, 40) : '') + '|' + AMT + '|' + (document.getElementById('amount') ? 1 : 0) + '|' + (sel0 ? sel0.options.length + ':' + sel0.value : '');
    if (sig !== SIG) { SIG = sig; ui(); }
  }, 700);
  fillSelect();
ensureTabs();
layout();

function ensureTabs() {
if (document.getElementById('numaTabs')) { paintTabs(); return; }
var header = document.querySelector('header');
if (!header || !header.parentNode) return;
var bar = document.createElement('div');
bar.id = 'numaTabs';
bar.style.cssText = 'display:flex;gap:8px;padding:14px 24px 0;';
function mk(id, label) {
var b = document.createElement('button');
b.id = id;
b.type = 'button';
b.textContent = label;
return b;
}
var bSum = mk('tabSummary', 'Summary');
var bDet = mk('tabDetails', 'Details');
bSum.onclick = function () { setView('summary'); };
bDet.onclick = function () { setView('details'); };
bar.appendChild(bSum);
bar.appendChild(bDet);
header.parentNode.insertBefore(bar, header.nextSibling);
paintTabs();
}
function paintTabs() {
var bSum = document.getElementById('tabSummary'), bDet = document.getElementById('tabDetails');
if (!bSum || !bDet) return;
var on = 'background:#00bfff;border:1px solid #00bfff;color:#04121b;padding:8px 16px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;';
var off = 'background:transparent;border:1px solid #232c38;color:#8b98a5;padding:8px 16px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;';
bSum.style.cssText = VIEW === 'summary' ? on : off;
bDet.style.cssText = VIEW === 'details' ? on : off;
}
function setView(v) {
if (VIEW === v) return;
VIEW = v;
var sel = document.getElementById('company');
if (v === 'summary') {
if (sel) { SAVED_DETAILS_DIV = sel.value; sel.value = 'selected'; sel.disabled = true; }
S.division = 'selected';
ACTIVE_ENT = null;
} else {
if (sel) { sel.disabled = false; sel.value = SAVED_DETAILS_DIV || sel.value; }
if (sel) { S.division = sel.value; }
}
paintTabs();
layout();
load();
}
function layout() {
var controls = document.querySelector('.controls');
var wrap = document.querySelector('.wrap');
var summaryWrap = document.getElementById('summaryWrap');
if (!summaryWrap && wrap && wrap.parentNode) {
summaryWrap = document.createElement('div');
summaryWrap.id = 'summaryWrap';
summaryWrap.className = 'wrap';
wrap.parentNode.insertBefore(summaryWrap, wrap.nextSibling);
}
if (VIEW === 'summary') {
if (controls) controls.style.display = 'none';
if (wrap) wrap.style.display = 'none';
if (summaryWrap) summaryWrap.style.display = '';
} else {
if (controls) controls.style.display = '';
if (wrap) wrap.style.display = '';
if (summaryWrap) summaryWrap.style.display = 'none';
}
}
function entityAccounts(human) {
var acc = (LAST && LAST.accounts) ? LAST.accounts : [];
return acc.filter(function (a) { return a.entity === human; });
}
function vendorLabel(name, human) {
var tag = ' [' + human + ']';
var s = name || '';
var i = s.lastIndexOf(tag);
return i > -1 ? s.slice(0, i) : s;
}
function renderSummary() {
ensureTabs();
layout();
var box = document.getElementById('summaryWrap');
if (!box) return;
var acc = (LAST && LAST.accounts) ? LAST.accounts : [];
if (!acc.length) { box.innerHTML = '<div class="state">Loading live data from Exact Online...</div>'; return; }
var isAP = (document.getElementById('dashboard') || {}).value !== 'ar';
var who = isAP ? 'Suppliers' : 'Customers';
var rows = ENT.map(function (m) {
var list = entityAccounts(m[1]);
var t = totalsOf(list);
return { human: m[1], region: m[0], name: m[3], count: list.length, t: t, list: list };
});
var grand = totalsOf(acc);
var h = '<table><thead><tr>';
h += '<th class="txt">Entity</th><th class="num">' + who + '</th>';
h += '<th class="num">0 - 30</th><th class="num">31 - 60</th><th class="num">61 - 90</th><th class="num">&gt; 90</th><th class="num">Outstanding</th><th class="num">Average</th>';
h += '</tr></thead><tbody>';
rows.forEach(function (r) {
var risk = Math.abs(r.t.b4 || 0) > 0.004 ? ' risk' : '';
var activeStyle = (ACTIVE_ENT === r.human) ? ' style="background:#19212c;box-shadow:inset 3px 0 0 #00bfff;"' : '';
h += '<tr class="row' + risk + '" data-ent="' + esc(r.human) + '"' + activeStyle + '>';
h += '<td>' + esc(r.human) + ' - ' + esc(r.name) + '</td><td class="num"><span class="numaDrop" data-ent="' + esc(r.human) + '" style="cursor:pointer;text-decoration:underline;color:#00bfff;font-weight:700;">' + r.count + ' ' + (ACTIVE_ENT === r.human ? '\u25b4' : '\u25be') + '</span></td>';
h += money(r.t.b1) + money(r.t.b2, 'warn') + money(r.t.b3, 'hot') + money(r.t.b4, 'bad') + money(r.t.total, 'strong');
h += '<td class="num">' + (r.t.average || 0) + '</td></tr>';
if (ACTIVE_ENT === r.human) {
h += '<tr class="detail"><td colspan="8"><table class="inner"><thead><tr>';
h += '<th>' + (isAP ? 'Vendor' : 'Customer') + '</th><th class="num">0 - 30</th><th class="num">31 - 60</th><th class="num">61 - 90</th><th class="num">&gt; 90</th><th class="num">Outstanding</th><th class="num">Average</th></tr></thead><tbody>';
if (!r.list.length) {
h += '<tr><td colspan="7" class="state">No open items for this entity.</td></tr>';
}
r.list.forEach(function (a) {
h += '<tr><td>' + esc(vendorLabel(a.name, r.human)) + '</td>';
h += money(a.b1) + money(a.b2, 'warn') + money(a.b3, 'hot') + money(a.b4, 'bad') + money(a.total, 'strong');
h += '<td class="num">' + (a.average === null || a.average === undefined ? '' : a.average) + '</td></tr>';
});
h += '</tbody>';
if (r.list.length) {
h += '<tfoot><tr class="subtotal"><td><b>Subtotal ' + esc(r.human) + ' - ' + esc(r.name) + '</b></td>';
h += money(r.t.b1) + money(r.t.b2) + money(r.t.b3) + money(r.t.b4) + money(r.t.total);
h += '<td class="num"><b>' + (r.t.average || 0) + '</b></td></tr></tfoot>';
}
h += '</table></td></tr>';
}
});
h += '</tbody><tfoot><tr><td>TOTAL</td><td>' + rows.length + ' entities - ' + acc.length + ' ' + who.toLowerCase() + '</td>';
h += money(grand.b1) + money(grand.b2) + money(grand.b3) + money(grand.b4) + money(grand.total);
h += '<td class="num">' + grand.average + '</td></tr></tfoot></table>';
box.innerHTML = h;
var drops = box.querySelectorAll('.numaDrop');
for (var i = 0; i < drops.length; i++) {
drops[i].onclick = function (ev) {
if (ev && ev.stopPropagation) ev.stopPropagation();
var ent = Number(this.getAttribute('data-ent'));
ACTIVE_ENT = (ACTIVE_ENT === ent) ? null : ent;
renderSummary();
};
}
renderSummaryKpis();
}
function renderSummaryKpis() {
var acc = (LAST && LAST.accounts) ? LAST.accounts : [];
var list = ACTIVE_ENT ? entityAccounts(ACTIVE_ENT) : acc;
var t = totalsOf(list);
kpis(list, t);
var isAP = (document.getElementById('dashboard') || {}).value !== 'ar';
var who = isAP ? 'suppliers' : 'customers';
var cards = document.querySelectorAll('#kpis .kpi');
var keys = ['b1', 'b2', 'b3', 'b4'];
for (var i = 0; i < cards.length; i++) {
var bar = cards[i].querySelector('.bar');
if (bar) bar.remove();
var sub = cards[i].querySelector('.s');
var lab = cards[i].querySelector('.t');
if (i === 0) {
var entLabel;
if (ACTIVE_ENT) {
var m = null;
for (var k = 0; k < ENT.length; k++) { if (ENT[k][1] === ACTIVE_ENT) { m = ENT[k]; break; } }
entLabel = m ? (m[1] + ' - ' + m[3]) : String(ACTIVE_ENT);
} else {
entLabel = ENT.length + ' entities';
}
if (sub) sub.textContent = entLabel + ' \u00b7 ' + list.length + ' ' + who;
} else {
if (lab && lab.textContent.indexOf('OVER 90') > -1) lab.textContent = '> 90 DAYS';
var key = keys[i - 1];
var cnt = list.filter(function (a) { return Math.abs(Number(a[key]) || 0) > 0.004; }).length;
if (sub) sub.textContent = cnt + ' ' + who + ' in this bucket';
}
}
}
function icNorm(s) {
  return String(s || '').toLowerCase()
    .replace(/[.,()]/g, ' ')
    .replace(/\b(gmbh|ag|srl|s\.r\.o|sro|sas|s\.a\.s|sl|s\.l|bv|b\.v|ltd|limited|aps|lda|unipessoal|inc|corp|se|spa|s\.r\.l)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function icTokens(s) {
  return icNorm(s).split(' ').filter(function (w) { return w.length > 2; });
}
function icMatch(description, selfHuman) {
  var dTokens = icTokens(description);
  if (!dTokens.length) return null;
  var best = null, bestScore = 0;
  for (var i = 0; i < ENT.length; i++) {
    var e = ENT[i];
    if (e[1] === selfHuman) continue;
    var eTokens = icTokens(e[3]);
    var score = 0;
    for (var j = 0; j < eTokens.length; j++) { if (dTokens.indexOf(eTokens[j]) > -1) score++; }
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return bestScore > 0 ? best : null;
}
function ensureIC() {
  if (document.getElementById('icWrap')) return;
  var wrap = document.querySelector('.wrap');
  if (!wrap || !wrap.parentNode) return;
  var box = document.createElement('div');
  box.id = 'icWrap';
  box.style.cssText = 'display:none;padding:0 24px 24px;';
  box.innerHTML = '<div style="display:flex;align-items:center;gap:12px;margin:10px 0;">' +
    '<button id="icRun" type="button" style="background:#00bfff;border:1px solid #00bfff;color:#04121b;padding:10px 18px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">Run report</button>' +
    '<span id="icStatus" style="color:#8b98a5;font-size:13px;"></span>' +
    '</div>' +
    '<div id="icResults"></div>';
  wrap.parentNode.insertBefore(box, wrap.nextSibling);
  document.getElementById('icRun').onclick = function () { runIC(); };
}
function showIC() {
  ensureTabs();
  var tabs = document.getElementById('numaTabs'); if (tabs) tabs.style.display = 'none';
  var controls = document.querySelector('.controls'); if (controls) controls.style.display = 'none';
  var kpisEl = document.getElementById('kpis'); if (kpisEl) kpisEl.style.display = 'none';
  var wrap = document.querySelector('.wrap'); if (wrap) wrap.style.display = 'none';
  var summaryWrap = document.getElementById('summaryWrap'); if (summaryWrap) summaryWrap.style.display = 'none';
  var sel = document.getElementById('company'); if (sel) sel.disabled = true;
  var asof = document.getElementById('asof'); if (asof) asof.style.display = 'none';
  ensureIC();
  document.getElementById('icWrap').style.display = '';
}
function hideIC() {
  var icWrap = document.getElementById('icWrap'); if (icWrap) icWrap.style.display = 'none';
  var tabs = document.getElementById('numaTabs'); if (tabs) tabs.style.display = '';
  var asof = document.getElementById('asof'); if (asof) asof.style.display = '';
  var sel = document.getElementById('company'); if (sel) sel.disabled = (VIEW === 'summary');
  layout();
}
window.__numaShowIC = showIC;
window.__numaHideIC = hideIC;
async function icFetchOne(m) {
  try {
    var r = await NF.call(window, '/api/gl-balance?division=' + m[2] + '&balanceType=B', { credentials: 'same-origin' });
    var j = await r.json();
    if (!r.ok || (j && j.error)) return { m: m, error: (j && j.error) || 'error', accounts: [] };
    return { m: m, accounts: (j && j.accounts) || [] };
  } catch (e) { return { m: m, error: String(e), accounts: [] }; }
}
async function runIC() {
  var btn = document.getElementById('icRun');
  var status = document.getElementById('icStatus');
  if (btn) btn.disabled = true;
  var matrix = {};
  var unmatchedAll = [];
  var errors = [];
  for (var i = 0; i < ENT.length; i++) {
    var m = ENT[i];
    if (status) status.textContent = 'Duke lexuar ' + m[1] + ' - ' + m[3] + ' (' + (i + 1) + '/' + ENT.length + ')...';
    var res = await icFetchOne(m);
    if (res.error) { errors.push(m[1] + ': ' + res.error); continue; }
    matrix[m[1]] = matrix[m[1]] || {};
    (function (m, accounts) {
      accounts.forEach(function (a) {
        var target = icMatch(a.description, m[1]);
        if (target) {
          matrix[m[1]][target[1]] = (matrix[m[1]][target[1]] || 0) + a.amount;
        } else {
          unmatchedAll.push({ source: m[1] + ' - ' + m[3], glCode: a.code, glDescription: a.description, amount: a.amount });
        }
      });
    })(m, res.accounts);
    await nap(150);
  }
  if (btn) btn.disabled = false;
  if (status) status.textContent = 'U p\u00ebrfundua.' + (errors.length ? (' ' + errors.length + ' gabime.') : '');
  renderICTable(matrix, unmatchedAll, errors);
}
function renderICTable(matrix, unmatched, errors) {
  var out = document.getElementById('icResults');
  if (!out) return;
  var h = '<table><thead><tr><th class="txt">Lender / Borrower</th>';
  ENT.forEach(function (e) { h += '<th class="num">' + esc(e[3]) + '</th>'; });
  h += '</tr></thead><tbody>';
  ENT.forEach(function (row) {
    h += '<tr><td>' + esc(row[1]) + ' - ' + esc(row[3]) + '</td>';
    ENT.forEach(function (col) {
      if (col[1] === row[1]) { h += '<td class="num">-</td>'; return; }
      var v = matrix[row[1]] ? matrix[row[1]][col[1]] : undefined;
      if (v === undefined) { h += '<td class="num">-</td>'; }
      else { h += money(v); }
    });
    h += '</tr>';
  });
  h += '</tbody></table>';
  if (errors && errors.length) {
    h += '<div class="note" style="margin-top:10px;color:#ffb454;">Gabime: ' + esc(errors.join(' | ')) + '</div>';
  }
  if (unmatched && unmatched.length) {
    h += '<div style="margin-top:16px;"><div style="color:#8b98a5;font-size:13px;margin-bottom:6px;">Llogari q\u00eb nuk u p\u00ebrputhen automatikisht me nj\u00ebrin nga 19 entitetet (' + unmatched.length + '):</div>';
    h += '<table class="inner"><thead><tr><th>Entiteti burim</th><th>Kodi</th><th>P\u00ebrshkrimi</th><th class="num">Shuma</th></tr></thead><tbody>';
    unmatched.forEach(function (u) {
      h += '<tr><td>' + esc(u.source) + '</td><td class="mono">' + esc(u.glCode) + '</td><td>' + esc(u.glDescription) + '</td>' + money(u.amount) + '</tr>';
    });
    h += '</tbody></table></div>';
  }
  out.innerHTML = h;
}
})();

if (typeof loadDivisions === 'function') { setTimeout(function () { try { loadDivisions(); } catch (e) { } }, 0); }
