// Accrued dashboard routes - live data from Exact Online
// GET /api/accrued/transactions  division, year, code
// GET /api/accrued/entry         division, entryId (preferred) or entry + year
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
    const SELECT_FULL = 'Date,EntryID,EntryNumber,JournalCode,JournalDescription,Description,AccountCode,AccountName,AmountDC,FinancialPeriod,FinancialYear,GLAccountCode,GLAccountDescription,LineNumber,Status,CostCenter,CostCenterDescription';
    const SELECT_MIN = 'Date,EntryID,EntryNumber,JournalCode,Description,AmountDC,FinancialPeriod,FinancialYear,GLAccountCode,GLAccountDescription,LineNumber,CostCenter,CostCenterDescription';

    // Exact Online is picky about paths, $select and $orderby on transaction lines,
    // so every query is tried in a few variants until one succeeds.
    async function fetchLines(division, filter, orderby, h) {
        const P1 = 'financialtransaction/TransactionLines';
        const P2 = 'bulk/Financial/TransactionLines';
        const tries = [
            P1 + '?$filter=' + filter + '&$orderby=' + orderby + '&$select=' + SELECT_FULL,
            P1 + '?$filter=' + filter + '&$select=' + SELECT_FULL,
            P1 + '?$filter=' + filter + '&$select=' + SELECT_MIN,
            P1 + '?$filter=' + filter,
            P2 + '?$filter=' + filter + '&$select=' + SELECT_FULL,
            P2 + '?$filter=' + filter + '&$select=' + SELECT_MIN,
            P2 + '?$filter=' + filter
        ];
        let last = null;
        for (let i = 0; i < tries.length; i++) {
            try {
                return await fetchAll(division, tries[i], h, 40);
            } catch (e) {
                last = e;
                const st = e.response && e.response.status;
                if (st === 401 || st === 403) throw e;
            }
        }
        throw last;
    }

    function txt(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

    function mapLine(r) {
        const amt = Number(r.AmountDC) || 0;
        return {
            date: r.Date || null,
            entryId: txt(r.EntryID),
            entryNumber: r.EntryNumber,
            journalCode: txt(r.JournalCode),
            journalDescription: txt(r.JournalDescription),
            description: txt(r.Description),
            accountCode: txt(r.AccountCode),
            accountName: txt(r.AccountName),
            costCenter: txt(r.CostCenter || r.CostCenterCode), costCenterName: txt(r.CostCenterDescription || r.CostCenterName), glCode: txt(r.GLAccountCode),
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

    router.get('/api/accrued/summary', async function (req, res) { const h = headers(); if (!h) return res.status(401).json({ error: 'Not authenticated' }); const division = req.query.division ? String(req.query.division) : null; const code = req.query.code ? String(req.query.code).trim() : '272200'; const year = req.query.year ? parseInt(String(req.query.year), 10) : null; if (!division) return res.status(400).json({ error: 'division is required' }); if (!year) return res.status(400).json({ error: 'year is required' }); try { const filter = 'FinancialYear eq ' + year + " and GLAccountCode ge '" + code + "' and GLAccountCode le '" + code + "zzzz'"; const raw = await fetchLines(division, filter, 'Date,EntryNumber', h); const base = raw.map(mapLine).filter(function (l) { return l.glCode === code; }); const ccOf = {}; const want = {}; const nums = []; base.forEach(function (l) { const k = String(l.entryNumber); if (!k) return; if (l.costCenter && !ccOf[k]) ccOf[k] = { c: l.costCenter, n: l.costCenterName }; if (!want[k]) { want[k] = 1; nums.push(k); } }); const out = []; const errs = []; async function grab(list) { if (!list.length) return; const f = 'FinancialYear eq ' + year + ' and (' + list.map(function (n) { return 'EntryNumber eq ' + n; }).join(' or ') + ')'; try { const lines = await fetchLines(division, f, 'EntryNumber', h); lines.map(mapLine).forEach(function (l) { if (l.glCode === code) return; const k = String(l.entryNumber); if (!want[k]) return; const cc = l.costCenter ? { c: l.costCenter, n: l.costCenterName } : (ccOf[k] || { c: '', n: '' }); out.push({ entryNumber: l.entryNumber, entryId: l.entryId, date: l.date, year: l.year, period: l.period, glCode: l.glCode, glDescription: l.glDescription, costCenter: cc.c, costCenterName: cc.n, description: l.description, debit: l.debit, credit: l.credit, amount: l.amount }); }); } catch (e) { if (list.length > 8) { const half = Math.ceil(list.length / 2); await grab(list.slice(0, half)); await grab(list.slice(half)); } else { errs.push('entries ' + list[0] + ' - ' + list[list.length - 1] + ': ' + e.message); } } } for (let i = 0; i < nums.length; i += 60) { await grab(nums.slice(i, i + 60)); await sleep(120); } res.json({ division: division, year: year, code: code, entries: nums.length, accrualLines: base.length, rows: out, chunkErrors: errs, lastUpdated: new Date().toISOString() }); } catch (e) { const status = (e.response && e.response.status) || 500; res.status(status === 401 ? 401 : 500).json({ error: 'Failed to load accrued summary', detail: e.message, status: status }); } }); router.get('/api/accrued/entry', async function (req, res) {
        const h = headers();
        if (!h) return res.status(401).json({ error: 'Not authenticated' });
        const division = req.query.division ? String(req.query.division) : null;
        const entryId = req.query.entryId ? String(req.query.entryId).replace(/[^0-9a-fA-F-]/g, '') : '';
        const entry = req.query.entry ? String(req.query.entry).replace(/[^0-9]/g, '') : '';
        const year = req.query.year ? parseInt(String(req.query.year), 10) : null;
        if (!division) return res.status(400).json({ error: 'division is required' });
        if (!entryId && !entry) return res.status(400).json({ error: 'entryId or entry is required' });
        const filters = [];
        if (entryId) filters.push("EntryID eq guid'" + entryId + "'");
        if (entry && year) filters.push('FinancialYear eq ' + year + ' and EntryNumber eq ' + entry);
        if (entry) filters.push('EntryNumber eq ' + entry);
        let rows = null;
        let last = null;
        for (let i = 0; i < filters.length; i++) {
            try {
                rows = await fetchLines(division, filters[i], 'LineNumber', h);
                if (rows && rows.length) break;
            } catch (e) {
                last = e;
            }
        }
        if (!rows) {
            const status = (last && last.response && last.response.status) || 500;
            return res.status(status === 401 ? 401 : 500).json({
                error: 'Failed to load entry',
                detail: last ? last.message : 'no data',
                status: status
            });
        }
        const lines = rows.map(mapLine).sort(function (a, b) { return (a.lineNumber || 0) - (b.lineNumber || 0); });
        const head = lines.length ? lines[0] : null;
        res.json({
            division: division,
            entryNumber: head ? head.entryNumber : entry,
            entryId: entryId,
            year: head ? head.year : year,
            period: head ? head.period : null,
            journal: head ? (head.journalCode + (head.journalDescription ? ' - ' + head.journalDescription : '')) : '',
            lines: lines,
            totals: totalsOf(lines),
            lastUpdated: new Date().toISOString()
        });
    });

    return router;
};
