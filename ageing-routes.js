// Ageing analysis: A/P and A/R - live data from Exact Online, normalized to EUR
// Used by the Numa Stays dashboard (public/dashboard.html)
// Supports: single division (?division=CODE) and consolidated (?division=consolidated)
// All monetary values are converted to EUR using live ECB rates (frankfurter.dev).
const express = require('express');
const axios = require('axios');
const REGION = process.env.EXACT_REGION || 'nl';
const BASE = 'https://start.exactonline.' + REGION + '/api/v1';
const AP_SOURCES = ['read/financial/PayablesList', 'read/financial/AgingPayablesList'];
// The A/P report is cut in the same ranges as Exact shows them, the A/R report
// keeps the four ranges it had. Only these two payable accounts are wanted.
const AP_EDGES = [31, 61, 92, 180, 364, 730];
const AR_EDGES = [30, 60, 90];
// AP accounts are matched by their DESCRIPTION, not by GL number, because
  // different entities use different numbers for the same-named account.
  const AP_DESCRIPTIONS = ['Trade accounts payable External', 'Accrued Expenses - AP'];
const AR_SOURCES = ['read/financial/AgingReceivablesList', 'read/financial/ReceivablesList'];

// ---- Live EUR currency conversion -------------------------------------------
// Rates are "how many units of X per 1 EUR". amount_in_eur = amount_in_x / rate[x].
let ratesCache = null;
let ratesPromise = null;
const RATE_TTL_MS = 6 * 60 * 60 * 1000;
async function getEurRates() {
  const fresh = ratesCache && (Date.now() - ratesCache.fetchedAt) < RATE_TTL_MS;
  if (fresh) return ratesCache.rates;
  if (ratesPromise) return ratesPromise;
  ratesPromise = (async function () {
    try {
      const r = await axios.get('https://api.frankfurter.dev/v1/latest', { params: { base: 'EUR' }, timeout: 12000 });
      const rates = (r.data && r.data.rates) ? r.data.rates : {};
      rates.EUR = 1;
      ratesCache = { rates: rates, fetchedAt: Date.now() };
      return rates;
    } catch (e) {
      if (ratesCache) return ratesCache.rates;
      const fallback = { EUR: 1, CZK: 25.3, GBP: 0.85, DKK: 7.46, NOK: 11.5, CHF: 0.95, USD: 1.09, SEK: 11.3 };
      ratesCache = { rates: fallback, fetchedAt: Date.now(), fallback: true };
      return fallback;
    } finally {
      ratesPromise = null;
    }
  })();
  return ratesPromise;
}
function toEur(amount, currency, rates) {
  const a = Number(amount) || 0;
  if (!currency || currency === 'EUR') return a;
  const rate = rates[currency];
  if (!rate || !isFinite(rate) || rate <= 0) return a;
  return a / rate;
}

module.exports = function (getToken) {
  const router = express.Router();
  let currentDivisionCache = null;
  let divisionsCache = null;
  function headers() {
    const t = getToken();
    if (!t) return null;
    return { Authorization: 'Bearer ' + t.access_token, Accept: 'application/json' };
  }
  async function getCurrentDivision(h) {
    if (currentDivisionCache) return currentDivisionCache;
    const r = await getEx(BASE + '/current/Me?$select=CurrentDivision', h);
    currentDivisionCache = r.data.d.results[0].CurrentDivision;
    return currentDivisionCache;
  }
  async function getAllDivisions(h) {
    if (divisionsCache) return divisionsCache;
    const cur = await getCurrentDivision(h);
    // Do NOT $select (the Division OData model varies, e.g. no HID); fetch all fields and pick safely.
    const url = BASE + '/' + cur + '/system/Divisions?$orderby=Code';
    const r = await getEx(url, h);
    const d = r.data && r.data.d ? r.data.d : r.data;
    const rows = (d && d.results) ? d.results : (Array.isArray(d) ? d : []);
    divisionsCache = rows.map(function (x) {
      const human = (x.HID !== undefined && x.HID !== null) ? x.HID : (x.DivisionCode !== undefined && x.DivisionCode !== null ? x.DivisionCode : null);
      const name = x.Description || x.CustomerName || ('Division ' + x.Code);
      const prefix = human !== null && human !== '' ? (human + ' - ') : '';
      const currency = x.Currency || x.CurrencyCode || null;
      return { code: x.Code, human: human, name: name, label: prefix + name, currency: currency };
    });
    return divisionsCache;
  }
  async function divisionCurrency(division, h) {
    try {
      const all = await getAllDivisions(h);
      const found = all.filter(function (d) { return String(d.code) === String(division); })[0];
      return (found && found.currency) ? found.currency : 'EUR';
    } catch (e) { return 'EUR'; }
  }
  // ---- Exact Online throttle, 429 retries and a short row cache -----------
  // Exact allows only about 60 calls per company per minute. A big entity like
  // 900 needs several pages, so a consolidated view can eat the whole minute
  // and the next entity gets '429 Too Many Requests'. Therefore the calls are
  // queued, a 429 is retried with a short backoff, every finished list is kept
  // for a few minutes and, if Exact still refuses, the rows already collected
  // (or the last known list) are used instead of showing an empty screen.
  const CALL_LOG = {};
  const MAX_PER_MIN = 58;
  const ROWS_TTL_MS = 10 * 60 * 1000;
  // A list that is older than the fresh window is still handed over at once and
  // renewed in the background, so a screen never waits for a full read twice.
  const STALE_MAX_MS = 24 * 60 * 60 * 1000;
  const rowsCache = {};
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // Exact counts the minute limit per division, so the queue is kept per division
  // as well. Nineteen entities are then read next to each other instead of
  // sharing one single budget of 58 calls a minute.
  function divOf(u) { const m = /\/api\/v1\/(\d+)\//.exec(String(u || '')); return m ? m[1] : 'x'; }
  async function slot(u) {
    const k = divOf(u);
    if (!CALL_LOG[k]) { CALL_LOG[k] = []; }
    const log = CALL_LOG[k];
    for (let i = 0; i < 20; i++) {
      const now = Date.now();
      while (log.length && (now - log[0]) > 60000) { log.shift(); }
      if (log.length < MAX_PER_MIN) { log.push(now); return; }
      await sleep(1000);
    }
    log.push(Date.now());
  }
  async function getEx(url, h) {
    let wait = 1200;
    let last = null;
    for (let i = 0; i < 4; i++) {
      await slot(url);
      try { return await axios.get(url, { headers: h, timeout: 45000 }); }
      catch (e) {
        last = e;
        const st = e.response ? e.response.status : 0;
        if (st !== 429 && st !== 502 && st !== 503) throw e;
        if (i === 3) throw e;
        const ra = Number(e.response && e.response.headers ? e.response.headers['retry-after'] : 0);
        let ms = ra > 0 ? ra * 1000 : wait;
        if (ms > 8000) { ms = 8000; }
        await sleep(ms);
        wait = wait * 2;
      }
    }
    throw last;
  }
  // A list is read page by page (Exact hands out only 60 rows per call) and a
  // big entity like 900 has thousands of open invoices, so the reading runs in
  // the background: the request waits a while, then reports how far it got and
  // the dashboard asks again. Finished lists stay in memory for a few minutes,
  // so every other view of the same entity is instant.
  const jobs = {};
  function startJob(key, division, path, h, maxPages) {
    const job = { at: Date.now(), pages: 0, rows: [], done: false, err: null };
    jobs[key] = job;
    (async function () {
      let url = BASE + '/' + division + '/' + path;
      try {
        while (url && job.pages < (maxPages || 200)) {
          const r = await getEx(url, h);
          const d = r.data && r.data.d ? r.data.d : r.data;
          const part = d && d.results ? d.results : (Array.isArray(d) ? d : []);
          job.rows = job.rows.concat(part);
          url = d && d.__next ? d.__next : null;
          job.pages = job.pages + 1;
        }
        rowsCache[key] = { at: Date.now(), rows: job.rows };
      } catch (e) {
        job.err = e;
        if (job.rows.length) { rowsCache[key] = { at: Date.now(), rows: job.rows }; }
      }
      job.done = true;
    })();
    return job;
  }
  async function fetchAll(division, path, h, maxPages, waitMs) {
    const key = division + '|' + path;
    const hit = rowsCache[key];
    if (hit && (Date.now() - hit.at) < ROWS_TTL_MS) { return hit.rows; }
    if (hit && (Date.now() - hit.at) < STALE_MAX_MS) {
      if (!jobs[key] || jobs[key].done) { startJob(key, division, path, h, maxPages); }
      return hit.rows;
    }
    const running = jobs[key] && !jobs[key].done ? jobs[key] : null;
    const job = running || startJob(key, division, path, h, maxPages);
    const until = Date.now() + (waitMs === undefined ? 40000 : waitMs);
    while (!job.done && Date.now() < until) { await sleep(400); }
    if (job.done) {
      if (job.rows.length) { return job.rows; }
      if (hit) { return hit.rows; }
      if (job.err) { throw job.err; }
      return job.rows;
    }
    if (hit) { return hit.rows; }
    const e = new Error('Still reading from Exact Online');
    e.loading = { pages: job.pages, rows: job.rows.length };
    throw e;
  }
  function toDate(v) {
    if (!v) return null;
    if (typeof v === 'string') {
      const m = /\/Date\((-?\d+)/.exec(v);
      if (m) return new Date(parseInt(m[1], 10));
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function iso(d) { return d ? d.toISOString().slice(0, 10) : null; }
  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
  function ageOf(row, referTo, refDate) {
    const base = referTo === 'duedate' ? toDate(row.DueDate) : (toDate(row.InvoiceDate) || toDate(row.Date) || toDate(row.DueDate));
    if (!base) return 0;
    return Math.floor((refDate.getTime() - base.getTime()) / 86400000);
  }
    // Every row falls in the bucket its age belongs to. The edges are given per
  // report, so A/P can be cut in the fine ranges of Exact while A/R keeps its own.
  function bucketOf(age, edges) {
    for (let i = 0; i < edges.length; i++) { if (age <= edges[i]) return i; }
    return edges.length;
  }
  function glText(row) {
    // Prefer the GL account DESCRIPTION so entities that use a different number
    // for the same-named account are still matched correctly.
    const descFields = ['GLAccountDescription', 'GLAccountCodeDescription', 'GLAccountName'];
    for (let i = 0; i < descFields.length; i++) {
      const v = row[descFields[i]];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  }
  function glCode(row) {
    const fields = ['GLAccountCode', 'GLAccount', 'GLAccountCodeAP', 'AccountsPayableGLAccountCode'];
    for (let i = 0; i < fields.length; i++) {
      const v = row[fields[i]];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  }
  function norm(s) { return String(s || '').trim().toLowerCase(); }
  // Only the payable accounts that are really wanted are counted, matched by the
  // account DESCRIPTION (not the number). When Exact does not put the account on
  // the row nothing is thrown away.
  function glWanted(row, allow) {
    if (!allow || !allow.length) return true;
    const desc = glText(row);
    if (!desc) return true;
    const d = norm(desc);
    for (let i = 0; i < allow.length; i++) { if (d === norm(allow[i])) return true; }
    return false;
  }
  function accumulate(map, rows, referTo, refDate, currency, rates, edges, allow, stats, division) {
    const nb = edges.length + 1;
    rows.forEach(function (row) {
      if (!glWanted(row, allow)) { if (stats) stats.skipped = stats.skipped + 1; return; }
      const code = (row.AccountCode === undefined || row.AccountCode === null ? '' : String(row.AccountCode)).trim();
      const baseKey = code || String(row.AccountId || 'unknown');
      const key = (division !== undefined && division !== null && String(division) !== '') ? (String(division) + '|' + baseKey) : baseKey;
      if (!map[key]) {
        map[key] = { code: code, entity: (division !== undefined && division !== null) ? String(division) : '', name: row.AccountName || '', total: 0, weighted: 0, absTotal: 0, count: 0, items: [] };
        for (let b = 1; b <= nb; b++) { map[key]['b' + b] = 0; }
      }
      const acc = map[key];
      if (!acc.name && row.AccountName) acc.name = row.AccountName;
      const preBucketed = row.AgeGroup1Amount !== undefined || row.Amount1 !== undefined;
      if (preBucketed) {
        const v1 = toEur(num(row.AgeGroup1Amount !== undefined ? row.AgeGroup1Amount : row.Amount1), currency, rates);
        const v2 = toEur(num(row.AgeGroup2Amount !== undefined ? row.AgeGroup2Amount : row.Amount2), currency, rates);
        const v3 = toEur(num(row.AgeGroup3Amount !== undefined ? row.AgeGroup3Amount : row.Amount3), currency, rates);
        const v4 = toEur(num(row.AgeGroup4Amount !== undefined ? row.AgeGroup4Amount : row.Amount4), currency, rates);
        acc.b1 = acc.b1 + v1; acc.b2 = acc.b2 + v2; acc.b3 = acc.b3 + v3; acc.b4 = acc.b4 + v4;
        acc.total = acc.total + v1 + v2 + v3 + v4;
        acc.count = acc.count + 1;
        return;
      }
      const amount = toEur(num(row.Amount !== undefined ? row.Amount : row.AmountDC), currency, rates);
      if (!amount) return;
      const age = ageOf(row, referTo, refDate);
      const b = 'b' + (bucketOf(age, edges) + 1);
      acc[b] = acc[b] + amount;
      acc.total = acc.total + amount;
      acc.weighted = acc.weighted + age * Math.abs(amount);
      acc.absTotal = acc.absTotal + Math.abs(amount);
      acc.count = acc.count + 1;
      // The single invoices behind the amount, so a row can be opened in the
      // dashboard. Only the first 200 of one account are carried along, so the
      // answer stays small.
      if (acc.items.length < 200) {
        acc.items.push({
          invoiceNumber: String(row.InvoiceNumber || row.YourRef || row.EntryNumber || ''),
          description: String(row.Description || ''),
          yourRef: String(row.YourRef || ''),
          invoiceDate: iso(toDate(row.InvoiceDate) || toDate(row.Date)),
          dueDate: iso(toDate(row.DueDate)),
          age: age,
          amount: Math.round(amount * 100) / 100
        });
      }
    });
  }
    function finalize(map, edges) {
    const nb = edges.length + 1;
    const list = [];
    const totals = { total: 0 };
    for (let b = 1; b <= nb; b++) { totals['b' + b] = 0; }
    Object.keys(map).forEach(function (k) {
      const a = map[k];
      a.avgDays = a.absTotal ? Math.round(a.weighted / a.absTotal) : 0;
      a.average = a.avgDays;
      let any = false;
      for (let b = 1; b <= nb; b++) { const v = Number(a['b' + b]) || 0; totals['b' + b] += v; if (v) any = true; }
      totals.total += a.total;
      if (any) list.push(a);
    });
    list.sort(function (x, y) { return String(x.code).localeCompare(String(y.code)); });
    return { accounts: list, totals: totals };
  }
  async function fetchRowsFor(division, sources, h, errors, waitMs) {
    let rows = null; let source = null; let loading = null;
    for (let i = 0; i < sources.length && !rows && !loading; i++) {
      try { rows = await fetchAll(division, sources[i], h, 200, waitMs); source = sources[i]; }
      catch (e) {
        if (e && e.loading) { loading = e.loading; rows = null; break; }
        errors[division + ':' + sources[i]] = e.response && e.response.data ? e.response.data : e.message; rows = null;
      }
    }
    return { rows: rows, source: source, loading: loading };
  }
  router.get('/api/divisions', async function (req, res) {
    const h = headers();
    if (!h) return res.status(401).json({ error: 'Not authenticated' });
    try {
      const divisions = await getAllDivisions(h);
      const current = await getCurrentDivision(h);
      res.json({ current: current, divisions: divisions });
    } catch (e) {
      res.status(500).json({ error: 'Divisions failed', details: e.response && e.response.data ? e.response.data : e.message });
    }
  });
    // The names of the ranges follow the edges, so the page can draw whatever
  // ranges the report is cut in.
  function bucketLabels(edges) {
    const out = [];
    for (let i = 0; i <= edges.length; i++) {
      let label;
      if (i === 0) { label = '0 - ' + edges[0]; }
      else if (i === edges.length) { label = '> ' + edges[edges.length - 1]; }
      else { label = (edges[i - 1] + 1) + ' - ' + edges[i]; }
      out.push({ key: 'b' + (i + 1), label: label });
    }
    return out;
  }
  async function handleAgeing(req, res, cfg) {
    const sources = cfg.sources;
    const edges = cfg.edges;
    const allow = cfg.gl || [];
    const h = headers();
    if (!h) return res.status(401).json({ error: 'Not authenticated' });
    const referTo = req.query.referTo === 'duedate' ? 'duedate' : 'date';
    const refDate = req.query.date ? new Date(req.query.date) : new Date();
    const wanted = req.query.division ? String(req.query.division) : null;
    const consolidated = wanted === 'consolidated' || wanted === 'all';
    const rates = await getEurRates();
    const buckets = bucketLabels(edges);
    const totals = { total: 0 };
    buckets.forEach(function (b) { totals[b.key] = 0; });
    const out = { referTo: referTo, referenceDate: iso(refDate), division: null, consolidated: consolidated, currency: 'EUR', source: null, buckets: buckets, glAccounts: allow, accounts: [], totals: totals, itemCount: 0, skippedRows: 0, ratesFrom: (ratesCache && ratesCache.fallback ? 'fallback' : 'frankfurter.dev'), errors: {}, lastUpdated: new Date().toISOString() };
    let targets = [];
    try {
      if (consolidated) { const all = await getAllDivisions(h); targets = all.map(function (d) { return d.code; }); }
      else if (wanted) { targets = [wanted]; }
      else { targets = [await getCurrentDivision(h)]; }
    } catch (e) {
      out.errors.division = e.response && e.response.data ? e.response.data : e.message;
      return res.status(500).json(out);
    }
    out.division = consolidated ? 'consolidated' : targets[0];
    const map = {}; let totalRows = 0; let gotAny = false;
    const stats = { skipped: 0 };
    // The whole answer gets about 40 seconds; whatever is not read by then keeps
    // reading in the background and the dashboard asks again a few seconds later.
    const budgetUntil = Date.now() + 40000;
    let waiting = null;
    for (let i = 0; i < targets.length; i++) {
      const cur = await divisionCurrency(targets[i], h);
      const left = Math.max(1500, budgetUntil - Date.now());
      const r = await fetchRowsFor(targets[i], sources, h, out.errors, left);
      if (r.loading) {
        if (!waiting) { waiting = { pages: 0, rows: 0, entities: 0 }; }
        waiting.pages += r.loading.pages; waiting.rows += r.loading.rows; waiting.entities += 1;
      }
      if (r.rows) { gotAny = true; if (!out.source) out.source = r.source; totalRows += r.rows.length; accumulate(map, r.rows, referTo, refDate, cur, rates, edges, allow, stats, targets[i]); }
    }
    if (waiting) { out.loading = waiting; }
    if (!gotAny) {
      if (waiting) { return res.status(202).json(out); }
      return res.status(502).json(out);
    }
    const done = finalize(map, edges);
    out.accounts = done.accounts; out.totals = done.totals; out.itemCount = totalRows; out.skippedRows = stats.skipped;
    res.json(out);
  }
  // Diagnostic: the raw rows of the list Exact keeps behind the ageing report,
  // so the fields Exact really delivers can be read instead of guessed.
  router.get('/api/ageing-raw', async function (req, res) {
  const h = headers();
  if (!h) return res.status(401).json({ error: 'Not authenticated' });
  const division = req.query.division ? String(req.query.division) : null;
  if (!division) return res.status(400).json({ error: 'division is required' });
  const which = String(req.query.which || 'ap');
  const one = String(req.query.source || '');
  const sources = one ? [one] : (which === 'ar' ? AR_SOURCES : AP_SOURCES);
  const limit = Math.max(1, Math.min(20, parseInt(String(req.query.limit || '3'), 10) || 3));
  const errors = {};
  for (let i = 0; i < sources.length; i++) {
  try {
  const rows = await fetchAll(division, sources[i], h, 1);
  const fields = rows.length ? Object.keys(rows[0]) : [];
  return res.json({ division: division, source: sources[i], count: rows.length, fields: fields, rows: rows.slice(0, limit) });
  } catch (e) {
  errors[sources[i]] = (e.response && e.response.data) ? String(JSON.stringify(e.response.data)).slice(0, 300) : e.message;
  }
  }
  return res.status(502).json({ error: 'no source worked', errors: errors });
  });
  router.get('/api/ageing-ap', function (req, res) { return handleAgeing(req, res, { sources: AP_SOURCES, edges: AP_EDGES, gl: AP_DESCRIPTIONS }); });
  router.get('/api/ageing-ar', function (req, res) { return handleAgeing(req, res, { sources: AR_SOURCES, edges: AR_EDGES, gl: [] }); });
  // ---- Keeping the numbers warm ------------------------------------------
  // Exact Online hands out sixty rows per call and only about sixty calls a
  // minute per company, so the very first read of a large entity can never be
  // quick. The server therefore reads every entity by itself, shortly after the
  // start and again every few minutes, and keeps the rows in memory. A dashboard
  // that is opened afterwards is answered from memory in well under a second and
  // the renewal never blocks the screen.
  const WARM_START_MS = 15000;
  const WARM_EVERY_MS = 10 * 60 * 1000;
  const WARM_LANES = 6;
  // Only the nineteen entities the dashboards actually show are kept warm. The
  // administration holds many more companies and reading them all would eat the
  // call budget of Exact Online for nothing.
  const WARM_CODES = [3784237, 3745758, 3745759, 3745760, 3745740, 3751399, 3708480, 3642741, 2657065, 3383979, 3693157, 3706020, 3716405, 3741441, 3717706, 3900740, 3725452, 3732987, 3745729];
  let warmRunning = false;
  let warmInfo = { at: null, done: 0, total: 0, ms: 0 };
  async function warmAll() {
    if (warmRunning) return;
    const h = headers();
    if (!h) return;
    warmRunning = true;
    const started = Date.now();
    try {
      const all = await getAllDivisions(h);
      let wanted = all.filter(function (d) { return WARM_CODES.indexOf(Number(d.code)) > -1; });
      if (!wanted.length) { wanted = all; }
      const list = [];
      wanted.forEach(function (d) {
        list.push({ division: d.code, path: AP_SOURCES[0] });
        list.push({ division: d.code, path: AR_SOURCES[0] });
      });
      warmInfo = { at: started, done: 0, total: list.length, ms: 0 };
      let next = 0;
      async function warmLane() {
        while (next < list.length) {
          const t = list[next];
          next = next + 1;
          try { await fetchAll(t.division, t.path, h, 200, 240000); }
          catch (e) { /* the next round tries again */ }
          warmInfo.done = warmInfo.done + 1;
        }
      }
      const lanes = [];
      for (let i = 0; i < WARM_LANES; i++) { lanes.push(warmLane()); }
      await Promise.all(lanes);
      warmInfo.ms = Date.now() - started;
    } catch (e) { /* the next round tries again */ }
    warmRunning = false;
  }
  setTimeout(function () { warmAll(); }, WARM_START_MS);
  setInterval(function () { warmAll(); }, WARM_EVERY_MS);
  router.get('/api/warm', function (req, res) {
    res.json({ running: warmRunning, info: warmInfo, cached: Object.keys(rowsCache).length });
  });
  return router;
};
