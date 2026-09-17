// GL account balance report - live data from Exact Online
// Generic helper used by the InterCompany report: returns the cumulative
// closing balance (to date) for every G/L account of a given BalanceType
// ('B' = Balance Sheet, 'W' = Profit & Loss) for one division, restricted
// (via codeFrom/codeTo) to the Intercompany G/L account code range so the
// request stays small, fast, and inside Exact Online's rate limits.
// An optional reporting year range (year/yearFrom/yearTo) and reporting
// period range (period/periodFrom/periodTo) narrow the balance to the chosen
// periods, so the figures change with the period exactly like the aggregated
// ReportingBalance data. Callers that pass none of these keep the old
// behaviour (the full cumulative balance).
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
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    async function getWithRetry(url, h, attempts) {
        const n = attempts || 4;
        for (let i = 0; i < n; i++) {
            try {
                return await axios.get(url, { headers: h, timeout: 30000 });
            } catch (e) {
                const status = e.response && e.response.status;
                if ((status === 429 || status === 503) && i < n - 1) {
                    const retryAfter = e.response.headers && e.response.headers['retry-after'];
                    const wait = retryAfter ? Number(retryAfter) * 1000 : (900 * (i + 1));
                    await sleep(wait);
                    continue;
                }
                throw e;
            }
        }
    }
    async function fetchAll(division, path, h, maxPages) {
        let url = BASE + '/' + division + '/' + path;
        let rows = [];
        let pages = 0;
        while (url && pages < (maxPages || 60)) {
            const r = await getWithRetry(url, h, 4);
            const d = r.data && r.data.d ? r.data.d : r.data;
            const part = d && d.results ? d.results : (Array.isArray(d) ? d : []);
            rows = rows.concat(part);
            url = d && d.__next ? d.__next : null;
            pages = pages + 1;
            if (url) await sleep(150);
        }
        return rows;
    }
    router.get('/api/gl-balance', async function (req, res) {
        const h = headers();
        if (!h) return res.status(401).json({ error: 'Not authenticated' });
        const division = req.query.division ? String(req.query.division) : null;
        const balanceType = req.query.balanceType ? String(req.query.balanceType) : 'B';
        const codeFrom = req.query.codeFrom ? String(req.query.codeFrom) : null;
        const codeTo = req.query.codeTo ? String(req.query.codeTo) : null;
        if (!division) return res.status(400).json({ error: 'division is required' });
        try {
            let filter = "BalanceType eq '" + balanceType + "'";
            if (codeFrom) filter += " and GLAccountCode ge '" + codeFrom + "'";
            if (codeTo) filter += " and GLAccountCode le '" + codeTo + "'";
            const yFrom = req.query.yearFrom || req.query.year || null;
            const yTo = req.query.yearTo || req.query.year || null;
            if (yFrom) filter += ' and ReportingYear ge ' + Number(yFrom);
            if (yTo) filter += ' and ReportingYear le ' + Number(yTo);
            const pFrom = req.query.periodFrom || req.query.period || null;
            const pTo = req.query.periodTo || req.query.period || null;
            if (pFrom) filter += ' and ReportingPeriod ge ' + Number(pFrom);
            if (pTo) filter += ' and ReportingPeriod le ' + Number(pTo);
            const path = 'financial/ReportingBalance?$filter=' + filter + '&$select=GLAccountCode,GLAccountDescription,Amount';
            const rows = await fetchAll(division, path, h, 60);
            const sums = {};
            rows.forEach(function (r) {
                const code = r.GLAccountCode;
                if (!sums[code]) sums[code] = { code: code, description: r.GLAccountDescription, amount: 0 };
                sums[code].amount += Number(r.Amount) || 0;
            });
            const accounts = Object.keys(sums).map(function (c) { return sums[c]; }).filter(function (a) { return Math.abs(a.amount) > 0.004; });
            res.json({ division: division, balanceType: balanceType, yearFrom: yFrom, yearTo: yTo, periodFrom: pFrom, periodTo: pTo, accounts: accounts, rowCount: rows.length, lastUpdated: new Date().toISOString() });
        } catch (e) {
            const status = e.response && e.response.status;
            const detail = e.response && e.response.data ? e.response.data : e.message;
            res.status(500).json({ error: 'GL balance fetch failed' + (status ? (' (HTTP ' + status + ')') : ''), details: detail });
        }
    });
    return router;
};
