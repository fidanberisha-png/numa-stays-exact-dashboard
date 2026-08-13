// Ageing analysis: A/P - live data from Exact Online
// Used by the Numa Stays dashboard (public/dashboard.html)
const express = require('express');
const axios = require('axios');
const REGION = process.env.EXACT_REGION || 'nl';
const BASE = 'https://start.exactonline.' + REGION + '/api/v1';
const SOURCES = ['read/financial/AgingPayablesList', 'read/financial/PayablesList'];
module.exports = function (getToken) {
  const router = express.Router();
  let divisionCache = null;
  function headers() {
    const t = getToken();
    if (!t) return null;
    return { Authorization: 'Bearer ' + t.access_token, Accept: 'application/json' };
  }
  async function getDivision(h) {
    if (divisionCache) return divisionCache;
    const r = await axios.get(BASE + '/current/Me?$select=CurrentDivision', { headers: h });
    divisionCache = r.data.d.results[0].CurrentDivision;
    return divisionCache;
  }
  async function fetchAll(path, h, maxPages) {
    const div = await getDivision(h);
    let url = BASE + '/' + div + '/' + path;
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
  function iso(d) {
    return d ? d.toISOString().slice(0, 10) : null;
  }
  function num(v) {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  function ageOf(row, referTo, refDate) {
    const base = referTo === 'duedate' ? toDate(row.DueDate) : (toDate(row.InvoiceDate) || toDate(row.Date) || toDate(row.DueDate));
    if (!base) return 0;
    return Math.floor((refDate.getTime() - base.getTime()) / 86400000);
  }
  router.get('/api/ageing-ap', async function (req, res) {
    const h = headers();
    if (!h) return res.status(401).json({ error: 'Not authenticated' });
    const referTo = req.query.referTo === 'duedate' ? 'duedate' : 'date';
    const refDate = req.query.date ? new Date(req.query.date) : new Date();
    const out = { referTo: referTo, referenceDate: iso(refDate), division: null, source: null, accounts: [], totals: { b1: 0, b2: 0, b3: 0, b4: 0, total: 0 }, itemCount: 0, errors: {}, lastUpdated: new Date().toISOString() };
    try {
      out.division = await getDivision(h);
    } catch (e) {
      out.errors.division = e.response && e.response.data ? e.response.data : e.message;
      return res.status(500).json(out);
    }
    let rows = null;
    for (let i = 0; i < SOURCES.length && !rows; i++) {
      try {
        rows = await fetchAll(SOURCES[i], h, 40);
        out.source = SOURCES[i];
      } catch (e) {
        out.errors[SOURCES[i]] = e.response && e.response.data ? e.response.data : e.message;
        rows = null;
      }
    }
    if (!rows) return res.status(502).json(out);
    const map = {};
    rows.forEach(function (row) {
      const code = (row.AccountCode === undefined || row.AccountCode === null ? '' : String(row.AccountCode)).trim();
      const key = code || String(row.AccountId || 'unknown');
      if (!map[key]) {
        map[key] = { code: code, name: row.AccountName || '', b1: 0, b2: 0, b3: 0, b4: 0, total: 0, weighted: 0, absTotal: 0, count: 0, items: [] };
      }
      const acc = map[key];
      const preBucketed = row.AgeGroup1Amount !== undefined || row.Amount1 !== undefined;
      if (preBucketed) {
        const v1 = num(row.AgeGroup1Amount !== undefined ? row.AgeGroup1Amount : row.Amount1);
        const v2 = num(row.AgeGroup2Amount !== undefined ? row.AgeGroup2Amount : row.Amount2);
        const v3 = num(row.AgeGroup3Amount !== undefined ? row.AgeGroup3Amount : row.Amount3);
        const v4 = num(row.AgeGroup4Amount !== undefined ? row.AgeGroup4Amount : row.Amount4);
        acc.b1 = acc.b1 + v1;
        acc.b2 = acc.b2 + v2;
        acc.b3 = acc.b3 + v3;
        acc.b4 = acc.b4 + v4;
        acc.total = acc.total + v1 + v2 + v3 + v4;
        acc.count = acc.count + 1;
        return;
      }
      const amount = num(row.Amount !== undefined ? row.Amount : row.AmountDC);
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
      acc.items.push({ invoiceNumber: row.InvoiceNumber || row.EntryNumber || null, description: row.Description || '', yourRef: row.YourRef || '', currency: row.CurrencyCode || '', amount: amount, invoiceDate: iso(toDate(row.InvoiceDate) || toDate(row.Date)), dueDate: iso(toDate(row.DueDate)), age: age });
    });
    const list = [];
    Object.keys(map).forEach(function (k) {
      const a = map[k];
      a.average = a.absTotal ? Math.round(a.weighted / a.absTotal) : 0;
      delete a.weighted;
      delete a.absTotal;
      a.items.sort(function (p, q) { return q.age - p.age; });
      out.totals.b1 = out.totals.b1 + a.b1;
      out.totals.b2 = out.totals.b2 + a.b2;
      out.totals.b3 = out.totals.b3 + a.b3;
      out.totals.b4 = out.totals.b4 + a.b4;
      out.totals.total = out.totals.total + a.total;
      if (a.total !== 0 || a.b1 || a.b2 || a.b3 || a.b4) list.push(a);
    });
    list.sort(function (x, y) { return String(x.code).localeCompare(String(y.code)); });
    out.accounts = list;
    out.itemCount = rows.length;
    res.json(out);
  });
  return router;
};
