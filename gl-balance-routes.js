// GL account balance report - live data from Exact Online
// Generic helper used by the InterCompany report: returns the cumulative
// closing balance (to date) for every G/L account of a given BalanceType
// ('B' = Balance Sheet, 'W' = Profit & Loss) for one division.
const express = require('express');
const axios = require('axios');
const REGION = process.env.EXACT_REGION || 'nl';
const BASE = 'https://start.exactonline.' + REGION + '/api/v1';

module.exports = function (getToken) {
  const router = express.Router();
  function headers() {
    const t = getToken();
    if (!t) return null;
    return { Authorization: 'Bearer ' + t.access_token, Accept: 'application/json' };
  }
  async function fetchAll(division, path, h, maxPages) {
    let url = BASE + '/' + division + '/' + path;
    let rows = [];
    let pages = 0;
    while (url && pages < (maxPages || 120)) {
      const r = await axios.get(url, { headers: h });
      const d = r.data && r.data.d ? r.data.d : r.data;
      const part = d && d.results ? d.results : (Array.isArray(d) ? d : []);
      rows = rows.concat(part);
      url = d && d.__next ? d.__next : null;
      pages = pages + 1;
    }
    return rows;
  }
  router.get('/api/gl-balance', async function (req, res) {
    const h = headers();
    if (!h) return res.status(401).json({ error: 'Not authenticated' });
    const division = req.query.division ? String(req.query.division) : null;
    const balanceType = req.query.balanceType ? String(req.query.balanceType) : 'B';
    if (!division) return res.status(400).json({ error: 'division is required' });
    try {
      const path = "financial/ReportingBalance?$filter=BalanceType eq '" + balanceType + "'&$select=GLAccountCode,GLAccountDescription,Amount";
      const rows = await fetchAll(division, path, h, 120);
      const sums = {};
      rows.forEach(function (r) {
        const code = r.GLAccountCode;
        if (!sums[code]) sums[code] = { code: code, description: r.GLAccountDescription, amount: 0 };
        sums[code].amount += Number(r.Amount) || 0;
      });
      const accounts = Object.keys(sums).map(function (c) { return sums[c]; }).filter(function (a) { return Math.abs(a.amount) > 0.004; });
      res.json({ division: division, balanceType: balanceType, accounts: accounts, rowCount: rows.length, lastUpdated: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ error: 'GL balance fetch failed', details: e.response && e.response.data ? e.response.data : e.message });
    }
  });
  return router;
};
