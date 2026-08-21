// Ageing analysis: A/P and A/R - live data from Exact Online, normalized to EUR
// Used by the Numa Stays dashboard (public/dashboard.html)
// Supports: single division (?division=CODE) and consolidated (?division=consolidated)
// All monetary values are converted to EUR using live ECB rates (frankfurter.dev).
const express = require('express');
const axios = require('axios');
const REGION = process.env.EXACT_REGION || 'nl';
const BASE = 'https://start.exactonline.' + REGION + '/api/v1';
const AP_SOURCES = ['read/financial/AgingPayablesList', 'read/financial/PayablesList'];
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
    const r = await axios.get(BASE + '/current/Me?$select=CurrentDivision', { headers: h });
    currentDivisionCache = r.data.d.results[0].CurrentDivision;
    return currentDivisionCache;
  }
  async function getAllDivisions(h) {
    if (divisionsCache) return divisionsCache;
    const cur = await getCurrentDivision(h);
    // Do NOT $select (the Division OData model varies, e.g. no HID); fetch all fields and pick safely.
    const url = BASE + '/' + cur + '/system/Divisions?$orderby=Code';
    const r = await axios.get(url, { headers: h });
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
  async function fetchAll(division, path, h, maxPages) {
    let url = BASE + '/' + division + '/' + path;
    let rows = [];
    let pages = 0;
    while (url && pages < (maxPages || 25)) {
      const r = await axios.get(url, { headers: h });
      const d = r.data && r.data.d ? r.data.d : r.data;
      const part = d && d.results ? d.results : (Array.isArray(d) ? d : []);
      rows = rows.concat(part);
      url = d && d.__next ? d.__next : null;
      pages = pages + 1;
    }
    return rows;
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
  function accumulate(map, rows, referTo, refDate, currency, rates) {
    rows.forEach(function (row) {
      const code = (row.AccountCode === undefined || row.AccountCode === null ? '' : String(row.AccountCode)).trim();
      const key = code || String(row.AccountId || 'unknown');
      if (!map[key]) {
        map[key] = { code: code, name: row.AccountName || '', b1: 0, b2: 0, b3: 0, b4: 0, total: 0, weighted: 0, absTotal: 0, count: 0, items: [] };
      }
      const acc = map[key];
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
      let bucket = 'b4';
      if (age <= 30) bucket = 'b1';
      else if (age <= 60) bucket = 'b2';
      else if (age <= 90) bucket = 'b3';
      acc[bucket] = acc[bucket] + amount;
      acc.total = acc.total + amount;
      acc.weighted = acc.weighted + age * Math.abs(amount);
      acc.absTotal = acc.absTotal + Math.abs(amount);
      acc.count = acc.count + 1;
    });
  }
  function finalize(map) {
    const list = [];
    const totals = { b1: 0, b2: 0, b3: 0, b4: 0, total: 0 };
    Object.keys(map).forEach(function (k) {
      const a = map[k];
      a.avgDays = a.absTotal ? Math.round(a.weighted / a.absTotal) : 0;
      totals.b1 += a.b1; totals.b2 += a.b2; totals.b3 += a.b3; totals.b4 += a.b4; totals.total += a.total;
      if (a.b1 || a.b2 || a.b3 || a.b4) list.push(a);
    });
    list.sort(function (x, y) { return String(x.code).localeCompare(String(y.code)); });
    return { accounts: list, totals: totals };
  }
  async function fetchRowsFor(division, sources, h, errors) {
    let rows = null; let source = null;
    for (let i = 0; i < sources.length && !rows; i++) {
      try { rows = await fetchAll(division, sources[i], h, 40); source = sources[i]; }
      catch (e) { errors[division + ':' + sources[i]] = e.response && e.response.data ? e.response.data : e.message; rows = null; }
    }
    return { rows: rows, source: source };
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
  async function handleAgeing(req, res, sources) {
    const h = headers();
    if (!h) return res.status(401).json({ error: 'Not authenticated' });
    const referTo = req.query.referTo === 'duedate' ? 'duedate' : 'date';
    const refDate = req.query.date ? new Date(req.query.date) : new Date();
    const wanted = req.query.division ? String(req.query.division) : null;
    const consolidated = wanted === 'consolidated' || wanted === 'all';
    const rates = await getEurRates();
    const out = { referTo: referTo, referenceDate: iso(refDate), division: null, consolidated: consolidated, currency: 'EUR', source: null, accounts: [], totals: { b1: 0, b2: 0, b3: 0, b4: 0, total: 0 }, itemCount: 0, ratesFrom: (ratesCache && ratesCache.fallback ? 'fallback' : 'frankfurter.dev'), errors: {}, lastUpdated: new Date().toISOString() };
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
    for (let i = 0; i < targets.length; i++) {
      const cur = await divisionCurrency(targets[i], h);
      const r = await fetchRowsFor(targets[i], sources, h, out.errors);
      if (r.rows) { gotAny = true; if (!out.source) out.source = r.source; totalRows += r.rows.length; accumulate(map, r.rows, referTo, refDate, cur, rates); }
    }
    if (!gotAny) return res.status(502).json(out);
    const done = finalize(map);
    out.accounts = done.accounts; out.totals = done.totals; out.itemCount = totalRows;
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
  router.get('/api/ageing-ap', function (req, res) { return handleAgeing(req, res, AP_SOURCES); });
  router.get('/api/ageing-ar', function (req, res) { return handleAgeing(req, res, AR_SOURCES); });
  return router;
};
