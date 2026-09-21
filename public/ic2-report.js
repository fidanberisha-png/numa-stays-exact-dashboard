// InterCompany Version 2 - GL account balance by period (Photo 1 layout).
// Additive layer: Opening balance + one column per period (period movement)
// + Closing balance, per G/L account, grouped by receivable category.
// Re-uses /api/gl-balance and the same entity list. Touches no existing code.
(function(){
  if(window.__numaIC2Report){return;}
  window.__numaIC2Report=1;
  var NFR=window.fetch;
  function napr(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function money2(v,bold){
    if(v===undefined||v===null){return '<td class="num" style="color:#b8b0b2">-</td>';}
    var n=Number(v)||0;
    if(Math.abs(n)<0.005){return '<td class="num" style="color:#b8b0b2">-</td>';}
    var color=n<0?'#e2611a':'#12a150';
    var fw=bold?'font-weight:700;':'';
    return '<td class="num" style="color:'+color+';'+fw+'">'+fmt(n)+'</td>';
  }
  var REPENT=[
    ['HQ',1000,3784237,'Numa Group SE'],
    ['DACH',900,3745758,'Numa Deutschland GmbH'],
    ['DACH',901,3745759,'COSI Hamburg Sud GmbH'],
    ['DACH',902,3745760,'COSI Koln Nord GmbH'],
    ['DACH',801,3745740,'Numa Osterreich GmbH'],
    ['DACH',500,3751399,'Numa Prague s.r.o.'],
    ['DACH',302,3708480,'Numa Schweiz GmbH'],
    ['WEST',99,3642741,'Numa Netherlands B.V.'],
    ['WEST',104,2657065,'Numa Nederland Operations B.V.'],
    ['WEST',400,3383979,'YAYS Frankrijklei B.V.'],
    ['WEST',401,3693157,'Numa Belgium North SRL'],
    ['WEST',300,3706020,'Numa Norge AS'],
    ['WEST',301,3716405,'numa Danmark ApS'],
    ['WEST',203,3741441,'NUMA France S.A.S.'],
    ['WEST',600,3717706,'numa stays UK Ltd'],
    ['WEST',610,3900740,'Native Places Limited'],
    ['SOUTH',700,3725452,'Numa Stays Espana S.L.'],
    ['SOUTH',710,3732987,'NUMA PORTUGAL, UNIPESSOAL, LDA.'],
    ['SOUTH',720,3745729,'Numa Italia S.r.l.'],
    ['SOUTH',711,4166557,'numa Lisbon South, unipessoal Lda']
    ];
  function repVals(){
    function v(id,d){var e=document.getElementById(id);var n=e?parseInt(e.value,10):NaN;return isNaN(n)?d:n;}
    var nowY=new Date().getFullYear();
    return {yFrom:v('ic2YearFrom',nowY),yTo:v('ic2YearTo',nowY),pFrom:v('ic2PerFrom',1),pTo:v('ic2PerTo',12)};
  }
  function repEntities(){
    var sel=document.getElementById('ic2RepEnt');
    var val=sel?sel.value:'consolidated';
    if(val&&val!=='consolidated'){
      var one=REPENT.filter(function(m){return String(m[2])===String(val);});
      return one.length?one:REPENT;
    }
    return REPENT;
  }
  function glFetch(div,yFrom,yTo,pFrom,pTo){
var url='/api/gl-balance?division='+div+'&balanceType=B&codeFrom=140000&codeTo=149999&yearTo='+yTo;if(yFrom!==undefined&&yFrom!==null){url+='&yearFrom='+yFrom;}    if(pFrom!==undefined&&pFrom!==null){url+='&periodFrom='+pFrom+'&periodTo='+pTo;}
    return NFR.call(window,url,{credentials:'same-origin'}).then(function(r){
      return r.json().then(function(j){
        if(!r.ok||(j&&j.error)){return {error:(j&&j.error)||('HTTP '+r.status),accounts:[]};}
        return {accounts:(j&&j.accounts)||[]};
      });
    }).catch(function(e){return {error:String(e),accounts:[]};});
  }
  function glFetchRetry(div,yFrom,yTo,pFrom,pTo){
    return glFetch(div,yFrom,yTo,pFrom,pTo).then(function(r){
      if(!r.error){return r;}
      return napr(1200).then(function(){return glFetch(div,yFrom,yTo,pFrom,pTo);}).then(function(r2){
        if(!r2.error){return r2;}
        return napr(1200).then(function(){return glFetch(div,yFrom,yTo,pFrom,pTo);});
      });
    });
  }
  function periodList(q){
    var list=[];
    for(var y=q.yFrom;y<=q.yTo;y++){
      var a=(y===q.yFrom)?q.pFrom:1;
      var b=(y===q.yTo)?q.pTo:12;
      for(var p=a;p<=b;p++){list.push({y:y,p:p,label:y+'-'+p});}
    }
    return list;
  }
  function runReport(){
    var btn=document.getElementById('ic2Run');
    var status=document.getElementById('ic2Status');
    if(btn){btn.disabled=true;}
    var q=repVals();
    var ents=repEntities();
    var pers=periodList(q);
    var openY=q.yFrom-1;
    var acc={};
    var errors=[];
    function ensure(code,desc){
      if(!acc[code]){
        acc[code]={code:code,desc:desc||'',opening:0,closing:0,per:{}};
        pers.forEach(function(pe){acc[code].per[pe.label]=0;});
      }
      if(desc&&!acc[code].desc){acc[code].desc=desc;}
      return acc[code];
    }
    var tasks=[];
    ents.forEach(function(m){
tasks.push(glFetchRetry(m[2],null,openY).then(function(r){        if(r.error){errors.push(m[1]+' opening: '+r.error);return;}
        (r.accounts||[]).forEach(function(a){
          var row=ensure(a.code,a.description);
          row.opening+=Number(a.amount)||0;
        });
      }));
      pers.forEach(function(pe){
        tasks.push(glFetchRetry(m[2],pe.y,pe.y,pe.p,pe.p).then(function(r){
          if(r.error){errors.push(m[1]+' '+pe.label+': '+r.error);return;}
          (r.accounts||[]).forEach(function(a){
            var row=ensure(a.code,a.description);
            row.per[pe.label]+=Number(a.amount)||0;
          });
        }));
      });
    });
    var total=tasks.length;var done=0;
    if(status){status.textContent='Reading live from Exact Online - 0 of '+total+' reads...';}
    tasks=tasks.map(function(t){
      return t.then(function(){
        done++;
        if(status&&done%5===0){status.textContent='Reading live from Exact Online - '+done+' of '+total+' reads...';}
      });
    });
    Promise.all(tasks).then(function(){
      Object.keys(acc).forEach(function(c){
        var row=acc[c];var sum=0;
        pers.forEach(function(pe){sum+=row.per[pe.label];});
        row.closing=row.opening+sum;
      });
      render(acc,pers,q,errors);
      if(status){
        var span='year '+q.yFrom+' P'+q.pFrom+' to '+q.yTo+' P'+q.pTo+' (opening = through end '+openY+')';
        status.textContent='Done - '+span+'.'+(errors.length?(' '+errors.length+' errors.'):'');
      }
      if(btn){btn.disabled=false;}
    });
  }
  function bucketOf(code){
    var n=parseInt(String(code||'').replace(/[^0-9]/g,''),10);
    if(isNaN(n)){return 'oth';}
    if(n>=147000){return 'loan';}
    if(n>=145000){return 'ico';}
    if(n>=144000){return 'ico';}
    if(n>=143000){return 'oth';}
if(n>=142200){return 'ico';}if(n>=142000){return 'grp';}    if(n>=141200){return 'ico';}
    if(n>=141100){return 'ext';}
    if(n>=141000){return 'ico';}
    return 'ext';
  }
  var GROUP_ORDER=[
    ['ext','Trade accounts receivable External'],
    ['grp','Trade accounts receivable Group'],
    ['ico','Intercompany receivable'],
    ['loan','Loans / shareholder'],
    ['oth','Other receivable']
    ];
  function render(acc,pers,q,errors){
    var out=document.getElementById('ic2Results');
    if(!out){return;}
    var codes=Object.keys(acc);
    var groups={};
    codes.forEach(function(c){
      var k=bucketOf(c);
      groups[k]=groups[k]||[];
      groups[k].push(acc[c]);
    });
    var colspan=2+pers.length+1;
    var h='<table><thead><tr>';
    h+='<th class="txt">G/L account</th>';
    h+='<th class="num" style="background:#eef2fb;font-weight:700;">Opening balance</th>';
    pers.forEach(function(pe){h+='<th class="num">'+esc(pe.label)+'</th>';});
    h+='<th class="num" style="background:#dbe6ff;font-weight:700;">Closing balance</th>';
    h+='</tr></thead><tbody>';
    var gOpen=0,gClose=0,gPer={};
    pers.forEach(function(pe){gPer[pe.label]=0;});
    GROUP_ORDER.forEach(function(go){
      var rows=groups[go[0]];
      if(!rows||!rows.length){return;}
      h+='<tr><td colspan="'+colspan+'" style="font-weight:700;background:#f4f6fb;">'+esc(go[1])+'</td></tr>';
      rows.sort(function(a,b){return String(a.code).localeCompare(String(b.code));});
      var sOpen=0,sClose=0,sPer={};
      pers.forEach(function(pe){sPer[pe.label]=0;});
      rows.forEach(function(row){
        h+='<tr><td>'+esc(row.code)+' - '+esc(row.desc)+'</td>';
        h+=money2(row.opening);
        pers.forEach(function(pe){
          h+=money2(row.per[pe.label]);
          sPer[pe.label]+=row.per[pe.label];
          gPer[pe.label]+=row.per[pe.label];
        });
        h+=money2(row.closing,true);
        h+='</tr>';
        sOpen+=row.opening;sClose+=row.closing;
      });
      h+='<tr style="border-top:1px solid #c7d5ef;"><td style="font-weight:700;">Total: '+esc(go[1])+'</td>';
      h+=money2(sOpen,true);
      pers.forEach(function(pe){h+=money2(sPer[pe.label],true);});
      h+=money2(sClose,true);
      h+='</tr>';
      gOpen+=sOpen;gClose+=sClose;
    });
    h+='<tr style="border-top:2px solid #1e40af;background:#eef2fb;"><td style="font-weight:700;">GRAND TOTAL</td>';
    h+=money2(gOpen,true);
    pers.forEach(function(pe){h+=money2(gPer[pe.label],true);});
    h+=money2(gClose,true);
    h+='</tr>';
    h+='</tbody></table>';
    if(errors&&errors.length){
      h+='<div class="note" style="margin-top:10px;color:#b45309;">Notes: '+esc(errors.slice(0,8).join(' | '))+(errors.length>8?(' (+'+(errors.length-8)+' more)'):'')+'</div>';
    }
    out.innerHTML=h;
  }
  function ensureEntPicker(){
    var wrap=document.getElementById('ic2Wrap');
    if(!wrap){return;}
    if(document.getElementById('ic2RepEnt')){return;}
    var bar=wrap.querySelector('div');
    if(!bar){return;}
    var box=document.createElement('div');
    box.className='ctl';
    var opts='<option value="consolidated">Consolidated (all '+REPENT.length+' entities)</option>';
    REPENT.forEach(function(m){opts+='<option value="'+m[2]+'">'+esc(m[1]+' - '+m[3])+'</option>';});
    box.innerHTML='<label>ENTITY</label><select id="ic2RepEnt" style="background:#fff;border:1px solid #c7d5ef;border-radius:8px;padding:9px 10px;font-size:13px;">'+opts+'</select>';
    var runBtn=document.getElementById('ic2Run');
    if(runBtn&&runBtn.parentNode===bar){bar.insertBefore(box,runBtn);}else{bar.appendChild(box);}
  }
  function hook(){
    ensureEntPicker();
    var btn=document.getElementById('ic2Run');
    if(!btn){return;}
// always re-assert so this enhanced report wins over the base IC2 Run handler    btn.__ic2RepHooked=1;
    btn.onclick=function(){runReport();};
  }
  setInterval(hook,400);
})();
