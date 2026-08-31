// A red bar that says it plainly when Exact Online is not connected any more.
// Every Numa dashboard loads it, so an empty screen is never a riddle: it names
// the reason and gives the link that brings the connection back.
(function () {
  var BAR = 'numaConnBar';
  var TXT = 'The connection with Exact Online is gone, so the dashboards cannot read any data. ' +
    '<a href="/auth/login" style="color:#991b1b;text-decoration:underline">Press here to connect Exact Online again</a>.';
  function bar() {
    var b = document.getElementById(BAR);
    if (b) { return b; }
    b = document.createElement('div');
    b.id = BAR;
    b.style.cssText = 'background:#fef2f2;border-bottom:1px solid #fca5a5;color:#991b1b;padding:10px 24px;font-size:13px;font-weight:600';
    b.innerHTML = TXT;
    var host = document.querySelector('header');
    if (host && host.parentNode) { host.parentNode.insertBefore(b, host.nextSibling); return b; }
    if (document.body) { document.body.insertBefore(b, document.body.firstChild); return b; }
    return null;
  }
  function hide() {
    var b = document.getElementById(BAR);
    if (b && b.parentNode) { b.parentNode.removeChild(b); }
  }
  async function check() {
    try {
      var r = await fetch('/api/status', { credentials: 'same-origin', cache: 'no-store' });
      var j = await r.json();
      if (j && j.authenticated) { hide(); } else { bar(); }
    } catch (e) { }
  }
  function start() { check(); setInterval(check, 30000); }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start); }
  else { start(); }
})();
