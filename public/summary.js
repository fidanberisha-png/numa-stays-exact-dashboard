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
  function el(id){ return document.getElementById(id); }
  function esc(v){ if(v==null) return ''; return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function eur(n){ return (Number(n)||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' \u20ac'; }

  var SUM = { busy:false, rows:null, progress:0 };
  var SUM_YEARS = [2024,2025,2026,2027];
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function sumMonthIndex(y,m){ return y*12+(m-1); }
  function parseDMY(s){
    if(!s) return null;
    var p = String(s).split('-');
    if(p.length<3) return null;
    var d=parseInt(p[0],10), mo=parseInt(p[1],10), y=parseInt(p[2],10);
    if(!y||!mo) return null;
    return { y:y, m:mo, d:d||1 };
  }

  async function skin(){
    try{
      var r = await fetch('/accrued.html', { credentials:'same-origin' });
      var t = await r.text();
      var a = t.indexOf('<style');
      var b = t.indexOf('</style>');
      if(a>=0 && b>a) document.head.insertAdjacentHTML('beforeend', t.slice(a, b+8));
    }catch(e){}
    var extra='<style>'+
      '.sumwrap{overflow:auto;border:1px solid #c7d5ef;border-radius:10px;margin-top:12px}'+
      '.stab{border-collapse:collapse;font-size:12px;white-space:nowrap}'+
      '.stab th,.stab td{border:1px solid #e3e8f2;padding:4px 8px;text-align:left}'+
      '.stab th.sh{background:#eef2fb;color:#1a1a18;font-weight:700;text-align:center;position:sticky;top:0}'+
      '.stab th.yr{border-bottom:2px solid #1e3a8a}'+
      '.stab th.mo{font-weight:600;color:#6f6a6b}'+
      '.stab td.r{text-align:right}'+
      '.stab tr.ename td{background:#1e3a8a;color:#fff;font-weight:700}'+
      '.stab td.lbl{font-weight:600;color:#1a1a18;background:#f7f9fd;position:sticky;left:0}'+
      '.stab tr.nrow td{border-bottom:2px solid #c7d5ef;font-weight:600}'+
      '</style>';
    document.head.insertAdjacentHTML('beforeend', extra);
  }

  function shell(){
    var opts='<option value="">Choose an entity</option>';
    REGIONS.forEach(function(reg){
      opts+='<optgroup label="'+reg+'">';
      ENT.filter(function(m){ return m[0]===reg; }).forEach(function(m){
        opts+='<option value="'+m[1]+'">'+esc(m[1]+' - '+m[3])+'</option>';
      });
      opts+='</optgroup>';
    });
    document.body.innerHTML=[
      '<header>',
      '<div class="brand">Numa</div>',
      '<select class="company" id="company" title="Entity">'+opts+'</select>',
      '<select class="company" id="dashboard" title="Dashboards">',
      '<option value="prepaid">Dashboards: PrePaid</option>',
      '<option value="summary">Dashboards: Summary</option>',
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
      '<h1>Summary</h1>',
      '<div class="sub">Prepaid amortisation of account '+CODE+' for every entity - live data from Exact Online</div>',
      '<div class="wrap" id="wrap"><div class="state">Loading summary...</div></div>'
    ].join('');
    el('dashboard').value='summary';
    el('dashboard').onchange=function(){
      var v=this.value;
      if(v==='summary') return;
      if(v==='prepaid'){ window.location.href='/prepaid'; return; }
      if(v==='accrued'){ window.location.href='/accrued'; return; }
      window.location.href='/?dashboard='+v;
    };
    el('company').onchange=function(){};
    el('refresh').onclick=function(){ SUM.rows=null; loadSummary(); };
  }

  async function conn(){
    var p=el('conn');
    if(!p) return;
    try{
      var r=await fetch('/api/status',{credentials:'same-origin'});
      var j=await r.json();
      p.textContent=j.authenticated?'Connected to Exact Online':'Not connected';
      p.className='pill'+(j.authenticated?' ok':'');
    }catch(e){ p.textContent='Not connected'; p.className='pill'; }
  }

  async function loadSummary(){
    if(SUM.busy) return;
    SUM.busy=true; SUM.rows=[]; SUM.progress=0;
    drawSummary();
    async function fetchOne(dv){
      var url='/api/prepaid/schedule?division='+encodeURIComponent(dv)+
        '&code='+encodeURIComponent(CODE)+'&journal=all&mode=period&until=year';
      var r=await fetch(url,{credentials:'same-origin'});
      var j={}; try{ j=await r.json(); }catch(_){}
      return { ok:r.ok, j:j };
    }
    for(var i=0;i<ENT.length;i++){
      var e=ENT[i]; var dv=e[2];
      var entRow={ code:e[1], name:e[3], months:{}, total:0 };
      try{
        var res=await fetchOne(dv);
        if(!res.ok || !res.j || !res.j.rows){ res=await fetchOne(dv); }
        if(res.ok && res.j && res.j.rows){
          res.j.rows.forEach(function(row){
            var st=parseDMY(row.start), en=parseDMY(row.end);
            var monthly=Number(row.monthly)||0;
            if(!st||!en||!monthly) return;
            var a=sumMonthIndex(st.y,st.m), b=sumMonthIndex(en.y,en.m);
            for(var mi=a; mi<=b; mi++){
              var yy=Math.floor(mi/12), mm=(mi%12)+1;
              if(yy<2024||yy>2027) continue;
              var key=yy+'-'+mm;
              if(!entRow.months[key]) entRow.months[key]={debit:0,credit:0};
              entRow.months[key].debit+=monthly;
              entRow.months[key].credit+=monthly;
            }
            entRow.total+=Number(row.total)||0;
          });
        }
      }catch(err){}
      SUM.rows.push(entRow);
      SUM.progress=i+1;
      drawSummary();
    }
    SUM.busy=false;
    drawSummary();
  }

  function drawSummary(){
    var w=el('wrap');
    if(!w) return;
    if(!SUM.rows){ w.innerHTML='<div class="state">Loading summary...</div>'; return; }
    var banner='';
    if(SUM.busy){ banner='<div class="state" style="padding:12px 16px">Reading the prepaid amortisation out of Exact Online... '+(SUM.progress||0)+' of '+ENT.length+' entities loaded.</div>'; }
    if(SUM.busy && (!SUM.rows || !SUM.rows.length)){ w.innerHTML=banner; return; }

    var colHead1='<th class="sh" rowspan="2">Entity</th>';
    SUM_YEARS.forEach(function(y){ colHead1+='<th class="sh yr" colspan="12">'+y+'</th>'; });
    colHead1+='<th class="sh" rowspan="2">Total</th>';
    var colHead2='';
    SUM_YEARS.forEach(function(){ MONTHS.forEach(function(mn){ colHead2+='<th class="sh mo">'+mn+'</th>'; }); });
    var head='<thead><tr>'+colHead1+'</tr><tr>'+colHead2+'</tr></thead>';

    function fmt(n){ n=Number(n)||0; if(Math.round(n*100)===0) return ''; return eur(n); }
    var body='';
    SUM.rows.forEach(function(er){
      var totalAll=er.total, cumCredit=0;
      var debCells='', creCells='', netCells='';
      SUM_YEARS.forEach(function(y){
        for(var m=1;m<=12;m++){
          var key=y+'-'+m;
          var cell=er.months[key]||{debit:0,credit:0};
          cumCredit+=cell.credit;
          var net=totalAll-cumCredit;
          debCells+='<td class="r">'+fmt(cell.debit)+'</td>';
          creCells+='<td class="r">'+fmt(cell.credit)+'</td>';
          netCells+='<td class="r">'+fmt(net)+'</td>';
        }
      });
      var remaining=totalAll-cumCredit;
      body+='<tr class="ename"><td>'+esc(er.code+' - '+er.name)+'</td>'+
        (function(){var c='';for(var i=0;i<48;i++)c+='<td></td>';return c;})()+'<td></td></tr>';
      body+='<tr class="drow"><td class="lbl">Debit</td>'+debCells+'<td class="r"></td></tr>';
      body+='<tr class="crow"><td class="lbl">Credit</td>'+creCells+'<td class="r"></td></tr>';
      body+='<tr class="nrow"><td class="lbl">Net</td>'+netCells+'<td class="r"><b>'+eur(remaining)+'</b></td></tr>';
    });
    w.innerHTML=(banner||'')+'<div class="sumwrap"><table class="stab">'+head+'<tbody>'+body+'</tbody></table></div>';
  }

  async function boot(){
    await skin();
    shell();
    conn();
    setInterval(conn, 60000);
    loadSummary();
  }
  boot();
})();
