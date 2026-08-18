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
  var S = { entity: '1000', year: 'all', code: '272200', rows: [], open: {}, det: {}, busy: false, errors: [], q: '', done: 0, total: 0, sort: '', dir: 1, view: 'details', sumOpen: {} };

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
    var opts = '';
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
      '',
      '<h1>Accrued</h1>',
      '<div class="sub" id="asof">Transactions | G/L Account - live data from Exact Online</div>',
      '<div class="controls">',
      '<div class="ctl"><label for="year">FINANCIAL YEAR</label><select id="year">' + yopts + '</select></div>',
      '<div class="ctl"><label for="gl">G/L ACCOUNT</label><select id="gl">' + gopts + '</select></div>',
      '<div class="ctl grow"><label for="q">SEARCH</label><input id="q" type="text" placeholder="Entry no., description, account"></div>',
      '<div class="ctl"><label>&nbsp;</label><button class="btn" id="apply">Apply</button></div>',
      '<div class="ctl"><label>&nbsp;</label><button class="btn sec" id="expandAll">Expand all</button></div>',
      '</div>',
      '<div class="vtabs" id="vtabs"><button type="button" class="vtab on" id="vDet">Details</button><button type="button" class="vtab" id="vSum">Summary</button></div>', '<div class="kpis" id="kpis"></div>',
      '<div class="sumbox" id="sumWrap"></div>', '<div class="wrap" id="wrap"><div class="state">Choose a financial year and press Apply</div></div>',
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
    el('expandAll').onclick = function () { expandAll(); }; el('vDet').onclick = function () { S.view = 'details'; paintView(); draw(); }; el('vSum').onclick = function () { S.view = 'summary'; paintView(); draw(); }; paintView();
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
  function nsTime(v){ var s=String(v||''); var m=s.match(/\/Date\((\-?[0-9]+)/); if(m) return Number(m[1]); var t=Date.parse(s); return isNaN(t)?0:t; } function nsSortKey(lbl){ var m={ 'Date':'date', 'Period':'period', 'Entry no.':'entryNumber', 'Journal':'journalCode', 'Description':'description', 'Account':'accountCode', 'Debit':'debit', 'Credit':'credit' }; return m[lbl]||''; } function nsSort(arr){ var k=nsSortKey(S.sort); if(!k) return arr; var c=arr.slice(); c.sort(function(x,y){ var a,b; if(k==='date'){ a=nsTime(x.date); b=nsTime(y.date); } else { a=x[k]; b=y[k]; } if(typeof a==='number'||typeof b==='number'){ return (Number(a||0)-Number(b||0))*S.dir; } a=String(a||'').toLowerCase(); b=String(b||'').toLowerCase(); return (a<b?-1:(a>b?1:0))*S.dir; }); return c; } function nsEntries(rows){ var o={}; rows.forEach(function(l){ o[keyOf(l)]=1; }); return Object.keys(o).length; } function nsSummary(rows){ var y={}; rows.forEach(function(l){ var k=String(l.year||''); if(!y[k]) y[k]={n:0,d:0,c:0}; y[k].n++; y[k].d+=Number(l.debit||0); y[k].c+=Number(l.credit||0); }); var ks=Object.keys(y).sort(); if(ks.length<2) return ''; var h=''; ks.forEach(function(k){ var v=y[k]; h+='<div class="sumcard"><b>' + esc(k) + '</b><span class="sml">' + v.n + ' lines</span><span class="sml">Debit ' + eur(v.d) + '</span><span class="sml">Credit ' + eur(v.c) + '</span><span class="snet">Net ' + eur(v.d - v.c) + '</span></div>'; }); return h; } function nsEnhance(w){ try { var t=w.querySelector('table'); if(!t) return; var rows=t.querySelectorAll('tbody tr.row'); var last=null; for(var i=0;i<rows.length;i++){ var e=rows[i].getAttribute('data-e'); var isNew=(e!==last); last=e; rows[i].className='row'+((i%2)?' alt':'')+((isNew&&i)?' grp':''); } var ths=t.querySelectorAll('thead th'); for(var s=0;s<ths.length;s++){ (function(th){ var lbl=(th.textContent||'').trim(); if(!nsSortKey(lbl)) return; th.className=(th.className?th.className+' ':'')+'sortable'+(S.sort===lbl?(S.dir>0?' ns-asc':' ns-dsc'):''); th.title='Sort by ' + lbl; th.onclick=function(){ if(S.sort===lbl){ S.dir=-S.dir; } else { S.sort=lbl; S.dir=1; } draw(); }; })(ths[s]); } } catch(err){} } function paintView(){ var a=el('vDet'), b=el('vSum'); if(a) a.className='vtab'+(S.view==='details'?' on':''); if(b) b.className='vtab'+(S.view==='summary'?' on':''); var x=el('expandAll'); if(x) x.textContent=(S.view==='summary'?'Expand all cost centres':'Expand all'); } function nsCC(l){ var c=String(l.costCenter||'').trim(); var n=String(l.costCenterName||'').trim(); if(!c&&!n) return 'Without cost centre'; return c?(c+(n?' - '+n:'')):n; } function nsACC(l){ var c=String(l.accountCode||'').trim(); var n=String(l.accountName||'').trim(); if(!c&&!n) return 'Without account'; return c?(c+(n?' - '+n:'')):n; } function nsPerKey(l){ var y=Number(l.year||0); var p=Number(l.period||0); return y*100+p; } function nsPerLbl(k){ var y=Math.floor(k/100); var p=k%100; return (p<10?'0'+p:''+p)+'. '+y; } function nsAmt(v){ v=Number(v||0); if(Math.abs(v)<0.005) return '<span class="z">-</span>'; return '<span class="'+(v<0?'neg':'pos')+'">'+eur(v)+'</span>'; } function nsPivot(rows){ var cols={}, tree={}; rows.forEach(function(l){ var pk=nsPerKey(l); cols[pk]=1; var cc=nsCC(l), ac=nsACC(l); if(!tree[cc]) tree[cc]={t:0,n:0,per:{},ch:{}}; var g=tree[cc]; if(!g.ch[ac]) g.ch[ac]={t:0,n:0,per:{}}; var v=Number(l.debit||0)-Number(l.credit||0); g.t+=v; g.n++; g.per[pk]=(g.per[pk]||0)+v; g.ch[ac].t+=v; g.ch[ac].n++; g.ch[ac].per[pk]=(g.ch[ac].per[pk]||0)+v; }); var ck=Object.keys(cols).map(Number).sort(function(a,b){return a-b;}); return {ck:ck, tree:tree}; } function nsSumHtml(rows){ var p=nsPivot(rows); var ck=p.ck; var names=Object.keys(p.tree).sort(); if(!names.length) return '<div class="state">No data for this selection</div>'; var sep={}, py=0; ck.forEach(function(k){ var yy=Math.floor(k/100); if(py&&yy!==py) sep[k]=' ys'; py=yy; }); var h='<table class="pivot"><thead><tr><th class="c1">Cost centre / Account</th>'; ck.forEach(function(k){ h+='<th class="num'+(sep[k]||'')+'">'+esc(nsPerLbl(k))+'</th>'; }); h+='<th class="num gt">Grand Total</th></tr></thead><tbody>'; var tot={}, gt=0; names.forEach(function(cc){ var g=p.tree[cc]; var open=!!S.sumOpen[cc]; h+='<tr class="pcc" data-cc="'+esc(cc)+'"><td class="c1" title="'+esc(cc)+'">'+(open?'\u25be':'\u25b8')+' '+esc(cc)+' <span class="sml">('+g.n+' lines)</span></td>'; ck.forEach(function(k){ var v=g.per[k]||0; tot[k]=(tot[k]||0)+v; h+='<td class="num'+(sep[k]||'')+'">'+nsAmt(v)+'</td>'; }); gt+=g.t; h+='<td class="num gt">'+nsAmt(g.t)+'</td></tr>'; if(open){ Object.keys(g.ch).sort().forEach(function(ac){ var c=g.ch[ac]; h+='<tr class="pac"><td class="c1" title="'+esc(ac)+'">'+esc(ac)+' <span class="sml">('+c.n+')</span></td>'; ck.forEach(function(k){ h+='<td class="num'+(sep[k]||'')+'">'+nsAmt(c.per[k]||0)+'</td>'; }); h+='<td class="num gt">'+nsAmt(c.t)+'</td></tr>'; }); } }); h+='</tbody><tfoot><tr><td class="c1">Grand Total &middot; '+names.length+' cost centres</td>'; ck.forEach(function(k){ h+='<td class="num'+(sep[k]||'')+'">'+nsAmt(tot[k]||0)+'</td>'; }); h+='<td class="num gt">'+nsAmt(gt)+'</td></tr></tfoot></table>'; return h; } function shortName(n) {
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
    var en = entOf(S.entity); a.textContent = t || ((en ? en[1] + ' - ' + en[3] : 'Entity') + '  \u00b7  G/L ' + S.code + '  \u00b7  ' + (S.year === 'all' ? 'financial years 2024 - 2026' : 'financial year ' + S.year) + '  \u00b7  updated ' + new Date().toLocaleTimeString('de-DE'));
  }
  function filtered() { return nsSort(filteredRaw()); } function filteredRaw() {
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
        kpi('TRANSACTION LINES', String(rows.length), (S.busy ? 'loading ' + S.done + '/' + S.total : (S.q ? rows.length + ' of ' + S.rows.length + ' lines match the search' : nsEntries(rows) + ' journal entries'))),
        kpi('TOTAL DEBIT', eur(d), 'sum of all debit lines'),
        kpi('TOTAL CREDIT', eur(c), 'sum of all credit lines'),
        kpi('NET (DEBIT - CREDIT)', eur(bal), 'debit minus credit of the lines shown', 'var(--blue)')
      ].join('');
    }
    var sw = el('sumWrap'); if (sw) sw.innerHTML = nsSummary(rows); var w = el('wrap');
    if (!w) return;
    if (!rows.length) {
      w.innerHTML = '<div class="state">' + (S.busy ? 'Loading data from Exact Online (' + S.done + '/' + S.total + ')' : 'No transactions for this selection') + '</div>';
      note();
      return;
    }
    if (S.view === 'summary') { w.innerHTML = nsSumHtml(rows); var pcs = w.querySelectorAll('tr.pcc'); for (var pi = 0; pi < pcs.length; pi++) { pcs[pi].onclick = function () { var ck = this.getAttribute('data-cc'); if (S.sumOpen[ck]) { delete S.sumOpen[ck]; } else { S.sumOpen[ck] = 1; } draw(); }; } note(); return; } var cons = S.entity === 'consolidated';
    var h = '<table><thead><tr>';
    h += '<th style="width:22px"></th>';
    if (cons) h += '<th>Entity</th>';
    var nsShown = {}; var hasAcct = false; rows.forEach(function(l){ if (l.accountCode || l.accountName) hasAcct = true; }); h += '<th>Date</th><th>Period</th><th>Entry no.</th><th>Journal</th><th>Description</th>' + (hasAcct ? '<th>Account</th>' : '') + '<th class="num">Debit</th><th class="num">Credit</th>';
    h += '</tr></thead><tbody>';
    rows.forEach(function (l) {
      var key = keyOf(l);
      var isOpen = !!S.open[key];
      h += '<tr class="row" data-k="' + esc(key) + '" data-e="' + esc(l.entryNumber) + '" data-d="' + esc(l.division) + '" data-y="' + esc(l.year) + '">';
      h += '<td class="caret">' + (isOpen ? '\u25be' : '\u25b8') + '</td>';
      if (cons) h += '<td>' + esc(l.entityCode + ' - ' + shortName(l.entityName)) + '</td>';
      h += '<td>' + fmtDate(l.date) + '</td>';
      h += '<td class="mono per">' + esc(l.year) + ' P' + esc(l.period) + '</td>'; h += '<td class="mono link">' + esc(l.entryNumber) + '</td>';
      h += '<td>' + esc(l.journalCode + (l.journalDescription ? ' - ' + l.journalDescription : '')) + '</td>';
      h += '<td class=\'desc\' title="' + esc(l.description) + '">' + esc(l.description) + '</td>';
      if (hasAcct) h += '<td class=\'acct\' title="' + esc(l.accountName) + '">' + esc(l.accountCode ? (l.accountCode + ' - ' + l.accountName) : l.accountName) + '</td>';
      h += '<td class="num">' + (l.debit ? eur(l.debit) : '') + '</td>';
      h += '<td class="num">' + (l.credit ? eur(l.credit) : '') + '</td>';
      h += '</tr>';
      if (isOpen && !nsShown[key]) { nsShown[key] = 1;
        h += '<tr class="detail"><td colspan="' + ((cons ? 10 : 9) - (hasAcct ? 0 : 1)) + '">' + detailHtml(key) + '</td></tr>';
      }
    });
    h += '</tbody><tfoot>';
    h += '<tr><td colspan="' + (cons ? 7 : 6) + '">Total of ' + rows.length + ' lines</td>' + (hasAcct ? '<td></td>' : '') + '<td class="num">' + eur(d) + '</td><td class="num">' + eur(c) + '</td></tr>';
    h += '<tr><td colspan="' + (cons ? 7 : 6) + '">Net (Debit - Credit)</td>' + (hasAcct ? '<td></td>' : '') + '<td class="num" colspan="2" style="color:#8fd0ff">' + eur(bal) + '</td></tr>';
    h += '</tfoot></table>';
    w.innerHTML = h; nsEnhance(w);
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
    var t = (S.view === 'summary') ? 'Summary per cost centre: every row is a cost centre, the columns are the financial periods (period. year) and the last column is the Grand Total. Click a cost centre to open the accounts inside it. Amounts are Debit minus Credit, so a positive figure increases the accrual account.' : 'Click any row to open the full journal entry: G/L account, description, debit, credit and the entry total (balance check). Click a column header to sort, and use the search box to filter.';
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
      h += '<td class=\'desc\' title="' + esc(l.description) + '">' + esc(l.description) + '</td>';
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
    if (S.view === 'summary') { var pv = nsPivot(filtered()); Object.keys(pv.tree).forEach(function (k) { S.sumOpen[k] = 1; }); draw(); return; } var rows = filtered().slice(0, 15);
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
