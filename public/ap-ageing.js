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
  return n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    '<select class="company" id="dashboard" title="Dashboards"><option value="ap">Dashboards: AP Ageing</option><option value="ar">Dashboards: AR Ageing</option></select>',
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
  var url = '/api/ageing-ap?referTo=' + encodeURIComponent(el('referto').value) + '&date=' + encodeURIComponent(el('refdate').value) + '&division=' + encodeURIComponent(div);
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
  el('asof').innerHTML = 'As of <b>' + esc(d.referenceDate || el('refdate').value) + '</b> - aged by ' + by + ' - live from Exact Online, refreshed ' + w.toLocaleString('nb-NO');
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
  var h = '<div class="kpi big"><div class="t">TOTAL OUTSTANDING</div><div class="v">' + fmt(t.total) + '</div>';
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
    for (var i = 0; i < j.divisions.length; i++) {
      var d = j.divisions[i];
      html += '<option value="' + esc(d.code) + '">' + esc(d.label) + '</option>';
    }
    sel.innerHTML = html;
    var def = 'consolidated';
    for (var k = 0; k < j.divisions.length; k++) {
      var code = String(j.divisions[k].code);
      var name = String(j.divisions[k].name || '');
      if ((cur && code === cur) || /Numa Norge/i.test(name)) { def = code; break; }
    }
    sel.value = def;
    S.division = sel.value;
    load();
  }).catch(function () {});
}
function onDashboardChange(v) {
  S.dashboard = v;
  var h1 = document.querySelector('h1');
  if (v === 'ar') {
    if (h1) { h1.textContent = 'Ageing analysis: A/R'; }
    var box = el('table');
    if (box) { box.className = 'state'; box.innerHTML = 'A/R Ageing is coming soon. Switch back to <b>AP Ageing</b> to view payables.'; }
    el('kpis').innerHTML = '';
  } else {
    if (h1) { h1.textContent = 'Ageing analysis: A/P'; }
    load();
  }
}

shell();
conn();
loadDivisions();
setInterval(function () { conn(); load(); }, 300000);
