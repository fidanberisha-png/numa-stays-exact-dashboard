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
    ['272210', 'Accrued Expenses - Budget']
    
  ];
  var YEARS = [2026, 2025, 2024];
  var REGIONS = ['HQ', 'DACH', 'WEST', 'SOUTH'];
  var S = { entity: '', year: 'all', code: '272200', rows: [], srows: [], open: {}, det: {}, busy: false, errors: [], q: '', done: 0, total: 0, sort: '', dir: 1, view: 'summary', sumOpen: {} };

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
    var opts = '<option value="">Choose an entity</option>';
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
      '<div class="vtabs" id="vtabs"><button type="button" class="vtab on" id="vSum">Summary</button><button type="button" class="vtab" id="vDet">Details</button></div>', '<div class="kpis" id="kpis"></div>',
      '<div class="sumbox" id="sumWrap"></div>', '<div class="wrap" id="wrap"><div class="state">Choose a financial year and press Apply</div></div>',
      '<div class="note" id="note"></div>'
    ].join('');
    el('company').value = S.entity;
    el('year').value = String(S.year);
    el('gl').value = S.code;
    el('company').onchange = function () { S.entity = this.value; paintTabs(); setStatus(''); loadAccounts(); };
    el('year').onchange = function () { S.year = this.value; };
    el('gl').onchange = function () { S.code = this.value; };
    el('apply').onclick = function () { run(); };
    el('refresh').onclick = function () { S.fresh = true; run(); };
    el('expandAll').onclick = function () { expandAll(); }; el('vDet').onclick = function () { S.view = 'details'; paintView(); draw(); }; el('vSum').onclick = function () { S.view = 'summary'; paintView(); draw(); }; paintView();
    el('q').oninput = function () { S.q = this.value; draw(); };
    el('dashboard').value = 'accrued';
    el('dashboard').onchange = function () {
      var v = this.value;
      if (v !== 'accrued') { window.location.href = '/?dashboard=' + v; }
    };
    paintTabs();
  }
  // Not every entity keeps every accrual account. The G/L ACCOUNT box therefore
  // shows what Exact really has for the entity that is chosen, and on top of that
  // one merged choice that reads all of those accounts together.
  var ALL_CODE = 'ALL';
  function glList() {
    if (S.accounts && S.accounts.length) {
      return S.accounts.map(function (a) { return [a.code, a.description || ('G/L ' + a.code)]; });
    }
    return GLS.slice();
  }
  function codes() {
    if (String(S.code) !== ALL_CODE) return [String(S.code)];
    return glList().map(function (g) { return g[0]; });
  }
  function paintGL() {
    var sel = el('gl');
    if (!sel) return;
    var list = glList();
    var h = '<option value="' + ALL_CODE + '">' + esc('All accrual accounts (' + list.length + ' merged)') + '</option>';
    list.forEach(function (g) { h += '<option value="' + g[0] + '">' + esc(g[1] + ' (' + g[0] + ')') + '</option>'; });
    sel.innerHTML = h;
    var ok = false;
    for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === String(S.code)) ok = true; }
    if (!ok) S.code = ALL_CODE;
    sel.value = S.code;
  }
  async function loadAccounts() {
    var e = entOf(S.entity);
    S.accounts = null;
    paintGL();
    if (!e) return;
    try {
      var r = await fetch('/api/accrued/accounts?division=' + e[2], { credentials: 'same-origin' });
      var j = await r.json();
      if (r.ok && j && j.accounts && j.accounts.length) S.accounts = j.accounts;
    } catch (err) { S.accounts = null; }
    paintGL();
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
  function nsTime(v){ var s=String(v||''); var m=s.match(/\/Date\((\-?[0-9]+)/); if(m) return Number(m[1]); var t=Date.parse(s); return isNaN(t)?0:t; } function nsSortKey(lbl){ var m={ 'Date':'date', 'Period':'period', 'Entry no.':'entryNumber', 'Journal':'journalCode', 'Description':'description', 'Account':'accountCode', 'Debit':'debit', 'Credit':'credit' }; return m[lbl]||''; } function nsSort(arr){ var k=nsSortKey(S.sort); if(!k) return arr; var c=arr.slice(); c.sort(function(x,y){ var a,b; if(k==='date'){ a=nsTime(x.date); b=nsTime(y.date); } else { a=x[k]; b=y[k]; } if(typeof a==='number'||typeof b==='number'){ return (Number(a||0)-Number(b||0))*S.dir; } a=String(a||'').toLowerCase(); b=String(b||'').toLowerCase(); return (a<b?-1:(a>b?1:0))*S.dir; }); return c; } function nsEntries(rows){ var o={}; rows.forEach(function(l){ o[keyOf(l)]=1; }); return Object.keys(o).length; } function nsSummary(rows){ var y={}; rows.forEach(function(l){ var k=String(l.year||''); if(!y[k]) y[k]={n:0,d:0,c:0}; y[k].n++; y[k].d+=Number(l.debit||0); y[k].c+=Number(l.credit||0); }); var ks=Object.keys(y).sort(); if(ks.length<2) return ''; var h=''; ks.forEach(function(k){ var v=y[k]; h+='<div class="sumcard"><b>' + esc(k) + '</b><span class="sml">' + v.n + ' lines</span><span class="sml">Debit ' + eur(v.d) + '</span><span class="sml">Credit ' + eur(v.c) + '</span><span class="snet">Net ' + eur(v.d - v.c) + '</span></div>'; }); return h; } function nsEnhance(w){ try { var t=w.querySelector('table'); if(!t) return; var rows=t.querySelectorAll('tbody tr.row'); var last=null; for(var i=0;i<rows.length;i++){ var e=rows[i].getAttribute('data-e'); var isNew=(e!==last); last=e; rows[i].className='row'+((i%2)?' alt':'')+((isNew&&i)?' grp':''); } var ths=t.querySelectorAll('thead th'); for(var s=0;s<ths.length;s++){ (function(th){ var lbl=(th.textContent||'').trim(); if(!nsSortKey(lbl)) return; th.className=(th.className?th.className+' ':'')+'sortable'+(S.sort===lbl?(S.dir>0?' ns-asc':' ns-dsc'):''); th.title='Sort by ' + lbl; th.onclick=function(){ if(S.sort===lbl){ S.dir=-S.dir; } else { S.sort=lbl; S.dir=1; } draw(); }; })(ths[s]); } } catch(err){} } function paintView(){ var a=el('vDet'), b=el('vSum'); if(a) a.className='vtab'+(S.view==='details'?' on':''); if(b) b.className='vtab'+(S.view==='summary'?' on':''); var x=el('expandAll'); if(x) x.textContent=(S.view==='summary'?'Expand all cost centres':'Expand all'); var qq=el('q'); if(qq) qq.placeholder=(S.view==='summary'?'Cost centre or G/L account':'Entry no., description, account'); } function nsGLCount(rows){ var o={}; rows.forEach(function(l){ o[nsGL(l)]=1; }); return Object.keys(o).length; } function nsCCCount(rows){ var o={}; rows.forEach(function(l){ o[nsCC(l)]=1; }); return Object.keys(o).length; } function nsSumFiltered(){ var q=(S.q||'').trim().toLowerCase(); if(!q) return S.srows; return S.srows.filter(function(l){ var hay=[l.costCenter,l.costCenterName,l.glCode,l.glDescription].join(' ').toLowerCase(); return hay.indexOf(q)>=0; }); } function drawSummary(){ var rows=nsSumFiltered(); var d=0,c=0; rows.forEach(function(l){ d+=Number(l.debit||0); c+=Number(l.credit||0); }); var k=el('kpis'); if(k){ k.innerHTML=[kpi('COST CENTRES', String(nsCCCount(rows)), (S.busy?'loading '+S.done+'/'+S.total:(nsGLCount(rows)+' G/L accounts, '+rows.length+' lines'))), kpi('TOTAL DEBIT', eur(S.gross ? S.gross.d : d), 'debit booked on the accrual account itself in Exact'), kpi('TOTAL CREDIT', eur(S.gross ? S.gross.c : c), 'credit booked on the accrual account itself in Exact'), kpi('NET (DEBIT - CREDIT)', eur(d-c), 'debit minus credit of the lines shown', 'var(--blue)', DASH_NOTE)].join(''); } var sw=el('sumWrap'); if(sw) sw.innerHTML=''; var w=el('wrap'); if(!w) return; if(!rows.length){ w.innerHTML='<div class="state">'+(S.busy?'Loading the summary from Exact Online ('+S.done+'/'+S.total+') - every journal entry is opened, so this takes longer':(!S.entity?'Choose an entity, financial year and G/L account, then press Apply':'No data for this selection'))+'</div>'; note(); return; } w.innerHTML=nsSumHtml(rows); var pcs=w.querySelectorAll('tr.pcc'); for(var i2=0;i2<pcs.length;i2++){ pcs[i2].onclick=function(){ var ck=this.getAttribute('data-cc'); if(S.sumOpen[ck]){ delete S.sumOpen[ck]; } else { S.sumOpen[ck]=1; } draw(); }; } note(); } function nsCC(l){ var c=String(l.costCenter||'').trim(); var n=String(l.costCenterName||'').trim(); if(!c&&!n) return NO_CC_LABEL; return c?(c+(n?' - '+n:'')):n; } function nsGL(l){ var c=String(l.glCode||'').trim(); var n=String(l.glDescription||'').trim(); if(!c&&!n) return NO_GL_LABEL; return c?(c+(n?' - '+n:'')):n; } function nsPerKey(l){ var y=Number(l.year||0); var p=Number(l.period||0); return y*100+p; } function nsPerLbl(k){ var y=Math.floor(k/100); var p=k%100; return (p<10?'0'+p:''+p)+'. '+y; } function nsAmt(v){ v=Number(v||0); if(Math.abs(v)<0.005) return '<span class="z">-</span>'; return '<span class="'+(v<0?'neg':'pos')+'">'+eur(v)+'</span>'; } function nsPivot(rows){ var cols={}, tree={}; rows.forEach(function(l){ var pk=nsPerKey(l); cols[pk]=1; var cc=nsCC(l), ac=nsGL(l); if(!tree[cc]) tree[cc]={t:0,n:0,per:{},ch:{}}; var g=tree[cc]; if(!g.ch[ac]) g.ch[ac]={t:0,n:0,per:{}}; var v=Number(l.debit||0)-Number(l.credit||0); g.t+=v; g.n++; g.per[pk]=(g.per[pk]||0)+v; g.ch[ac].t+=v; g.ch[ac].n++; g.ch[ac].per[pk]=(g.ch[ac].per[pk]||0)+v; }); var ck=Object.keys(cols).map(Number).sort(function(a,b){return a-b;}); return {ck:ck, tree:tree}; } function nsSumHtml(rows){ var p=nsPivot(rows); var ck=p.ck; var names=Object.keys(p.tree).sort(); if(!names.length) return '<div class="state">No data for this selection</div>'; var sep={}, py=0; ck.forEach(function(k){ var yy=Math.floor(k/100); if(py&&yy!==py) sep[k]=' ys'; py=yy; }); var h='<table class="pivot"><thead><tr><th class="c1">Cost centre / G/L account</th>'; ck.forEach(function(k){ h+='<th class="num'+(sep[k]||'')+'">'+esc(nsPerLbl(k))+'</th>'; }); h+='<th class="num gt">Grand Total</th></tr></thead><tbody>'; var tot={}, gt=0; names.forEach(function(cc){ var g=p.tree[cc]; var open=!!S.sumOpen[cc]; h+='<tr class="pcc" data-cc="'+esc(cc)+'"><td class="c1" title="'+esc(cc)+'">'+(open?'\u25be':'\u25b8')+' '+esc(cc)+rowInfo(cc)+' <span class="sml">('+g.n+' lines)</span></td>'; ck.forEach(function(k){ var v=g.per[k]||0; tot[k]=(tot[k]||0)+v; h+='<td class="num'+(sep[k]||'')+'">'+nsAmt(v)+'</td>'; }); gt+=g.t; h+='<td class="num gt">'+nsAmt(g.t)+'</td></tr>'; if(open){ Object.keys(g.ch).sort().forEach(function(ac){ var c=g.ch[ac]; h+='<tr class="pac"><td class="c1" title="'+esc(ac)+'">'+esc(ac)+rowInfo(ac)+' <span class="sml">('+c.n+')</span></td>'; ck.forEach(function(k){ h+='<td class="num'+(sep[k]||'')+'">'+nsAmt(c.per[k]||0)+'</td>'; }); h+='<td class="num gt">'+nsAmt(c.t)+'</td></tr>'; }); } }); h+='</tbody><tfoot><tr><td class="c1">Grand Total &middot; '+names.length+' cost centres</td>'; ck.forEach(function(k){ h+='<td class="num'+(sep[k]||'')+'">'+nsAmt(tot[k]||0)+'</td>'; }); h+='<td class="num gt">'+nsAmt(gt)+'</td></tr></tfoot></table>'; return h; } function shortName(n) {
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

  async function fetchOne(div, year, fresh, code) {
    for (var a = 0; a < 3; a++) {
      try {
        var r = await fetch('/api/accrued/transactions?division=' + div + '&year=' + year + '&code=' + encodeURIComponent(code || S.code) + (fresh ? '&fresh=1' : ''), { credentials: 'same-origin' });
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

  async function fetchSum(div, year, fresh, code) { for (var a = 0; a < 2; a++) { try { var r = await fetch('/api/accrued/summary?division=' + div + '&year=' + year + '&code=' + encodeURIComponent(code || S.code) + (fresh ? '&fresh=1' : ''), { credentials: 'same-origin' }); var j = await r.json(); if (r.ok && j && !j.error) return j; if (r.status === 401) return { error: 'Not connected to Exact Online' }; if (r.status === 429) return { error: (j && (j.error || j.detail)) || 'Exact Online has no requests left for this entity right now' }; if (a === 1) return { error: (j && (j.error || j.detail)) || ('HTTP ' + r.status) }; } catch (e) { if (a === 1) return { error: String(e) }; } await sleep(1500); } return { error: 'unknown' }; }

  // One entity is one division in Exact Online, and Exact counts its request
  // limit per division. Different entities can therefore be read side by side
  // without pushing that limit, while the years of one entity stay one after
  // the other. That is what turns twenty entities from minutes into seconds.
  var LANES = 4;
  async function run() {
    if (S.busy) return;
    S.busy = true;
    if (!S.entity) { S.busy = false; S.rows = []; S.srows = []; draw(); setStatus(''); return; } S.rows = []; S.srows = [];
    S.open = {};
    S.det = {};
    S.errors = []; S.gross = { d: 0, c: 0 };
    var list = targets();
    var ys = years();
    var cs = codes();
    // One piece of work is one entity, one financial year and one accrual account.
    // The merged choice simply turns into several pieces of work that end up in the
    // same table, so a merged view is built from the very same reads as a single one.
    var jobs = [];
    list.forEach(function (m) { ys.forEach(function (y) { cs.forEach(function (c) { jobs.push([m, y, c]); }); }); });
    S.total = jobs.length;
    S.done = 0;
    var fresh = S.fresh ? 1 : 0;
    S.fresh = false;
    draw();
    var next = 0;
    var lastDraw = 0;
    var misses = [];
    function absorb(m, y, c, j) {
      if (j.error) { if (!/no requests left today|429/.test(String(j.error))) misses.push([m, y, c]); S.errors.push(m[1] + ' ' + y + ' ' + c + ': ' + j.error); return; }
            if (j.accountTotals) { if (!S.gross) S.gross = { d: 0, c: 0 }; S.gross.d += (Number(j.accountTotals.debit) || 0); S.gross.c += (Number(j.accountTotals.credit) || 0); }
      ((S.view === 'summary' ? j.rows : j.lines) || []).forEach(function (l) {
        l.entityCode = m[1];
        l.entityName = m[3];
        l.division = m[2];
        if (S.view === 'summary') { S.srows.push(l); } else { S.rows.push(l); }
      });
    }
    function tick() {
      var now = Date.now();
      if (now - lastDraw < 400) return;
      lastDraw = now;
      draw();
    }
    async function lane() {
      while (next < jobs.length) {
        var jb = jobs[next++];
        var j = (S.view === 'summary') ? await fetchSum(jb[0][2], jb[1], fresh, jb[2]) : await fetchOne(jb[0][2], jb[1], fresh, jb[2]);
        S.done++;
        absorb(jb[0], jb[1], jb[2], j);
        setStatus('Loading ' + S.done + ' of ' + S.total + ' (year and account)' + (S.errors.length ? ' - ' + S.errors.length + ' failed' : ''));
        tick();
      }
    }
    var lanes = [];
    var wide = Math.min(LANES, jobs.length);
    for (var q = 0; q < wide; q++) lanes.push(lane());
    await Promise.all(lanes);
    // Exact can still refuse a request when one division was very busy. Whatever
    // was refused is asked again on its own, calmly, so a whole run is never lost.
    for (var round = 0; round < 2 && misses.length; round++) {
      var again = misses.slice();
      misses = [];
      S.errors = [];
      for (var z = 0; z < again.length; z++) {
        setStatus('Asking Exact again for ' + (z + 1) + ' of ' + again.length + ' that were refused');
        var mz = again[z][0], yz = again[z][1], cz = again[z][2];
        absorb(mz, yz, cz, (S.view === 'summary') ? await fetchSum(mz[2], yz, 1, cz) : await fetchOne(mz[2], yz, 1, cz));
        tick();
      }
    }
    S.busy = false;
    setStatus('');
    draw();
  }

  function setStatus(t) {
    var a = el('asof');
    if (!a) return;
    var en = entOf(S.entity); if (!t && !en) { a.textContent = 'Choose an entity, financial year and G/L account, then press Apply'; return; } a.textContent = t || ((en ? en[1] + ' - ' + en[3] : 'Entity') + '  \u00b7  G/L ' + S.code + '  \u00b7  ' + (S.year === 'all' ? 'financial years 2024 - 2026' : 'financial year ' + S.year) + '  \u00b7  updated ' + new Date().toLocaleTimeString('de-DE'));
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

  function draw() { if (S.view === 'summary') { drawSummary(); return; }
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
        kpi('NET (DEBIT - CREDIT)', eur(bal), 'debit minus credit of the lines shown', 'var(--blue)', DASH_NOTE)
      ].join('');
    }
    var sw = el('sumWrap'); if (sw) sw.innerHTML = nsSummary(rows); var w = el('wrap');
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

  var DASH_NOTE = 'This dashboard reads the data live from Exact Online and only groups and totals it. Nothing is recalculated or restated - every figure ties back one to one to the transaction lines in Exact.';

  var NO_CC_LABEL = 'Cost centre missing in Exact';
  var NO_GL_LABEL = 'No counter line in Exact';

  var NO_CC_INFO = 'These lines carry no cost centre on the accrual account in Exact, so they cannot be placed under a cost centre here. The dashboard only reads and groups, it never invents a cost centre. This has to be corrected in Exact: open the journal entry (Financial, Entries, the accrual journal), put the cost centre on the line of the accrual account and save. On the next refresh the amount moves to the right cost centre by itself.';

  var NO_GL_INFO = 'For these accrual lines Exact holds no usable counter line in the same journal entry, so there is no expense account to show. The amount is still counted in the cost centre and in every total. This has to be corrected in Exact: open the journal entry and post the counter side on the expense account, or take the accrual out of the one large journal into its own entry.';

  function nsInfoInit() {
    if (document.getElementById('nsInfoStyle')) return;
    var st = document.createElement('style');
    st.id = 'nsInfoStyle';
    st.textContent = '.nsinfo{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;border:1px solid currentColor;font-size:10px;font-weight:700;line-height:1;margin-left:8px;cursor:help;opacity:.75;vertical-align:middle;font-family:inherit;flex:0 0 auto}.nsinfo:hover{opacity:1}#nsTipBox{position:fixed;display:none;width:320px;padding:10px 12px;border-radius:8px;background:#0f1420;color:#e6edf7;border:1px solid #2a3343;font-size:11px;font-weight:700;line-height:1.55;letter-spacing:0;text-align:left;white-space:normal;z-index:9999;box-shadow:0 12px 28px rgba(0,0,0,.55)}';
    document.head.appendChild(st);
    var box = document.createElement('div');
    box.id = 'nsTipBox';
    document.body.appendChild(box);
    function hit(e) { return e.target && e.target.closest ? e.target.closest('.nsinfo') : null; }
    document.addEventListener('mouseover', function (e) {
      var s = hit(e);
      if (!s) return;
      box.textContent = s.getAttribute('data-tip') || '';
      box.style.display = 'block';
      var r = s.getBoundingClientRect();
      var w = box.offsetWidth, hh = box.offsetHeight;
      var x = r.left + r.width / 2 - w / 2;
      if (x < 8) x = 8;
      if (x + w > window.innerWidth - 8) x = window.innerWidth - 8 - w;
      var y = r.bottom + 8;
      if (y + hh > window.innerHeight - 8) y = r.top - hh - 8;
      if (y < 8) y = 8;
      box.style.left = x + 'px';
      box.style.top = y + 'px';
    });
    document.addEventListener('mouseout', function (e) { if (hit(e)) box.style.display = 'none'; });
    window.addEventListener('scroll', function () { box.style.display = 'none'; }, true);
  }

  function infoIcon(text) {
    nsInfoInit();
    return '<span class="nsinfo" data-tip="' + esc(text) + '" aria-label="' + esc(text) + '">i</span>';
  }

  function rowInfo(lbl) {
    if (String(lbl).indexOf(NO_CC_LABEL) >= 0) return infoIcon(NO_CC_INFO);
    if (String(lbl).indexOf(NO_GL_LABEL) >= 0) return infoIcon(NO_GL_INFO);
    return '';
  }

  function kpi(t, v, s, color, info) {
    return '<div class="kpi"><div class="t">' + esc(t) + '</div><div class="v"' + (color ? ' style="color:' + color + '"' : '') + '>' + v + (info ? infoIcon(info) : '') + '</div><div class="s">' + esc(s || '') + '</div></div>';
  }


  function note() {
    var n = el('note');
    if (!n) return;
    var t = (S.view === 'summary') ? 'Summary: every row is a cost centre, open it to see the G/L accounts inside. How the numbers are built: (1) all lines of the selected accrual account for the chosen financial years are read live from Exact Online; (2) the line on the accrual account is the anchor, so cost centre, period and amount are exactly what stands in Exact; (3) the name of the expense account comes from the other lines of the same journal entry, matched first on cost centre plus period, then on cost centre, then on period, and only after that spread pro rata; (4) the pieces are added up again per entry, cost centre, period and account, so the amounts never change; (5) every journal entry is read to its last page, and if the Exact paging is cut off it is reported as an error instead of dropping lines in silence. Nothing is recalculated. The Grand Total is the movement of the periods shown, so it equals the balance of the G/L account in Exact only after the opening balance of the years before the first year shown is added. Columns are financial periods, amounts are debit minus credit, and the search box filters by cost centre or G/L account. A row marked as no counter line or as cost centre missing has to be corrected in Exact, not here - hover the i for what to change.' : 'Click any row to open the full journal entry: G/L account, description, debit, credit and the entry total (balance check). Click a column header to sort, and use the search box to filter.';
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
    if (S.view === 'summary') { var pv = nsPivot(nsSumFiltered()); Object.keys(pv.tree).forEach(function (k) { S.sumOpen[k] = 1; }); draw(); return; } var rows = filtered().slice(0, 15);
    for (var i = 0; i < rows.length; i++) {
      var l = rows[i];
      var key = keyOf(l);
      S.open[key] = 1;
      draw();
      if (!S.det[key]) await loadDetail(key, l.division, l.entryNumber, l.year);
    }
  }

  shell();
  loadAccounts();
  conn();
  setStatus('');
  run();
  setInterval(conn, 300000);
})();
