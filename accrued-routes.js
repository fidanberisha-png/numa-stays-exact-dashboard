// Accrued dashboard routes - live data from Exact Online
// GET /api/accrued/transactions  division, year, code
// GET /api/accrued/entry         division, entryId (preferred) or entry + year
const express = require('express');
const axios = require('axios');
const REGION = process.env.EXACT_REGION || 'nl';
const BASE = 'https://start.exactonline.' + REGION + '/api/v1';

module.exports = function (getToken) {
    const router = express.Router(); router.use(function (req, res, next) { if (String(req.path || '').indexOf('/api/accrued/') !== 0) return next(); const q0 = Object.assign({}, req.query || {}); const fr = q0.fresh; delete q0.fresh; const ck = req.path + '|' + JSON.stringify(q0); if (!fr) { const hit = cacheGet(ck); if (hit) return res.json(hit); } const j0 = res.json.bind(res); res.json = function (body) { if (res.statusCode === 200 && body && !body.error) cacheSet(ck, body); return j0(body); }; next(); });

    function headers() {
        const t = getToken();
        if (!t) return null;
        return { Authorization: 'Bearer ' + t.access_token, Accept: 'application/json' };
    }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); } const VARIANT = {}; const GATE = {}; const CACHE = {}; const TTL = 900000; function cacheGet(k) { const e = CACHE[k]; if (!e) return null; if (Date.now() - e.t > TTL) { delete CACHE[k]; return null; } return e.v; } function cacheSet(k, v) { CACHE[k] = { t: Date.now(), v: v }; const ks = Object.keys(CACHE); if (ks.length > 300) { for (let i = 0; i < 100; i++) delete CACHE[ks[i]]; } } async function withGate(div, fn) { let g = GATE[div]; if (!g) { g = GATE[div] = { max: 3, cur: 0, q: [] }; } if (g.cur >= g.max) await new Promise(function (r) { g.q.push(r); }); g.cur++; try { return await fn(); } finally { g.cur--; const nx = g.q.shift(); if (nx) nx(); } } async function pool(items, n, fn) { let i = 0; const ws = []; const lim = Math.min(n, items.length); for (let w = 0; w < lim; w++) ws.push((async function () { while (true) { const ix = i++; if (ix >= items.length) return; await fn(items[ix], ix); } })()); await Promise.all(ws); }

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

    async function fetchAll(division, path, h, maxPages, meta) {
        let url = BASE + '/' + division + '/' + path;
        let rows = [];
        let pages = 0;
        const cap = maxPages || 40;
        while (url && pages < cap) {
            const r = await withGate(division, function () { return getWithRetry(url, h, 4); });
            const d = r.data && r.data.d ? r.data.d : r.data;
            const part = d && d.results ? d.results : (Array.isArray(d) ? d : []);
            rows = rows.concat(part);
            url = d && d.__next ? d.__next : null;
            pages = pages + 1;
            if (url) await sleep(30);
        }
        // A page limit that is hit silently is what used to make counter lines disappear,
        // so the caller is told about it instead of getting half of the journal entry.
        if (url && meta) meta.truncated = true;
        return rows;
    }
    const SELECT_FULL = 'Date,EntryID,EntryNumber,JournalCode,JournalDescription,Description,AccountCode,AccountName,AmountDC,FinancialPeriod,FinancialYear,GLAccountCode,GLAccountDescription,LineNumber,Status,CostCenter,CostCenterDescription';
    const SELECT_MIN = 'Date,EntryID,EntryNumber,JournalCode,Description,AmountDC,FinancialPeriod,FinancialYear,GLAccountCode,GLAccountDescription,LineNumber,CostCenter,CostCenterDescription';

    // Exact Online is picky about paths, $select and $orderby on transaction lines,
    // so every query is tried in a few variants until one succeeds.
    async function fetchLines(division, filter, orderby, h, opts) {
        const o = opts || {};
        const P1 = 'financialtransaction/TransactionLines';
        const P2 = 'bulk/Financial/TransactionLines';
        const small = [
            P1 + '?$filter=' + filter + '&$orderby=' + orderby + '&$select=' + SELECT_FULL,
            P1 + '?$filter=' + filter + '&$select=' + SELECT_FULL,
            P1 + '?$filter=' + filter + '&$select=' + SELECT_MIN,
            P1 + '?$filter=' + filter
        ];
        const bulk = [
            P2 + '?$filter=' + filter + '&$select=' + SELECT_FULL,
            P2 + '?$filter=' + filter + '&$select=' + SELECT_MIN,
            P2 + '?$filter=' + filter
        ];
        // A bulk page holds 1000 lines, a normal page only 60. Month end and year end
        // entries can carry thousands of lines, so bulk is asked first for those.
        const tries0 = o.bulkFirst ? bulk.concat(small) : small.concat(bulk); const mk = division + '|' + (o.bulkFirst ? 'b' : 's'); const gi = VARIANT[mk]; const tries = (typeof gi === 'number' && gi > 0 && gi < tries0.length) ? [tries0[gi]].concat(tries0.filter(function (x, ix) { return ix !== gi; })) : tries0;
        const cap = o.maxPages || 40;
        let last = null;
        for (let i = 0; i < tries.length; i++) {
            try {
                const out = await fetchAll(division, tries[i], h, cap, o.meta); VARIANT[mk] = tries0.indexOf(tries[i]); return out;
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
            const rows = await fetchLines(division, filter, 'Date,EntryNumber', h, { bulkFirst: true, maxPages: 400 });
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

    router.get('/api/accrued/summary', async function (req, res) {
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
            const baseMeta = {};
            const raw = await fetchLines(division, filter, 'Date,EntryNumber', h, { bulkFirst: true, maxPages: 400, meta: baseMeta });
            const base = raw.map(mapLine).filter(function (l) { return l.glCode === code; });
            const want = {};
            const nums = [];
            base.forEach(function (l) {
                const k = String(l.entryNumber);
                if (!k) return;
                if (!want[k]) { want[k] = 1; nums.push(k); }
            });
            const counter = {}; const sure = {};
            const errs = [];
            if (baseMeta.truncated) errs.push('accrual lines: Exact paging was cut off, the year is incomplete');
            async function grab(list) {
                if (!list.length) return;
                const f = 'FinancialYear eq ' + year + ' and EntryNumber ge ' + list[0] + ' and EntryNumber le ' + list[list.length - 1];
                const meta = {};
                try {
                    const lines = await fetchLines(division, f, 'EntryNumber', h, { bulkFirst: true, maxPages: 400, meta: meta });
                    lines.map(mapLine).forEach(function (l) {
                        if (l.glCode === code) return;
                        const k = String(l.entryNumber);
                        if (!want[k]) return;
                        if (!counter[k]) counter[k] = [];
                        counter[k].push(l);
                    });
                    if (!meta.truncated) list.forEach(function (n) { sure[n] = 1; }); if (meta.truncated && list.length > 1) {
                        // Half of a journal entry is worse than no answer, so the block is
                        // thrown away and asked again in smaller pieces.
                        list.forEach(function (n) { delete counter[n]; });
                        const half2 = Math.ceil(list.length / 2);
                        await grab(list.slice(0, half2));
                        await grab(list.slice(half2));
                    } else if (meta.truncated) {
                        errs.push('entry ' + list[0] + ': Exact paging was cut off');
                    }
                } catch (e) {
                    if (list.length > 1) {
                        const half = Math.ceil(list.length / 2);
                        await grab(list.slice(0, half));
                        await grab(list.slice(half));
                    } else {
                        errs.push('entries ' + list[0] + ' - ' + list[list.length - 1] + ': ' + e.message);
                    }
                }
            }
            const snums = nums.slice().sort(function (x, y) { return Number(x) - Number(y); }); const blocks = []; let cb = []; snums.forEach(function (n) { if (cb.length && (cb.length >= 150 || (Number(n) - Number(cb[0])) > 1200)) { blocks.push(cb); cb = []; } cb.push(n); }); if (cb.length) blocks.push(cb); await pool(blocks, 3, function (b) { return grab(b); });
            // Second pass: an entry that still has no counter line is asked on its own, so a
            // paging problem can never be shown as if the bookkeeping were incomplete.
            const orphans = nums.filter(function (n) { return !sure[n] && (!counter[n] || !counter[n].length); });
            for (let i = 0; i < orphans.length; i++) {
                const m2 = {};
                try {
                    const lines = await fetchLines(division, 'FinancialYear eq ' + year + ' and EntryNumber eq ' + orphans[i], 'LineNumber', h, { bulkFirst: true, maxPages: 400, meta: m2 });
                    lines.map(mapLine).forEach(function (l) {
                        if (l.glCode === code) return;
                        const k = String(l.entryNumber);
                        if (!counter[k]) counter[k] = [];
                        counter[k].push(l);
                    });
                    if (m2.truncated) errs.push('entry ' + orphans[i] + ': Exact paging was cut off');
                } catch (e) {
                    errs.push('entry ' + orphans[i] + ': ' + e.message);
                }
                await sleep(10);
            }

            // The line on the accrual account itself is the truth: cost centre, period and
            // amount are taken from it, so every cell of the dashboard ties back to the G/L
            // account in Exact Online. The counter lines of the same entry only give the name
            // of the expense account. A single journal entry can carry many accruals for
            // different cost centres and periods, so the counter lines are matched on
            // cost centre + period first, then cost centre, then period, and only after that
            // spread pro rata over the remaining lines of the entry.
            function pick(list, cc, per) {
                const live = list.filter(function (l) { return Math.abs(l.amount) > 0.000001; });
                let s = live.filter(function (l) { return (l.costCenter || '') === cc && String(l.period) === String(per); });
                if (s.length) return s;
                s = live.filter(function (l) { return (l.costCenter || '') === cc; });
                if (s.length) return s;
                s = live.filter(function (l) { return String(l.period) === String(per); });
                if (s.length) return s;
                return live;
            }
            const rows = [];
            base.forEach(function (acc) {
                const target = -acc.amount;
                const cc = acc.costCenter || '';
                const sel = pick(counter[String(acc.entryNumber)] || [], cc, acc.period);
                if (!sel.length) {
                    rows.push({
                        entryNumber: acc.entryNumber, entryId: acc.entryId, date: acc.date,
                        year: acc.year, period: acc.period, glCode: '', glDescription: '',
                        noCounter: true,
                        costCenter: cc, costCenterName: acc.costCenterName,
                        description: acc.description,
                        debit: target > 0 ? target : 0, credit: target < 0 ? -target : 0, amount: target
                    });
                    return;
                }
                const tot = sel.reduce(function (s, l) { return s + Math.abs(l.amount); }, 0);
                let used = 0;
                sel.forEach(function (l, i) {
                    const v = (i === sel.length - 1)
                        ? Math.round((target - used) * 100) / 100
                        : Math.round(target * Math.abs(l.amount) / tot * 100) / 100;
                    used = Math.round((used + v) * 100) / 100;
                    if (Math.abs(v) < 0.000001 && sel.length > 1) return;
                    rows.push({
                        entryNumber: acc.entryNumber, entryId: acc.entryId, date: acc.date,
                        year: acc.year, period: acc.period,
                        glCode: l.glCode, glDescription: l.glDescription,
                        costCenter: cc, costCenterName: acc.costCenterName || l.costCenterName,
                        description: l.description || acc.description,
                        debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0, amount: v
                    });
                });
            });
            // One accrual can be spread over several counter accounts, so the pieces are
            // added up again per entry, cost centre, period and G/L account. This only
            // shortens the list, the amounts stay exactly the same.
            const agg = {};
            const order = [];
            rows.forEach(function (r) {
                const k = r.entryNumber + '|' + r.costCenter + '|' + r.year + '|' + r.period + '|' + r.glCode;
                if (!agg[k]) { agg[k] = r; order.push(k); return; }
                const t = agg[k];
                t.amount = Math.round((t.amount + r.amount) * 100) / 100;
                t.debit = t.amount > 0 ? t.amount : 0;
                t.credit = t.amount < 0 ? -t.amount : 0;
            });
            const outRows = order.map(function (k) { return agg[k]; }).filter(function (r) { return Math.abs(r.amount) > 0.000001; });
            res.json({
                division: division,
                year: year,
                code: code,
                entries: nums.length,
                accrualLines: base.length,
                rows: outRows,
                chunkErrors: errs,
                lastUpdated: new Date().toISOString()
            });
        } catch (e) {
            const status = (e.response && e.response.status) || 500;
            res.status(status === 401 ? 401 : 500).json({
                error: 'Failed to load accrued summary',
                detail: e.message,
                status: status
            });
        }
    });

    router.get('/api/accrued/entry', async function (req, res) {
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
                rows = await fetchLines(division, filters[i], 'LineNumber', h, { bulkFirst: true, maxPages: 400 });
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
