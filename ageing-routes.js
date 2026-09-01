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
  // All the dashboards of this server share the one budget Exact Online counts
  // per division: about sixty calls a minute. The queue therefore lives on the
  // process instead of in this file, otherwise the ageing, accrued and prepaid
  // reports would each spend sixty calls of the very same minute and Exact
  // would refuse them all.
  const CALL_LOG = (global.__numaRate = global.__numaRate || {});
  const MAX_PER_MIN = 55;
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
  async function slot(u, soft) {
    const k = divOf(u);
    if (!CALL_LOG[k]) { CALL_LOG[k] = []; }
    const log = CALL_LOG[k];
    for (let i = 0; i < 20; i++) {
      const now = Date.now();
      while (log.length && (now - log[0]) > 60000) { log.shift(); }
      // Work that only fills the picture in, like looking up the payable G/L
      // account of an open item, may use no more than a third of the minute, so
      // a report on the screen is never left waiting behind it.
      const cap = soft ? Math.ceil(MAX_PER_MIN / 2) : MAX_PER_MIN;
      if (log.length < cap) { log.push(now); return; }
      await sleep(1000);
    }
    log.push(Date.now());
  }
  async function getEx(url, h, soft) {
    let wait = 1200;
    let last = null;
    for (let i = 0; i < 4; i++) {
      await slot(url, soft);
      // A long read is allowed to take minutes, and the access token of Exact
      // Online lives only ten. The header is therefore taken again for every
      // single call, and a refusal because of an expired token is retried.
      const hh = (typeof h === 'function') ? (h() || {}) : h;
      try { return await axios.get(url, { headers: hh, timeout: 45000 }); }
      catch (e) {
        last = e;
        const st = e.response ? e.response.status : 0;
        if (st !== 401 && st !== 429 && st !== 502 && st !== 503) throw e;
        if (i === 3) throw e;
        const ra = Number(e.response && e.response.headers ? e.response.headers['retry-after'] : 0);
        let ms = ra > 0 ? ra * 1000 : wait;
        if (st === 401) { ms = 1500; }
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
    const job = { at: Date.now(), pages: 0, rows: [], done: false, err: null, complete: false };
    jobs[key] = job;
    (async function () {
      let url = BASE + '/' + division + '/' + path;
      try {
        while (url && job.pages < (maxPages || 200)) {
          const r = await getEx(url, function () { return headers() || h; });
          const d = r.data && r.data.d ? r.data.d : r.data;
          const part = d && d.results ? d.results : (Array.isArray(d) ? d : []);
          job.rows = job.rows.concat(part);
          url = d && d.__next ? d.__next : null;
          job.pages = job.pages + 1;
        }
        // Only when the paging really reached the end is the list complete. If it
        // stopped at the page limit there is still more waiting at Exact Online.
        job.complete = !url;
        rowsCache[key] = { at: Date.now(), rows: job.rows, complete: job.complete };
      } catch (e) {
        job.err = e;
        // A list that was cut off is kept only as a stopgap, never as the truth.
        if (job.rows.length && !(rowsCache[key] && rowsCache[key].complete)) {
          rowsCache[key] = { at: Date.now(), rows: job.rows, complete: false };
        }
      }
      job.done = true;
    })();
    return job;
  }
  async function fetchAll(division, path, h, maxPages, waitMs) {
    const key = division + '|' + path;
    const hit = rowsCache[key];
    const good = hit && hit.complete;
    if (good && (Date.now() - hit.at) < ROWS_TTL_MS) { return hit.rows; }
    if (good && (Date.now() - hit.at) < STALE_MAX_MS) {
      if (!jobs[key] || jobs[key].done) { startJob(key, division, path, h, maxPages); }
      return hit.rows;
    }
    const running = jobs[key] && !jobs[key].done ? jobs[key] : null;
    const job = running || startJob(key, division, path, h, maxPages);
    const until = Date.now() + (waitMs === undefined ? 40000 : waitMs);
    while (!job.done && Date.now() < until) { await sleep(400); }
    if (job.done && job.complete) { return job.rows; }
    let part = job.rows;
    if (hit && hit.rows.length > part.length) { part = hit.rows; }
    // The reading goes on in the background; a new attempt is started at most
    // once every half minute so Exact Online is not hammered.
    if (job.done && (Date.now() - job.at) > 30000) { startJob(key, division, path, h, maxPages); }
    if (!part.length) {
      const e = new Error('Still reading from Exact Online');
      e.loading = { pages: job.pages, rows: 0 };
      throw e;
    }
    const out = part.slice();
    out.incomplete = { pages: job.pages, rows: part.length };
    return out;
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
  function accumulate(map, rows, referTo, refDate, currency, rates, edges, allow, stats, division, gi, glStats) {
    const nb = edges.length + 1;
    const cutoff = refDate ? (refDate.getTime() + 86399999) : 0;
    rows.forEach(function (row) {
    // Exact Online shows the picture as it stood on the reference date, so an
    // item booked after that date is not part of it. Such an item used to fall
    // into the first bucket and made the report differ from the ageing
    // analysis of Exact Online.
    if (cutoff) {
      const d0 = toDate(row.InvoiceDate) || toDate(row.Date) || toDate(row.DueDate);
      if (d0 && d0.getTime() > cutoff) { if (stats) { stats.future = (stats.future || 0) + 1; } return; }
    }
    let ga = null;
    if (gi) {
      ga = glOfRow(row, gi);
      const gdesc = ga && ga.description ? ga.description : 'Not linked to a payable G/L account';
      const gcode = ga && ga.code ? ga.code : '';
      if (glStats) {
        const gk = norm(gdesc);
        if (!glStats[gk]) { glStats[gk] = { description: gdesc, codes: [], count: 0 }; }
        if (gcode && glStats[gk].codes.indexOf(gcode) < 0) { glStats[gk].codes.push(gcode); }
        glStats[gk].count = glStats[gk].count + 1;
      }
      if (allow && allow.length) {
        let okg = false;
        for (let z = 0; z < allow.length; z++) { if (norm(allow[z]) === norm(gdesc)) { okg = true; break; } }
        if (!okg) { if (stats) { stats.skipped = stats.skipped + 1; } return; }
      }
    } else if (!glWanted(row, allow)) { if (stats) { stats.skipped = stats.skipped + 1; } return; }
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
      try { rows = await fetchAll(division, sources[i], h, 600, waitMs); source = sources[i]; if (rows && rows.incomplete) { loading = rows.incomplete; } }
      catch (e) {
        if (e && e.loading) { loading = e.loading; rows = null; break; }
        errors[division + ':' + sources[i]] = e.response && e.response.data ? e.response.data : e.message; rows = null;
      }
    }
    return { rows: rows, source: source, loading: loading };
  }
  // ---- The payable G/L accounts of an entity ------------------------------
  // Exact Online does not put the G/L account on the open item itself. What it
  // does give is the journal of the item, and every purchase journal is linked
  // to exactly one payable G/L account. That link is used here, so an item is
  // counted under the same payable account Exact books it on. An item that
  // comes from a journal without such a link (a bank or a general journal)
  // falls back to the payable account of the purchase journals that are used
  // the most, which is the default creditor account of the entity.
  const AP_GL_TYPE = 22;
  const GL_TTL_MS = 24 * 60 * 60 * 1000;
  const glInfoCache = {};
  async function apGlInfo(division, h) {
    const hit = glInfoCache[division];
    if (hit && (Date.now() - hit.at) < GL_TTL_MS) { return hit; }
    const info = { at: Date.now(), accounts: [], byJournal: {}, fallback: null, byEntry: {}, entryTried: {}, resolving: 0, wanted: {}, byPair: {}, stat: { tried: 0, found: 0, fail: 0, noEntry: 0, calls: 0 } };
    try {
      const accs = await fetchAll(division, 'financial/GLAccounts?$select=Code,Description,Type&$filter=Type eq ' + AP_GL_TYPE, h, 10, 25000);
      accs.forEach(function (a) {
        const code = String(a.Code === undefined || a.Code === null ? '' : a.Code).trim();
        const desc = String(a.Description || '').trim();
        if (code || desc) { info.accounts.push({ code: code, description: desc || ('G/L ' + code) }); }
      });
    } catch (e) { /* the picker simply stays empty for this entity */ }
    // Two payable accounts carry the figures of this report; every other
    // payable account of Exact stays a name in the picker and no open item is
    // ever read or counted for it.
    info.accounts.forEach(function (a) {
      let ok = false;
      for (let i = 0; i < AP_DESCRIPTIONS.length; i++) { if (norm(a.description) === norm(AP_DESCRIPTIONS[i])) { ok = true; break; } }
      a.nameOnly = !ok;
      if (ok && a.code) { info.wanted[String(a.code)] = a.description; }
    });
    try {
      const js = await fetchAll(division, 'financial/Journals?$select=Code,Description,GLAccountCode,GLAccountDescription&$filter=Type eq ' + AP_GL_TYPE, h, 10, 25000);
      const used = {};
      js.forEach(function (j) {
        const jc = String(j.Code === undefined || j.Code === null ? '' : j.Code).trim();
        const gc = String(j.GLAccountCode === undefined || j.GLAccountCode === null ? '' : j.GLAccountCode).trim();
        const gd = String(j.GLAccountDescription || '').trim();
        if (!jc || (!gc && !gd)) { return; }
        info.byJournal[jc] = { code: gc, description: gd || ('G/L ' + gc) };
        used[gc] = (used[gc] || 0) + 1;
      });
      let best = null;
      Object.keys(used).forEach(function (c) { if (!best || used[c] > used[best]) { best = c; } });
      if (best !== null) {
        Object.keys(info.byJournal).forEach(function (jc) { if (!info.fallback && info.byJournal[jc].code === best) { info.fallback = info.byJournal[jc]; } });
      }
    } catch (e) { /* without journals every item lands on the fallback */ }
    glInfoCache[division] = info;
    return info;
  }
  function glOfRow(row, info) {
    if (!info) { return null; }
    // The journal entry itself is the truth, so it comes first.
    const en = String(row.EntryNumber === undefined || row.EntryNumber === null ? '' : row.EntryNumber).trim();
    const ac = String(row.AccountCode === undefined || row.AccountCode === null ? '' : row.AccountCode).trim();
    // One entry can hold the invoices of several suppliers on several payable
    // accounts, so the line of this very supplier is looked at first.
    if (en && ac && info.byPair[en + '|' + ac]) { return info.byPair[en + '|' + ac]; }
    if (en && info.byEntry[en]) { return info.byEntry[en]; }
    const jc = String(row.JournalCode === undefined || row.JournalCode === null ? '' : row.JournalCode).trim();
    // The account of the journal is a provisional answer, used only while the
    // journal entry itself has not been read yet. The entry is the truth.
    if (jc && info.byJournal[jc] && !(en && info.entryTried[en])) { return info.byJournal[jc]; }
    const desc = glText(row);
    if (desc) { return { code: glCode(row) || '', description: desc }; }
    // No silent fallback any more. An item booked through a bank or a general
    // journal used to be counted on the busiest purchase account, which tore
    // invoices and their payments apart: picking one G/L account then showed the
    // payments without their invoices and the report went negative. Such an item
    // is shown as not linked until the lookup below has found its real account.
    return null;
  }
  // ---- The real payable G/L account of an open item ----------------------
  // The open item list of Exact carries no G/L account, only the journal and the
  // entry number. For an item that did not come from a purchase journal the
  // journal entry is read and the line that sits on a payable account of this
  // entity is taken, which is the account Exact really books the item on.
  const ENTRY_CHUNK = 50;
  const ENTRY_MAX = 30000;
  const RESOLVE_LANES = 3;
  const entryRunning = {};
  function yearOfRow(row) {
    const d = toDate(row.InvoiceDate) || toDate(row.Date) || toDate(row.DueDate);
    return d ? d.getFullYear() : 0;
  }
  async function readLines(division, path, h) {
    let url = BASE + '/' + division + '/' + path;
    let rows = [];
    let pages = 0;
    while (url && pages < 60) {
      const r = await getEx(url, function () { return headers() || h; }, true);
      const d = r.data && r.data.d ? r.data.d : r.data;
      const part = d && d.results ? d.results : (Array.isArray(d) ? d : []);
      rows = rows.concat(part);
      url = d && d.__next ? d.__next : null;
      pages = pages + 1;
    }
    return rows;
  }
  async function resolveEntries(division, info, list, h) {
    const codes = {};
    info.accounts.forEach(function (a) { if (a.code) { codes[String(a.code)] = a.description; } });
    const all = list.map(function (x) { return String(x[0]); });
    const sel = '$select=EntryNumber,GLAccountCode,GLAccountDescription,AccountCode';
    // The entry number alone is asked for. A filter on the financial year used
    // to be added as well, but Exact books an invoice of December in the next
    // financial year, so the year hid the real account and the item was counted
    // on the wrong payable account. An entry number is unique in a company, so
    // neither a year nor a period is needed.
    async function readChunk(part) {
      const inner = '(' + part.map(function (n) { return 'EntryNumber eq ' + n; }).join(' or ') + ')';
      const tries = [
        'bulk/Financial/TransactionLines?' + sel + '&$filter=' + inner,
        'financialtransaction/TransactionLines?' + sel + '&$filter=' + inner
      ];
      for (let t = 0; t < tries.length; t++) {
        try { const rows = await readLines(division, tries[t], h); info.stat.calls = info.stat.calls + 1; return rows; }
        catch (e) { /* the other shape of the query is tried */ }
      }
      return null;
    }
    async function take(part) {
      const rows = await readChunk(part);
      if (!rows && part.length > 1) {
        // A block Exact refuses is cut in two, so one bad entry number can never
        // keep the others from being found.
        const half = Math.floor(part.length / 2);
        await take(part.slice(0, half));
        await take(part.slice(half));
        return;
      }
      const found = {};
      const pair = {};
      (rows || []).forEach(function (r) {
        const n = String(r.EntryNumber === undefined || r.EntryNumber === null ? '' : r.EntryNumber).trim();
        const gc = String(r.GLAccountCode === undefined || r.GLAccountCode === null ? '' : r.GLAccountCode).trim();
        if (!n || !gc || codes[gc] === undefined) { return; }
        const ac = String(r.AccountCode === undefined || r.AccountCode === null ? '' : r.AccountCode).trim();
        // One journal entry can carry the invoices of several suppliers on
        // several payable accounts, so the supplier of the line is kept next to
        // the entry number: the answer is given per line, not per entry.
        if (ac) {
          const k = n + '|' + ac;
          if (pair[k] !== undefined && pair[k] !== gc) { pair[k] = '?'; } else { pair[k] = gc; }
        }
        if (found[n] !== undefined && found[n] !== gc) { found[n] = '?'; } else { found[n] = gc; }
      });
      Object.keys(pair).forEach(function (k) {
        const gc = pair[k];
        if (gc && gc !== '?') { info.byPair[k] = { code: gc, description: codes[gc] || ('G/L ' + gc) }; }
      });
      part.forEach(function (n) {
        if (rows) { info.entryTried[n] = 1; info.stat.tried = info.stat.tried + 1; }
        else { info.stat.fail = info.stat.fail + 1; }
        const gc = found[n];
        if (gc && gc !== '?') { info.byEntry[n] = { code: gc, description: codes[gc] || ('G/L ' + gc) }; info.stat.found = info.stat.found + 1; }
      });
      info.resolving = Math.max(0, (info.resolving || 0) - part.length);
    }
    let next = 0;
    async function lane() {
      for (;;) {
        const i = next;
        next = next + ENTRY_CHUNK;
        if (i >= all.length) { return; }
        await take(all.slice(i, i + ENTRY_CHUNK));
      }
    }
    const lanes = [];
    for (let i = 0; i < RESOLVE_LANES; i++) { lanes.push(lane()); }
    await Promise.all(lanes);
    info.resolving = 0;
  }
  function pendingEntries(info, rows) {
    const want = [];
    const seen = {};
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const jc = String(row.JournalCode === undefined || row.JournalCode === null ? '' : row.JournalCode).trim();
      // Every open item is looked up in its own journal entry, an item from a
      // purchase journal too: Exact lets an entry be booked on another payable
      // account than the journal carries - an intercompany invoice is the usual
      // case - so the account of the journal is a hint, never the answer.
      const en = String(row.EntryNumber === undefined || row.EntryNumber === null ? '' : row.EntryNumber).trim();
      if (!en || en === '0' || !/^[0-9]+$/.test(en)) { if (info.stat) { info.stat.noEntry = info.stat.noEntry + 1; } continue; }
      if (info.byEntry[en] || info.entryTried[en] || seen[en]) { continue; }
      seen[en] = 1;
      want.push([en, yearOfRow(row)]);
      if (want.length >= ENTRY_MAX) { break; }
    }
    return want;
  }
  // Started next to the report, never in front of it: the screen shows what is
  // known and asks again a few seconds later, so nothing waits on this.
  function queueEntryGl(division, info, rows, h) {
    if (!info || !rows || !rows.length || entryRunning[division]) { return; }
    const want = pendingEntries(info, rows);
    if (!want.length) { return; }
    entryRunning[division] = 1;
    info.resolving = want.length;
    (async function () {
      try { await resolveEntries(division, info, want, h); }
      catch (e) { info.resolving = 0; }
      entryRunning[division] = 0;
    })();
  }
  async function resolveFromRows(division, info, rows, h) {
    if (!info || !rows || !rows.length || entryRunning[division]) { return; }
    const want = pendingEntries(info, rows);
    if (!want.length) { return; }
    entryRunning[division] = 1;
    info.resolving = want.length;
    try { await resolveEntries(division, info, want, h); }
    catch (e) { info.resolving = 0; }
    entryRunning[division] = 0;
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
  // Which payable G/L accounts are wanted. Nothing chosen means every account,
  // just like the ageing screen of Exact Online when its G/L list is left empty.
  // The choice is made on the DESCRIPTION of the account, because the same
  // account carries a different number in every entity.
  const glParam = (req.query.gl === undefined || req.query.gl === null) ? String() : String(req.query.gl);
  const allowList = (glParam === '' || glParam.toLowerCase() === 'all') ? [] : glParam.split('|').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
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
    const out = { referTo: referTo, referenceDate: iso(refDate), division: null, consolidated: consolidated, currency: 'EUR', source: null, buckets: buckets, glAccounts: allowList, glSelected: allowList, glOptions: [], glUsed: [], accounts: [], totals: totals, itemCount: 0, skippedRows: 0, ratesFrom: (ratesCache && ratesCache.fallback ? 'fallback' : 'frankfurter.dev'), errors: {}, lastUpdated: new Date().toISOString() };
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
  const glStats = {};
  const glOptMap = {};
    const stats = { skipped: 0, future: 0 };
    const resolveStats = {};
    // The whole answer gets about 40 seconds; whatever is not read by then keeps
    // reading in the background and the dashboard asks again a few seconds later.
    const budgetUntil = Date.now() + 40000;
    let waiting = null;
    // Exact Online counts its minute limit per division, so the entities are read
    // next to each other instead of one after the other. Nineteen entities in a
    // row used to eat the whole time budget and the last ones never made it into
    // the answer.
    let resolvingLeft = 0;
    let nextTarget = 0;
    async function readTarget() {
      for (;;) {
        const i = nextTarget++;
        if (i >= targets.length) { return; }
        const cur = await divisionCurrency(targets[i], h);
        const gi = cfg.withGl ? await apGlInfo(targets[i], h) : null;
        if (gi) {
          gi.accounts.forEach(function (a) {
            const k = norm(a.description);
            if (!glOptMap[k]) { glOptMap[k] = { description: a.description, codes: [] }; }
            if (a.code && glOptMap[k].codes.indexOf(a.code) < 0) { glOptMap[k].codes.push(a.code); }
            if (a.nameOnly === false) { glOptMap[k].nameOnly = false; }
            else if (glOptMap[k].nameOnly === undefined) { glOptMap[k].nameOnly = true; }
          });
        }
        const left = Math.max(1500, budgetUntil - Date.now());
        const r = await fetchRowsFor(targets[i], sources, h, out.errors, left);
        if (r.loading) {
          if (!waiting) { waiting = { pages: 0, rows: 0, entities: 0 }; }
          waiting.pages += r.loading.pages; waiting.rows += r.loading.rows; waiting.entities += 1;
        }
        if (r.rows) {
          gotAny = true; if (!out.source) out.source = r.source; totalRows += r.rows.length;
          if (gi) { queueEntryGl(targets[i], gi, r.rows, h); }
          accumulate(map, r.rows, referTo, refDate, cur, rates, edges, allowList, stats, targets[i], gi, glStats);
        }
        if (gi && gi.resolving) { resolvingLeft += gi.resolving; }
      if (gi && gi.stat) { resolveStats[String(targets[i])] = { tried: gi.stat.tried, found: gi.stat.found, fail: gi.stat.fail, noEntry: gi.stat.noEntry, calls: gi.stat.calls, pairs: Object.keys(gi.byPair).length }; }
      }
    }
    const readers = [];
    const wideRead = Math.min(8, targets.length);
    for (let i = 0; i < wideRead; i++) { readers.push(readTarget()); }
    await Promise.all(readers);
    if (waiting) { out.loading = waiting; }
    // While the payable G/L accounts of the open items are still being looked up
    // the dashboard is told to come back, so the numbers complete themselves.
    if (resolvingLeft) {
      out.resolving = resolvingLeft;
      if (!out.loading) { out.loading = { pages: 0, rows: totalRows, entities: 0, resolving: resolvingLeft }; }
    }
    if (!gotAny) {
      if (waiting) { return res.status(202).json(out); }
      return res.status(502).json(out);
    }
  out.glOptions = Object.keys(glOptMap).map(function (k) { return glOptMap[k]; }).sort(function (x, y) { return String(x.description).localeCompare(String(y.description)); });
  out.glUsed = Object.keys(glStats).map(function (k) { return glStats[k]; }).sort(function (x, y) { return y.count - x.count; });
    const done = finalize(map, edges);
    out.accounts = done.accounts; out.totals = done.totals; out.itemCount = totalRows; out.skippedRows = stats.skipped; out.futureRows = stats.future || 0; out.resolveStats = resolveStats;
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
  router.get('/api/ageing-ap', function (req, res) { return handleAgeing(req, res, { sources: AP_SOURCES, edges: AP_EDGES, gl: [], withGl: true }); });
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
        let gi0 = null;
        try { gi0 = await apGlInfo(t.division, h); } catch (e) { gi0 = null; }
        // The real payable G/L account of every open item is resolved here, in the
        // background, so a dashboard opened later already has it.
        try {
          const wrows = await fetchAll(t.division, t.path, h, 600, 240000);
          if (gi0 && t.path === AP_SOURCES[0] && wrows && wrows.length) { await resolveFromRows(t.division, gi0, wrows, h); }
        }
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
