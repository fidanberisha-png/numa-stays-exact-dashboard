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

    // Exact Online counts requests per division per minute and answers 429 when that
    // budget is gone. Waiting for a free slot before asking is friendlier than being
    // refused and retrying, so a division never spends more than BUDGET requests in
    // any rolling minute and a busy entity simply takes a little longer.
    // All the dashboards of this server share the one budget Exact Online counts
    // per division, so the queue lives on the process instead of in this file.
    const RATE = (global.__numaRate = global.__numaRate || {});
    const BUDGET = 55;
    async function slot(division) {
        for (let guard = 0; guard < 200; guard++) {
            if (!RATE[division]) RATE[division] = [];
            const a = RATE[division];
            const now = Date.now();
            while (a.length && now - a[0] > 60000) a.shift();
            if (a.length < BUDGET) { a.push(now); return; }
            const wait = 60000 - (now - a[0]) + 60;
            await sleep(wait > 0 ? wait : 200);
        }
    }

    // A whole financial year of a division is read from Exact in seconds, and the
    // very same year is asked again every time the page is opened or an entity is
    // switched. The finished answer is therefore kept in memory for a while, so
    // opening all entities pays that price only once. The Refresh button asks for
    // fresh data and always goes back to Exact.
    const CACHE = new Map();
    const CACHE_TTL = 20 * 60 * 1000;
    function cacheGet(key, fresh) {
        if (fresh) { CACHE.delete(key); return null; }
        const hit = CACHE.get(key);
        if (!hit) return null;
        if (Date.now() - hit.at > CACHE_TTL) { CACHE.delete(key); return null; }
        return hit.data;
    }
    function cacheSet(key, data) {
        if (CACHE.size > 300) CACHE.clear();
        CACHE.set(key, { at: Date.now(), data: data });
        return data;
    }
    function sendCached(res, key, data) {
        cacheSet(key, data);
        return res.json(data);
    }

    // One journal entry usually carries several of the accrual accounts of an entity.
    // Its lines are therefore kept per division and financial year, so reading nine
    // accounts of one entity does not read the same entry nine times over. This is
    // what keeps the merged view inside the request budget of Exact.
    const LINES = new Map();
    const LINES_TTL = 20 * 60 * 1000;
    function lineKey(division, year, entry) { return division + '|' + year + '|' + entry; }
    function lineGet(division, year, entry) {
        const k = lineKey(division, year, entry);
        const hit = LINES.get(k);
        if (!hit) return null;
        if (Date.now() - hit.at > LINES_TTL) { LINES.delete(k); return null; }
        return hit.rows;
    }
    function lineSet(division, year, entry, rows) {
        if (LINES.size > 8000) LINES.clear();
        LINES.set(lineKey(division, year, entry), { at: Date.now(), rows: rows });
    }

    async function getWithRetry(url, h, attempts) {
        const n = attempts || 4;
        let last = null;
        for (let i = 0; i < n; i++) {
            try {
                return await axios.get(url, { headers: h, timeout: 120000 });
            } catch (e) {
                last = e;
                if (e.response && e.response.status === 429 && e.response.headers) {
                    e.rate = {
                        limit: e.response.headers['x-ratelimit-limit'],
                        remaining: e.response.headers['x-ratelimit-remaining'],
                        minutelyLimit: e.response.headers['x-ratelimit-minutely-limit'],
                        minutelyRemaining: e.response.headers['x-ratelimit-minutely-remaining'],
                        reset: e.response.headers['x-ratelimit-reset'],
                        retryAfter: e.response.headers['retry-after']
                    };
                }
                const status = e.response && e.response.status;
                                // The day budget of a division is gone: retrying only wastes
                                // requests and hides the real reason, so give up right away.
                                const dayLeft = e.rate ? Number(e.rate.remaining) : NaN;
                                if (status === 429 && !isNaN(dayLeft) && dayLeft <= 0) { throw e; }
                if ((status === 429 || status === 503) && i < n - 1) {
                    const retryAfter = e.response.headers && e.response.headers['retry-after'];
                    const wait = retryAfter ? Math.min(Number(retryAfter) * 1000, 20000) : (900 * (i + 1));
                    await sleep(wait);
                    continue;
                }
                throw e;
            }
        }
        throw last;
    }

    // Exact answers 429 both when the minute budget and when the day budget of a
    // division is used up. Its own headers tell which one it is, so the dashboard can
    // say it in plain words instead of showing an empty table.
    function askedTooMuch(e) {
        const st = (e && e.response && e.response.status) || 0;
        if (st !== 429) return null;
        const r = (e && e.rate) || {};
        const dayLeft = Number(r.remaining);
        const minLeft = Number(r.minutelyRemaining);
        if (!isNaN(dayLeft) && dayLeft <= 0) {
            let when = '';
            const ms = Number(r.reset);
            if (!isNaN(ms) && ms > 0) {
                const d = new Date(ms);
                if (!isNaN(d.getTime())) when = ' It is free again on ' + d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC.';
            }
            return 'Exact Online has no requests left today for this entity (day limit ' + (r.limit || '?') + ').' + when;
        }
        if (!isNaN(minLeft) && minLeft <= 0) {
            return 'Exact Online is busy with this entity right now (minute limit ' + (r.minutelyLimit || '?') + '). Try again in a minute.';
        }
        return 'Exact Online refused this request (429). Left today: ' + (r.remaining === undefined ? 'unknown' : r.remaining) + ', left this minute: ' + (r.minutelyRemaining === undefined ? 'unknown' : r.minutelyRemaining) + '.';
    }

    async function fetchAll(division, path, h, maxPages, meta) {
        let url = BASE + '/' + division + '/' + path;
        let rows = [];
        let pages = 0;
        const cap = maxPages || 40;
        while (url && pages < cap) {
            await slot(division);
            const r = await getWithRetry(url, h, 4);
            const d = r.data && r.data.d ? r.data.d : r.data;
            const part = d && d.results ? d.results : (Array.isArray(d) ? d : []);
            rows = rows.concat(part);
            url = d && d.__next ? d.__next : null;
            pages = pages + 1;
            if (url) await sleep(40);
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
        // The summary needs no more than the small set of fields, and every extra
        // variant that Exact refuses costs a whole timeout, so those reads ask for
        // the small set only.
        const small = o.minOnly ? [
            P1 + '?$filter=' + filter + '&$select=' + SELECT_MIN,
            P1 + '?$filter=' + filter
        ] : [
            P1 + '?$filter=' + filter + '&$orderby=' + orderby + '&$select=' + SELECT_FULL,
            P1 + '?$filter=' + filter + '&$select=' + SELECT_FULL,
            P1 + '?$filter=' + filter + '&$select=' + SELECT_MIN,
            P1 + '?$filter=' + filter
        ];
        const bulk = o.minOnly ? [
            P2 + '?$filter=' + filter + '&$select=' + SELECT_MIN,
            P2 + '?$filter=' + filter
        ] : [
            P2 + '?$filter=' + filter + '&$select=' + SELECT_FULL,
            P2 + '?$filter=' + filter + '&$select=' + SELECT_MIN,
            P2 + '?$filter=' + filter
        ];
        // A bulk page holds 1000 lines, a normal page only 60. Month end and year end
        // entries can carry thousands of lines, so bulk is asked first for those.
        const tries = o.bulkFirst ? bulk.concat(small) : small.concat(bulk);
        const cap = o.maxPages || 40;
        let last = null;
        for (let i = 0; i < tries.length; i++) {
            try {
                return await fetchAll(division, tries[i], h, cap, o.meta);
            } catch (e) {
                last = e;
                const st = e.response && e.response.status;
                if (st === 401 || st === 403) throw e;
            }
        }
        throw last;
    }

    // A whole financial year of one G/L account is a heavy scan for Exact Online,
    // and a heavy scan is what runs into the timeout: the year of a large entity
    // like 610 or 900 simply never came back and the screen waited for nothing.
    // The year is therefore asked period by period. Seventeen small reads that run
    // next to each other are far quicker than one big one, and if Exact does not
    // like the period filter the whole year is still asked the old way.
    async function fetchYearLines(division, year, code, h, meta, minOnly) {
        const base = 'FinancialYear eq ' + year +
            " and GLAccountCode ge '" + code + "' and GLAccountCode le '" + code + "zzzz'";
        const parts = new Array(17);
        let failed = null;
        let next = 0;
        async function lane() {
            for (;;) {
                if (failed) return;
                const i = next++;
                if (i > 16) return;
                const m = {};
                try {
                    parts[i] = await fetchLines(division, base + ' and FinancialPeriod eq ' + i, 'EntryNumber', h, { bulkFirst: true, maxPages: 100, meta: m, minOnly: minOnly });
                    if (m.truncated && meta) meta.truncated = true;
                } catch (e) { failed = e; }
            }
        }
        const lanes = [];
        for (let i = 0; i < 6; i++) { lanes.push(lane()); }
        await Promise.all(lanes);
        if (!failed) {
            let all = [];
            for (let i = 0; i < parts.length; i++) { if (parts[i] && parts[i].length) { all = all.concat(parts[i]); } }
            return all;
        }
        return await fetchLines(division, base, 'Date,EntryNumber', h, { bulkFirst: true, maxPages: 400, meta: meta || {}, minOnly: minOnly });
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
    // The accrual accounts Numa uses. Not every entity keeps all of them, so the
    // dashboard asks Exact which ones exist in that division and offers only those.
    const ACCRUAL_CODES = ['251150', '270100', '270200', '271500', '271600', '271900', '272200', '272203', '272205'];

    router.get('/api/accrued/accounts', async function (req, res) {
        const h = headers();
        if (!h) return res.status(401).json({ error: 'Not authenticated' });
        const division = req.query.division ? String(req.query.division) : null;
        if (!division) return res.status(400).json({ error: 'division is required' });
        const fresh = String(req.query.fresh || '') === '1';
        const ckey = 'acc|' + division;
        const hit = cacheGet(ckey, fresh);
        if (hit) return res.json(hit);
        try {
            const path = 'financial/GLAccounts?$select=Code,Description&$filter=' +
                "Code ge '251000' and Code le '273000'";
            const rows = await fetchAll(division, path, h, 40);
            const seen = {};
            const out = [];
            rows.forEach(function (g) {
                const c = String(g.Code || '').trim();
                if (ACCRUAL_CODES.indexOf(c) < 0 || seen[c]) return;
                seen[c] = 1;
                out.push({ code: c, description: String(g.Description || '').trim() });
            });
            out.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
            return sendCached(res, ckey, { division: division, accounts: out, lastUpdated: new Date().toISOString() });
        } catch (e) {
            const status = (e.response && e.response.status) || 500;
            const rl = askedTooMuch(e);
            return res.status(status).json({
                error: rl || 'Failed to load the accrual accounts of this entity',
                detail: (e.response && e.response.data) ? String(e.response.data).slice(0, 400) : e.message
            });
        }
    });

    router.get('/api/accrued/transactions', async function (req, res) {
        const h = headers();
        if (!h) return res.status(401).json({ error: 'Not authenticated' });
        const division = req.query.division ? String(req.query.division) : null;
        const code = req.query.code ? String(req.query.code).trim() : '272200';
        const year = req.query.year ? parseInt(String(req.query.year), 10) : null;
        if (!division) return res.status(400).json({ error: 'division is required' });
        if (!year) return res.status(400).json({ error: 'year is required' });
        const fresh = String(req.query.fresh || '') === '1';
        const ckey = 'tx|' + division + '|' + year + '|' + code;
        const hit = cacheGet(ckey, fresh);
        if (hit) return res.json(hit);
        try {
            const filter = 'FinancialYear eq ' + year +
                " and GLAccountCode ge '" + code + "' and GLAccountCode le '" + code + "zzzz'";
            const rows = await fetchYearLines(division, year, code, h, null, false);
            const lines = rows.map(mapLine).filter(function (l) { return l.glCode === code; });
            return sendCached(res, ckey, {
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
            const rl = askedTooMuch(e);
            res.status(status === 401 ? 401 : (rl ? 429 : 500)).json({
                error: rl || 'Failed to load accrued transactions',
                detail: e.message,
                status: status
            });
        }
    });

    // ---- The accrued summary as a background job ------------------------------
    // The summary of one entity, one financial year and one accrual account used to
    // be built inside the request itself: the journal entries were read sixty at a
    // time, one block strictly after the other, and nothing at all was answered
    // until the very last block was in. A large entity like 610 or 900 therefore
    // left the screen empty for many minutes. The work now runs as a job that reads
    // several blocks of sixty next to each other and hands every finished block over
    // at once, so the dashboard fills itself while Exact Online is still being read.
    // A second request for the same job does not start the work again, it simply
    // takes what is already there.
    const SUMJOBS = new Map();
    const SUM_LANES = 5;
    const SUM_CHUNK = 60;
    function startSummaryJob(key, division, year, code, h) {
        const job = {
            at: Date.now(), done: false, err: null, rows: [], errs: [],
            entries: 0, ready: 0, accrualLines: 0,
            gross: { debit: 0, credit: 0, balance: 0, balanced: true, count: 0 }
        };
        if (SUMJOBS.size > 200) SUMJOBS.clear();
        SUMJOBS.set(key, job);
        (async function () {
            try {
                const filter = 'FinancialYear eq ' + year +
                    " and GLAccountCode ge '" + code + "' and GLAccountCode le '" + code + "zzzz'";
                const baseMeta = {};
                const raw = await fetchYearLines(division, year, code, h, baseMeta, true);
                const base = raw.map(mapLine).filter(function (l) { return l.glCode === code; });
                job.accrualLines = base.length;
                job.gross = totalsOf(base);
                if (baseMeta.truncated) job.errs.push('accrual lines: Exact paging was cut off, the year is incomplete');
                const want = {};
                const nums = [];
                const byEntry = {};
                base.forEach(function (l) {
                    const k = String(l.entryNumber);
                    if (!k) return;
                    if (!want[k]) { want[k] = 1; nums.push(k); byEntry[k] = []; }
                    byEntry[k].push(l);
                });
                job.entries = nums.length;
                const counter = {};
                // An entry whose lines are known is marked, so the second pass below can
                // tell a real bookkeeping gap from an entry that was simply never read.
                const done = {};
                function useLines(n, all) {
                    done[n] = 1;
                    const keep = all.filter(function (l) { return l.glCode !== code; });
                    if (keep.length) { counter[n] = keep; } else { delete counter[n]; }
                }
                async function grab(list) {
                    if (!list.length) return;
                    const need = list.filter(function (n) {
                        const c = lineGet(division, year, n);
                        if (!c) return true;
                        useLines(n, c);
                        return false;
                    });
                    if (!need.length) return;
                    list = need;
                    const f = 'FinancialYear eq ' + year + ' and (' + list.map(function (n) { return 'EntryNumber eq ' + n; }).join(' or ') + ')';
                    const meta = {};
                    try {
                        const lines = await fetchLines(division, f, 'EntryNumber', h, { bulkFirst: true, maxPages: 400, meta: meta });
                        const got = {};
                        lines.map(mapLine).forEach(function (l) {
                            const k = String(l.entryNumber);
                            if (!want[k]) return;
                            if (!got[k]) got[k] = [];
                            got[k].push(l);
                        });
                        if (!meta.truncated) {
                            list.forEach(function (n) { lineSet(division, year, n, got[n] || []); });
                        }
                        list.forEach(function (n) { useLines(n, got[n] || []); });
                        if (meta.truncated && list.length > 1) {
                            // Half of a journal entry is worse than no answer, so the block is
                            // thrown away and asked again in smaller pieces.
                            list.forEach(function (n) { delete counter[n]; delete done[n]; });
                            const half2 = Math.ceil(list.length / 2);
                            await grab(list.slice(0, half2));
                            await grab(list.slice(half2));
                        } else if (meta.truncated) {
                            job.errs.push('entry ' + list[0] + ': Exact paging was cut off');
                        }
                    } catch (e) {
                        if (list.length > 1) {
                            const half = Math.ceil(list.length / 2);
                            await grab(list.slice(0, half));
                            await grab(list.slice(half));
                        } else {
                            job.errs.push('entries ' + list[0] + ' - ' + list[list.length - 1] + ': ' + e.message);
                        }
                    }
                }
                // The line on the accrual account itself is the truth: cost centre, period
                // and amount are taken from it, so every cell of the dashboard ties back to
                // the G/L account in Exact Online. The counter lines of the same entry only
                // give the name of the expense account. A single journal entry can carry
                // many accruals for different cost centres and periods, so the counter
                // lines are matched on cost centre + period first, then cost centre, then
                // period, and only after that spread pro rata over the remaining lines.
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
                // The rows of a block of entries. An entry that was not read at all is left
                // for the second pass, so a paging problem is never shown as if the
                // bookkeeping were incomplete.
                function buildRows(list, final) {
                    const rows = [];
                    list.forEach(function (n) {
                        if (!final && !done[n]) return;
                        (byEntry[n] || []).forEach(function (acc) {
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
                    });
                    // One accrual can be spread over several counter accounts, so the pieces
                    // are added up again per entry, cost centre, period and G/L account. This
                    // only shortens the list, the amounts stay exactly the same.
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
                    return order.map(function (k) { return agg[k]; }).filter(function (r) { return Math.abs(r.amount) > 0.000001; });
                }
                // Sixty entries per request keeps the number of calls to Exact low. Five
                // blocks are on their way at the same time and every block that comes back
                // is handed over at once, so the sixty rows just read are on the screen
                // while the next sixty are still being fetched.
                const chunks = [];
                for (let i = 0; i < nums.length; i += SUM_CHUNK) { chunks.push(nums.slice(i, i + SUM_CHUNK)); }
                let nextChunk = 0;
                async function chunkLane() {
                    for (;;) {
                        const ci = nextChunk++;
                        if (ci >= chunks.length) return;
                        const list = chunks[ci];
                        await grab(list);
                        const part = buildRows(list, false);
                        if (part.length) { job.rows = job.rows.concat(part); }
                        job.ready = job.ready + list.length;
                    }
                }
                const lanes = [];
                const wide = Math.min(SUM_LANES, chunks.length);
                for (let i = 0; i < wide; i++) { lanes.push(chunkLane()); }
                await Promise.all(lanes);
                // Second pass: an entry that still has no counter line is asked on its own.
                const orphans = nums.filter(function (n) { return (!counter[n] || !counter[n].length) && !done[n]; });
                let nextOrphan = 0;
                async function orphanLane() {
                    for (;;) {
                        const oi = nextOrphan++;
                        if (oi >= orphans.length) return;
                        const n = orphans[oi];
                        const m2 = {};
                        try {
                            const lines = await fetchLines(division, 'FinancialYear eq ' + year + ' and EntryNumber eq ' + n, 'LineNumber', h, { bulkFirst: true, maxPages: 400, meta: m2 });
                            const all2 = lines.map(mapLine);
                            if (!m2.truncated) lineSet(division, year, n, all2);
                            useLines(n, all2);
                            if (m2.truncated) job.errs.push('entry ' + n + ': Exact paging was cut off');
                        } catch (e) {
                            job.errs.push('entry ' + n + ': ' + e.message);
                        }
                        const part = buildRows([n], true);
                        if (part.length) { job.rows = job.rows.concat(part); }
                    }
                }
                const olanes = [];
                const owide = Math.min(SUM_LANES, orphans.length);
                for (let i = 0; i < owide; i++) { olanes.push(orphanLane()); }
                await Promise.all(olanes);
            } catch (e) {
                job.err = e;
            }
            job.done = true;
        })();
        return job;
    }
    
    router.get('/api/accrued/summary', async function (req, res) {
        const h = headers();
        if (!h) return res.status(401).json({ error: 'Not authenticated' });
        const division = req.query.division ? String(req.query.division) : null;
        const code = req.query.code ? String(req.query.code).trim() : '272200';
        const year = req.query.year ? parseInt(String(req.query.year), 10) : null;
        if (!division) return res.status(400).json({ error: 'division is required' });
        if (!year) return res.status(400).json({ error: 'year is required' });
        const fresh = String(req.query.fresh || '') === '1';
        const ckey = 'sum|' + division + '|' + year + '|' + code;
        const hit = cacheGet(ckey, fresh);
        if (hit) return res.json(hit);
        let job = SUMJOBS.get(ckey);
        if (fresh && job && job.done) { SUMJOBS.delete(ckey); job = null; }
        if (!job) { job = startSummaryJob(ckey, division, year, code, h); }
        // The request waits a short while and then answers with whatever is read by
        // then, together with how far the job is. The dashboard paints that and asks
        // again a few seconds later, so the table grows instead of staying empty.
        const until = Date.now() + 20000;
        while (!job.done && Date.now() < until) { await sleep(300); }
        if (job.done && job.err) {
            SUMJOBS.delete(ckey);
            const e = job.err;
            const status = (e.response && e.response.status) || 500;
            const rl = askedTooMuch(e);
            return res.status(status === 401 ? 401 : (rl ? 429 : 500)).json({
                error: rl || 'Failed to load accrued summary',
                detail: e.message,
                status: status
            });
        }
        const payload = {
            division: division,
            year: year,
            code: code,
            entries: job.entries,
            accrualLines: job.accrualLines,
            accountTotals: job.gross,
            rows: job.rows.slice(),
            chunkErrors: job.errs.slice(),
            lastUpdated: new Date().toISOString()
        };
        if (!job.done) {
            payload.partial = true;
            payload.loading = { done: job.ready, total: job.entries, rows: payload.rows.length };
            return res.json(payload);
        }
        SUMJOBS.delete(ckey);
        return sendCached(res, ckey, payload);
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
