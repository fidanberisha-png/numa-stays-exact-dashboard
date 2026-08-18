// Accrued dashboard routes - live data from Exact Online
// GET /api/accrued/transactions?division=<id>&year=<yyyy>&code=<glcode>
// GET /api/accrued/entry?division=<id>&entry=<entryNumber>&year=<yyyy>
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
        let last = null;
        for (let i = 0; i < n; i++) {
            try {
                return await axios.get(url, { headers: h, timeout: 30000 });
            } catch (e) {
                last = e;
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
        throw last;
    }

    async function fetchAll(division, path, h, maxPages) {
        let url = BASE + '/' + division + '/' + path;
        let rows = [];
        let pages = 0;
        while (url && pages < (maxPages || 40)) {
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
    const SELECT_FULL = 'Date,EntryNumber,JournalCode,JournalDescription,Description,AccountCode,AccountName,AmountDC,FinancialPeriod,FinancialYear,GLAccountCode,GLAccountDescription,LineNumber,Status';
    const SELECT_MIN = 'Date,EntryNumber,JournalCode,Description,AccountCode,AccountName,AmountDC,FinancialPeriod,FinancialYear,GLAccountCode,GLAccountDescription,LineNumber';

    async function fetchLines(division, filter, orderby, h) {
        const q = 'financial/TransactionLines?$filter=' + filter + '&$orderby=' + orderby + '&$select=';
        try {
            return await fetchAll(division, q + SELECT_FULL, h, 40);
        } catch (e) {
            const status = e.response && e.response.status;
            if (status === 400 || status === 404 || status === 500) {
                return await fetchAll(division, q + SELECT_MIN, h, 40);
            }
            throw e;
        }
    }

    function txt(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

    function mapLine(r) {
        const amt = Number(r.AmountDC) || 0;
        return {
            date: r.Date || null,
            entryNumber: r.EntryNumber,
            journalCode: txt(r.JournalCode),
            journalDescription: txt(r.JournalDescription),
            description: txt(r.Description),
            accountCode: txt(r.AccountCode),
            accountName: txt(r.AccountName),
            glCode: txt(r.GLAccountCode),
            glDescription: txt(r.GLAccountDescription),
            period: r.FinancialPeriod,
            year: r.FinancialYear,
            lineNumber: r.LineNumber,
            status: r.Status,
            debit: amt > 0 ? amt : 0,
            credit: amt < 0 ? -amt : 0,
            amount: amt
        };
    }

    function totalsOf(lines) {
        let debit = 0, credit = 0;
        lines.forEach(function (l) { debit += l.debit; credit += l.credit; });
        const balance = debit - credit;
        return { debit: debit, credit: credit, balance: balance, balanced: Math.abs(balance) < 0.005, count: lines.length };
    }
    router.get('/api/accrued/transactions', async function (req, res) {
        const h = headers();
        if (!h) return res.status(401).json({ error: 'Not authenticated' });
        const division = req.query.division ? String(req.query.division) : null;
        const code = req.query.code ? String(req.query.code).trim() : '272200';
        const year = req.query.year ? parseInt(String(req.query.year), 10) : null;
        if (!division) return res.status(400).json({ error: 'division is required' });
        if (!year) return res.status(400).json({ error: 'year is required' });
        try {
            const filter = 'FinancialYear eq ' + year +
                " and GLAccountCode ge '" + code + "' and GLAccountCode le '" + code + "zzzz'";
            const rows = await fetchLines(division, filter, 'Date,EntryNumber', h);
            const lines = rows.map(mapLine).filter(function (l) { return l.glCode === code; });
            res.json({
                division: division,
                year: year,
                code: code,
                description: lines.length ? lines[0].glDescription : '',
                lines: lines,
                totals: totalsOf(lines),
                lastUpdated: new Date().toISOString()
            });
        } catch (e) {
            const status = (e.response && e.response.status) || 500;
            res.status(status === 401 ? 401 : 500).json({
                error: 'Failed to load accrued transactions',
                detail: e.message,
                status: status
            });
        }
    });

    router.get('/api/accrued/entry', async function (req, res) {
        const h = headers();
        if (!h) return res.status(401).json({ error: 'Not authenticated' });
        const division = req.query.division ? String(req.query.division) : null;
        const entry = req.query.entry ? String(req.query.entry).replace(/[^0-9]/g, '') : '';
        const year = req.query.year ? parseInt(String(req.query.year), 10) : null;
        if (!division) return res.status(400).json({ error: 'division is required' });
        if (!entry) return res.status(400).json({ error: 'entry is required' });
        try {
            let filter = 'EntryNumber eq ' + entry;
            if (year) filter = filter + ' and FinancialYear eq ' + year;
            const rows = await fetchLines(division, filter, 'LineNumber', h);
            const lines = rows.map(mapLine);
            const head = lines.length ? lines[0] : null;
            res.json({
                division: division,
                entryNumber: entry,
                year: year,
                journal: head ? (head.journalCode + (head.journalDescription ? ' - ' + head.journalDescription : '')) : '',
                period: head ? head.period : null,
                lines: lines,
                totals: totalsOf(lines),
                lastUpdated: new Date().toISOString()
            });
        } catch (e) {
            const status = (e.response && e.response.status) || 500;
            res.status(status === 401 ? 401 : 500).json({
                error: 'Failed to load entry',
                detail: e.message,
                status: status
            });
        }
    });

    return router;
};
