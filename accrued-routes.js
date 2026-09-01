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
    const RATE = {};
    const BUDGET = 50;
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
    const CACHE_TTL = 2 * 60 * 60 * 1000;
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
    const LINES_TTL = 2 * 60 * 60 * 1000;
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
  // A Refresh has to go back to Exact for real, so the remembered lines of that
  // division and financial year are thrown away together with the answer.
  function lineDrop(division, year) {
    const p = division + '|' + year + '|';
    const kill = [];
    LINES.forEach(function (v, k) { if (k.indexOf(p) === 0) { kill.push(k); } });
    kill.forEach(function (k) { LINES.delete(k); });
  }

  // Next to the minute budget Exact Online keeps a day budget per company. Once
  // that is gone every further call is refused, so the company is put aside until
  // the reset Exact names and the dashboard is told in plain words instead of
  // spending the rest of the budget on refusals.
  const BLOCKED = {};
  function divOfUrl(u) { const m = /\/api\/v1\/(\d+)\//.exec(String(u || '')); return m ? m[1] : 'x'; }
  function blockNote(division) {
    const b = BLOCKED[division];
    if (!b) { return null; }
    if (b.until && Date.now() > b.until) { delete BLOCKED[division]; return null; }
    return b.message;
  }
  function noteRefusal(division, e) {
    const rs = e && e.response;
    if (!rs || rs.status !== 429 || !rs.headers) { return; }
    const left = Number(rs.headers['x-ratelimit-remaining']);
    if (isNaN(left) || left > 0) { return; }
    const ms = Number(rs.headers['x-ratelimit-reset']);
    const until = (!isNaN(ms) && ms > Date.now()) ? ms : (Date.now() + 30 * 60 * 1000);
    const when = new Date(until);
    const stamp = isNaN(when.getTime()) ? 'the next reset' : (when.toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
    BLOCKED[division] = { until: until, message: 'Exact Online has no calls left today for this entity (day limit ' + (rs.headers['x-ratelimit-limit'] || '?') + '). It is free again on ' + stamp + '.' };
  }

    async function getWithRetry(url, h, attempts) {
        const n = attempts || 5;
        let last = null;
        for (let i = 0; i < n; i++) {
            try {
        const dvv = divOfUrl(url);
        const stopMsg = blockNote(dvv);
        if (stopMsg) { const be = new Error(stopMsg); be.blocked = true; throw be; }
        return await axios.get(url, { headers: h, timeout: 30000 });
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
      noteRefusal(divOfUrl(url), e);
      if (status === 429 && !isNaN(dayLeft) && dayLeft <= 0) { throw e; }
                if ((status === 429 || status === 503 || status === 504 || !e.response) && i < n - 1) {
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
            if (url) await sleep(150);
        }
        // A page limit that is hit silently is what used to make counter lines disappear,
        // so the caller is told about it instead of getting half of the journal entry.
        if (url && meta) meta.truncated = true;
    if (meta) { meta.pages = (meta.pages || 0) + pages; }
        return rows;
    }
    const SELECT_FULL = 'Date,EntryID,EntryNumber,JournalCode,JournalDescription,Description,AccountCode,AccountName,AmountDC,FinancialPeriod,FinancialYear,GLAccountCode,GLAccountDescription,LineNumber,Status,CostCenter,CostCenterDescription';
    const SELECT_MIN = 'Date,EntryID,EntryNumber,JournalCode,Description,AmountDC,FinancialPeriod,FinancialYear,GLAccountCode,GLAccountDescription,LineNumber,CostCenter,CostCenterDescription';

  // Exact Online is picky about paths, $select and $orderby on transaction lines,
  // so every query is tried in a few variants until one succeeds. Two things were
  // learned the hard way and they decide the speed of the whole dashboard: a bulk
  // page holds a thousand lines where a normal page holds sixty, but bulk refuses
  // every filter that names a G/L account. A G/L question is therefore never asked
  // in bulk, everything else is asked in bulk first, and the variant that worked
  // for a company is remembered so the refused ones are not paid for again.
  const VARIANT = {};
  async function fetchLines(division, filter, orderby, h, opts) {
    const o = opts || {};
    const P1 = 'financialtransaction/TransactionLines';
    const P2 = 'bulk/Financial/TransactionLines';
    const mk = {
      b1: P2 + '?$filter=' + filter + '&$select=' + SELECT_FULL,
      b2: P2 + '?$filter=' + filter + '&$select=' + SELECT_MIN,
      b3: P2 + '?$filter=' + filter,
      s1: P1 + '?$filter=' + filter + '&$orderby=' + orderby + '&$select=' + SELECT_FULL,
      s2: P1 + '?$filter=' + filter + '&$select=' + SELECT_FULL,
      s3: P1 + '?$filter=' + filter + '&$select=' + SELECT_MIN,
      s4: P1 + '?$filter=' + filter
    };
    const hasGl = filter.indexOf('GLAccountCode') > -1;
    let tags = hasGl
      ? ['s1', 's2', 's3', 's4']
      : (o.bulkFirst ? ['b1', 'b2', 'b3', 's1', 's2', 's3', 's4'] : ['s1', 's2', 's3', 's4', 'b1', 'b2', 'b3']);
    const wkey = division + '|' + (hasGl ? 'gl' : 'plain') + '|' + (o.bulkFirst ? 'b' : 's');
    const won = VARIANT[wkey];
    if (won && mk[won] && tags.indexOf(won) > 0) {
      tags = [won].concat(tags.filter(function (t) { return t !== won; }));
    }
    const cap = o.maxPages || 40;
    let last = null;
    for (let i = 0; i < tags.length; i++) {
      try {
        const rows = await fetchAll(division, mk[tags[i]], h, cap, o.meta);
        VARIANT[wkey] = tags[i];
        return rows;
      } catch (e) {
        last = e;
        const st = e.response && e.response.status;
        if (st === 401 || st === 403) throw e;
        // A refusal is about the budget of the company, not about the variant:
        // asking the same question in another shape only burns more of it.
        if (st === 429 || e.blocked) throw e;
      }
    }
    throw last;
  }

  // The lines that sit on the accrual account itself. In some companies Exact
  // keeps the code padded, so the plain question is asked first and the wider
  // one only when it stays empty.
  async function accrualLines(division, year, code, h, meta) {
    const f1 = 'FinancialYear eq ' + year + " and GLAccountCode eq '" + code + "'";
    let rows = await fetchLines(division, f1, 'Date,EntryNumber', h, { maxPages: 400, meta: meta });
    let lines = rows.map(mapLine).filter(function (l) { return l.glCode === code; });
    if (!lines.length) {
      const f2 = 'FinancialYear eq ' + year +
        " and GLAccountCode ge '" + code + "' and GLAccountCode le '" + code + "zzzz'";
      rows = await fetchLines(division, f2, 'Date,EntryNumber', h, { maxPages: 400, meta: meta });
      lines = rows.map(mapLine).filter(function (l) { return l.glCode === code; });
    }
    return lines;
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
      const lines = await accrualLines(division, year, code, h, null);
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

  // One entity, one financial year, one accrual account: this is the whole read.
  // It is kept in one function so the route, a Refresh and anything that wants to
  // warm the numbers all walk exactly the same way through Exact Online.
  async function summaryPayload(division, year, code, h, fresh) {
    const ckey = 'sum|' + division + '|' + year + '|' + code;
    const hit = cacheGet(ckey, fresh);
    if (hit) { return hit; }
    if (fresh) { lineDrop(division, year); }
    const baseMeta = {};
    const base = await accrualLines(division, year, code, h, baseMeta);
            const want = {};
            const nums = [];
            base.forEach(function (l) {
                const k = String(l.entryNumber);
                if (!k) return;
                if (!want[k]) { want[k] = 1; nums.push(k); }
            });
            const counter = {};
            const errs = [];
            if (baseMeta.truncated) errs.push('accrual lines: Exact paging was cut off, the year is incomplete');
            // An entry whose lines are known is marked, so the second pass below can tell
            // a real bookkeeping gap from an entry that was simply never read.
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
                    const byEntry = {};
                    lines.map(mapLine).forEach(function (l) {
                        const k = String(l.entryNumber);
                        if (!want[k]) return;
                        if (!byEntry[k]) byEntry[k] = [];
                        byEntry[k].push(l);
                    });
                    if (!meta.truncated) {
                        list.forEach(function (n) { lineSet(division, year, n, byEntry[n] || []); });
                    }
                    list.forEach(function (n) { useLines(n, byEntry[n] || []); });
                    if (meta.truncated && list.length > 1) {
                        // Half of a journal entry is worse than no answer, so the block is
                        // thrown away and asked again in smaller pieces.
                        list.forEach(function (n) { delete counter[n]; delete done[n]; });
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
            // Sixty entries per request keeps the number of calls to Exact low, and the
            // split on truncation above still guarantees a whole entry is never half read.
    // Sixty entries fit in one question and a bulk page holds a thousand lines, so
    // a few of those questions are asked next to each other. The rate limiter above
    // still decides how fast they may leave, so Exact is never flooded.
    const batches = [];
    for (let i = 0; i < nums.length; i += 60) { batches.push(nums.slice(i, i + 60)); }
    let bnext = 0;
    async function bLane() {
      while (bnext < batches.length) {
        const bb = batches[bnext];
        bnext = bnext + 1;
        await grab(bb);
        await sleep(60);
      }
    }
    const blanes = [];
    for (let q = 0; q < 3 && q < batches.length; q++) { blanes.push(bLane()); }
    await Promise.all(blanes);
            // Second pass: an entry that still has no counter line is asked on its own, so a
            // paging problem can never be shown as if the bookkeeping were incomplete.
            const orphans = nums.filter(function (n) { return (!counter[n] || !counter[n].length) && !done[n]; });
            for (let i = 0; i < orphans.length; i++) {
                const m2 = {};
                try {
                    const lines = await fetchLines(division, 'FinancialYear eq ' + year + ' and EntryNumber eq ' + orphans[i], 'LineNumber', h, { bulkFirst: true, maxPages: 400, meta: m2 });
                    const all2 = lines.map(mapLine);
                    if (!m2.truncated) lineSet(division, year, orphans[i], all2);
                    useLines(orphans[i], all2);
                    if (m2.truncated) errs.push('entry ' + orphans[i] + ': Exact paging was cut off');
                } catch (e) {
                    errs.push('entry ' + orphans[i] + ': ' + e.message);
                }
                await sleep(120);
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
    return cacheSet(ckey, {
      division: division,
      year: year,
      code: code,
      entries: nums.length,
      accrualLines: base.length,
      accountTotals: totalsOf(base),
      rows: outRows,
      chunkErrors: errs,
      lastUpdated: new Date().toISOString()
    });
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
    try {
      const data = await summaryPayload(division, year, code, h, fresh);
      return res.json(data);
    } catch (e) {
      const status = (e.response && e.response.status) || (e.blocked ? 429 : 500);
      const rl = askedTooMuch(e) || (e.blocked ? e.message : null);
      return res.status(status === 401 ? 401 : (rl ? 429 : 500)).json({
        error: rl || 'Failed to load accrued summary',
        detail: e.message,
        status: status
      });
    }
  });

  // Diagnostic: what one read of an entity really costs at Exact Online.
  router.get('/api/accrued/diag', async function (req, res) {
    const h = headers();
    if (!h) return res.status(401).json({ error: 'Not authenticated' });
    const division = req.query.division ? String(req.query.division) : null;
    const year = req.query.year ? parseInt(String(req.query.year), 10) : 2026;
    const code = req.query.code ? String(req.query.code).trim() : '272200';
    if (!division) return res.status(400).json({ error: 'division is required' });
    const started = Date.now();
    const meta = {};
    try {
      const base = await accrualLines(division, year, code, h, meta);
      const seen = {};
      base.forEach(function (l) { seen[String(l.entryNumber)] = 1; });
      return res.json({
        division: division, year: year, code: code,
        accrualLines: base.length, entries: Object.keys(seen).length,
        pages: meta.pages || 0, truncated: !!meta.truncated,
        ms: Date.now() - started,
        variants: VARIANT,
        callsThisMinute: (RATE[division] || []).length,
        blocked: blockNote(division)
      });
    } catch (e) {
      return res.status(500).json({ error: e.message, refused: askedTooMuch(e) || blockNote(division), ms: Date.now() - started });
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
