// =============================================================================
// The reading status of every Numa dashboard, right next to its footer line.
// A short line says how far the reading is, and the small (i) next to it opens
// the rest: which entities are already on the screen, which ones are still
// coming, why the first read of a large entity takes a moment, and the reminder
// that every figure is shown exactly as Exact Online reports it.
// =============================================================================
(function () {
  if (window.NUMA_INFO) { return; }

  var S = { loaded: [], pending: [], open: false };
  var wrap = null, line = null, btn = null, pop = null, sig = '';

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function names(a) { return (a && a.length) ? a.join(', ') : 'none yet'; }

  // The status belongs to the footer line of the report. Every dashboard writes
  // that line again after a read, so the (i) simply moves back to its place.
  function host() {
    var n = document.getElementById('note') || document.querySelector('.note');
    if (n) { return n; }
    n = document.getElementById('numaInfoLine');
    if (n) { return n; }
    var main = document.querySelector('main') || document.body;
    if (!main) { return null; }
    n = document.createElement('div');
    n.id = 'numaInfoLine';
    n.style.cssText = 'color:#6f6a6b;font-size:12px;padding:10px 24px 30px';
    main.appendChild(n);
    return n;
  }

  function build() {
    if (wrap) { return; }
    wrap = document.createElement('span');
    wrap.id = 'numaInfoWrap';
    wrap.style.cssText = 'position:relative;display:inline-block;margin-left:8px;vertical-align:middle;white-space:normal';
    line = document.createElement('span');
    line.id = 'numaInfoState';
    line.style.cssText = 'color:#1e3a8a;font-weight:600;font-size:12px';
    btn = document.createElement('span');
    btn.id = 'numaInfoBtn';
    btn.textContent = 'i';
    btn.title = 'How this dashboard is read';
    btn.style.cssText = 'display:inline-block;width:15px;height:15px;line-height:14px;text-align:center;margin-left:7px;border:1px solid #1e3a8a;border-radius:50%;color:#1e3a8a;font:italic 700 11px Georgia,serif;cursor:pointer;-webkit-user-select:none;user-select:none';
    pop = document.createElement('span');
    pop.id = 'numaInfoPop';
    pop.style.cssText = 'display:none;position:absolute;left:0;bottom:24px;z-index:9999;width:440px;max-width:78vw;padding:12px 14px;border:1px solid #c7d5ef;border-left:4px solid #1e3a8a;border-radius:8px;background:#ffffff;color:#3b4658;font-size:12.5px;font-weight:400;line-height:1.6;text-align:left;box-shadow:0 8px 24px rgba(26,26,24,.18)';
    btn.onclick = function (ev) { ev.stopPropagation(); S.open = !S.open; sig = ''; render(); };
    wrap.appendChild(line);
    wrap.appendChild(btn);
    wrap.appendChild(pop);
    document.addEventListener('click', function (ev) {
      if (!S.open) { return; }
      if (wrap && wrap.contains(ev.target)) { return; }
      S.open = false; sig = ''; render();
    });
  }

  function render() {
    build();
    var h = host();
    if (!h) { return; }
    var moved = false;
    if (wrap.parentNode !== h) { h.appendChild(wrap); moved = true; }
    var done = S.loaded.length, left = S.pending.length, all = done + left;
    var pct = all ? Math.round((done / all) * 100) : 0;
    var s = done + '|' + left + '|' + S.loaded.join(',') + '|' + S.pending.join(',') + '|' + (S.open ? 1 : 0);
    if (s === sig && !moved) { return; }
    sig = s;
    line.innerHTML = all
      ? (left
        ? ('\u00b7 reading live from Exact Online: ' + done + ' of ' + all + ' entities ready (' + pct + '%)')
        : ('\u00b7 all ' + all + ' entities are read'))
      : '';
    var t = '';
    if (all) {
      t += '<div style="font-weight:700;color:#1f3c88;margin-bottom:6px">' + (left
        ? ('Reading live data from Exact Online - ' + done + ' of ' + all + ' entities ready (' + pct + '%). Everything that is in is already counted in the figures above.')
        : ('All ' + all + ' entities are read - the figures above are complete.')) + '</div>';
      t += '<div style="margin-bottom:3px"><b>Already on screen:</b> ' + esc(names(S.loaded)) + '</div>';
      if (left) { t += '<div style="margin-bottom:3px"><b>Still being read:</b> ' + esc(names(S.pending)) + '</div>'; }
      t += '<div style="height:5px;border-radius:3px;background:#dfe5ee;margin:9px 0 11px"><div style="height:5px;border-radius:3px;background:#1f3c88;width:' + pct + '%"></div></div>';
    }
    t += '<div style="margin-bottom:5px"><b>Why a first read takes a moment:</b> Exact Online hands out only 60 rows per call and allows about 60 calls a minute per entity. A large entity such as 900 or 610 has thousands of open items.</div>';
    t += '<div style="color:#1f3c88"><b>All figures are live from Exact Online and are shown exactly as Exact reports them - nothing is recalculated or changed here.</b></div>';
    pop.innerHTML = t;
    pop.style.display = S.open ? 'block' : 'none';
  }

  window.NUMA_INFO = {
    // loaded and pending are lists of entity numbers, for example [900, 901].
    set: function (o) {
      o = o || {};
      if (o.loaded) { S.loaded = [].slice.call(o.loaded); }
      if (o.pending) { S.pending = [].slice.call(o.pending); }
      render();
    },
    render: render
  };

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', render); } else { render(); }
  setInterval(render, 1200);
})();
