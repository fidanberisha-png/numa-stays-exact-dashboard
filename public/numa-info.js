// ═════════════════════════════════════════════════════════════════════════════
// A short status block that every dashboard shows under its footer line.
// It says how far the reading is, which entities are already on the screen and
// which ones are still coming, why the first read of a large entity cannot be
// quick, and that the figures are shown exactly as Exact Online reports them.
// ═════════════════════════════════════════════════════════════════════════════
(function () {
  if (window.NUMA_INFO) { return; }

  var S = { loaded: [], pending: [] };

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The block belongs right under the footer line of the report. That line is
  // built by the dashboard itself, so as soon as it appears the block is moved
  // to its place.
  function box() {
    var b = document.getElementById('numaInfo');
    if (!b) {
      b = document.createElement('div');
      b.id = 'numaInfo';
      b.style.cssText = 'margin:14px 0 28px;padding:12px 14px;border:1px solid #e2e7ef;border-left:4px solid #1f3c88;border-radius:8px;background:#f6f8fc;color:#3b4658;font-size:12.5px;line-height:1.6';
    }
    var after = document.getElementById('note') || document.querySelector('.note');
    if (after && after.parentNode) {
      if (b.previousSibling !== after) { after.parentNode.insertBefore(b, after.nextSibling); }
    } else if (!b.parentNode) {
      var host = document.querySelector('main') || document.body;
      if (host) { host.appendChild(b); }
    }
    return b;
  }

  function names(a) { return (a && a.length) ? a.join(', ') : 'none yet'; }

  function render() {
    var b = box();
    if (!b) { return; }
    var done = S.loaded.length;
    var left = S.pending.length;
    var all = done + left;
    var pct = all ? Math.round((done / all) * 100) : 0;
    var h = '';
    if (all) {
      h += '<div style="font-weight:700;color:#1f3c88;margin-bottom:6px">';
      h += left
        ? ('Reading live data from Exact Online - ' + done + ' of ' + all + ' entities ready (' + pct + '%). Everything that is in is already counted in the figures above.')
        : ('All ' + all + ' entities are read - the figures above are complete.');
      h += '</div>';
      h += '<div style="margin-bottom:3px"><b>Already on screen:</b> ' + esc(names(S.loaded)) + '</div>';
      if (left) { h += '<div style="margin-bottom:3px"><b>Still being read:</b> ' + esc(names(S.pending)) + '</div>'; }
      h += '<div style="height:5px;border-radius:3px;background:#dfe5ee;margin:9px 0 11px"><div style="height:5px;border-radius:3px;background:#1f3c88;width:' + pct + '%"></div></div>';
    }
    h += '<div style="margin-bottom:5px"><b>Why a first read takes a moment:</b> Exact Online hands out only 60 rows per call and allows about 60 calls a minute per entity. A large entity such as 900 or 610 has thousands of open items, so its first read needs longer than a small one. Nothing waits for it: every entity appears on the screen the moment it arrives, and the server keeps all entities warm in the background, so the next opening is almost instant.</div>';
    h += '<div style="color:#1f3c88"><b>All figures are live from Exact Online and are shown exactly as Exact reports them - nothing is recalculated or changed here.</b> The dashboard only groups the amounts and shows them in EUR with the rate Exact supplies.</div>';
    b.innerHTML = h;
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
  setTimeout(render, 700);
  setTimeout(render, 2500);
})();
