// PrePaid dashboard API for Numa Stays.
// The prepaid G/L account (160100) is read live from Exact Online and the whole
// amortisation schedule is built here, on the server, so the page only draws
// what Exact really contains. Amounts are never changed: they are only spread
// over the months that the invoice covers.
const express = require('express');
const axios = require('axios');

const REGION = process.env.EXACT_REGION || 'nl';
const BASE = 'https://start.exactonline.' + REGION + '/api/v1';
const TTL = 10 * 60 * 1000;
const cache = {};

// Journal 91 is the automatic journal, nothing is typed into it by hand, so it
// is the reference. The other journals are manual and the same invoice can sit
// in more than one of them. Only one amount per invoice is kept, otherwise the
// prepaid total is counted twice.
const REF_JOURNAL = '91';

function cacheGet(key, fresh) {
    if (fresh) return null;
    const hit = cache[key];
    if (!hit) return null;
    if (Date.now() - hit.at > TTL) { delete cache[key]; return null; }
    return hit.val;
}

function cacheSet(key, val) {
    cache[key] = { at: Date.now(), val: val };
    return val;
}

function txt(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function r2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function isDigit(c) { return c >= '0' && c <= '9'; }
function isSep(c) { return c === '-' || c === '.' || c === '/'; }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function dmy(y, m, d) { return pad2(d) + '-' + pad2(m) + '-' + y; }
function mIndex(y, m) { return y * 12 + (m - 1); }
function readNum(s, i) {
    let v = 0, n = 0;
    while (i + n < s.length && isDigit(s.charAt(i + n))) { v = v * 10 + (s.charCodeAt(i + n) - 48); n++; }
    return { value: v, len: n };
}

// Dates are read out of free text on purpose without regular expressions,
// so a strange description can never break the whole dashboard.
function findDates(s) {
    const out = [];
    let depth = 0, i = 0;
    while (i < s.length) {
        const ch = s.charAt(i);
        if (ch === '(') { depth++; i++; continue; }
        if (ch === ')') { if (depth > 0) depth--; i++; continue; }
        if (!isDigit(ch)) { i++; continue; }
        const a = readNum(s, i);
        let j = i + a.len;
        if (!isSep(s.charAt(j))) { i = j; continue; }
        const b = readNum(s, j + 1);
        if (!b.len) { i = j + 1; continue; }
        const k = j + 1 + b.len;
        if (!isSep(s.charAt(k))) { i = k; continue; }
        const c = readNum(s, k + 1);
        if (!c.len) { i = k + 1; continue; }
        let y, m, d;
        if (a.len === 4) { y = a.value; m = b.value; d = c.value; }
        else { d = a.value; m = b.value; y = c.value; }
        if (y < 100) y = y + 2000;
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100) out.push({ y: y, m: m, d: d, paren: depth > 0 });
        i = k + 1 + c.len;
    }
    return out;
}

// The period an invoice covers, taken from its description. Dates between
// brackets win, because a description often also carries an invoice date.
function period(desc) {
    const all = findDates(txt(desc));
    const inside = all.filter(function (x) { return x.paren; });
    const use = inside.length >= 2 ? inside : all;
    if (use.length < 2) return null;
    const a = use[0], b = use[1];
    if (mIndex(b.y, b.m) < mIndex(a.y, a.m)) return null;
    return { start: a, end: b, from: inside.length >= 2 ? 'brackets' : 'text' };
}

function exactDate(v) {
    const s = txt(v);
    if (!s) return null;
    let t = null;
    const p = s.indexOf('Date(');
    if (p >= 0) {
        const n = readNum(s, p + 5);
        if (n.len) t = n.value;
    } else {
        const d0 = new Date(s);
        if (!isNaN(d0.getTime())) t = d0.getTime();
    }
    if (t === null) return null;
    const d = new Date(t);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), t: t };
}

// One key per invoice amount. The same invoice booked in two journals gives the
// same key, so it is only counted once.
function dupKey(invoice, amount, description, dt) {
    const s = String(invoice || '').toLowerCase();
    let clean = '';
    for (let i = 0; i < s.length; i++) {
        const c = s.charAt(i);
        if ((c >= 'a' && c <= 'z') || isDigit(c)) clean = clean + c;
    }
    if (!clean) clean = 'd' + String(description || '').toLowerCase().slice(0, 40) + '|' + (dt ? dt.t : '');
    return clean + '|' + r2(amount).toFixed(2);
}

module.exports = function (getToken) {
    const router = express.Router();

    function headers() {
        const t = getToken();
        if (!t || !t.access_token) return null;
        return { Authorization: 'Bearer ' + t.access_token, Accept: 'application/json' };
    }

    async function fetchAll(division, path, h, cap) {
        let url = BASE + '/' + division + '/' + path;
        const out = [];
        let page = 0;
        while (url) {
            const r = await axios.get(url, { headers: h, timeout: 60000 });
            const d = (r.data && r.data.d) ? r.data.d : {};
            const rows = d.results || (Array.isArray(d) ? d : []);
            rows.forEach(function (x) { out.push(x); });
            url = d.__next || null;
            page += 1;
            if (page >= cap && url) {
                const e = new Error('Exact cut off the paging after ' + page + ' pages');
                e.truncated = true;
                throw e;
            }
        }
        return out;
    }

    const SEL = 'Date,EntryID,EntryNumber,JournalCode,JournalDescription,Description,AmountDC,FinancialPeriod,FinancialYear,GLAccountCode,GLAccountDescription,CostCenter,CostCenterDescription,CostUnit,CostUnitDescription,AccountCode,AccountName,InvoiceNumber,YourRef,Document,LineNumber';
    const SEL_MIN = 'Date,EntryNumber,JournalCode,Description,AmountDC,FinancialPeriod,FinancialYear,GLAccountCode,GLAccountDescription,CostCenter,CostCenterDescription,AccountName,YourRef';

    function mapLine(r) {
        const amt = Number(r.AmountDC) || 0;
        return {
            date: r.Date || null,
            entryNumber: r.EntryNumber,
            journalCode: txt(r.JournalCode),
            journalName: txt(r.JournalDescription),
            description: txt(r.Description),
            invoice: txt(r.YourRef) || txt(r.InvoiceNumber) || txt(r.Document),
            costCenter: txt(r.CostCenter),
            costCenterName: txt(r.CostCenterDescription),
            costUnit: txt(r.CostUnit),
            costUnitName: txt(r.CostUnitDescription),
            glCode: txt(r.GLAccountCode),
            glDescription: txt(r.GLAccountDescription),
            supplier: txt(r.AccountName),
            period: r.FinancialPeriod,
            year: r.FinancialYear,
            amount: amt,
            debit: amt > 0 ? amt : 0,
            credit: amt < 0 ? -amt : 0
        };
    }

    // Exact is picky about the select on transaction lines, so the full select is
    // asked first and a smaller one after that.
    async function lines(division, filter, h) {
        const tries = [
            'bulk/Financial/TransactionLines?$select=' + SEL + '&$filter=' + filter,
            'bulk/Financial/TransactionLines?$select=' + SEL_MIN + '&$filter=' + filter,
            'financialtransaction/TransactionLines?$select=' + SEL_MIN + '&$filter=' + filter
        ];
        let last = null;
        for (let i = 0; i < tries.length; i++) {
            try {
                return await fetchAll(division, tries[i], h, 200);
            } catch (e) {
                last = e;
                const st = (e.response && e.response.status) || 0;
                if (st === 401 || st === 403 || e.truncated) throw e;
            }
        }
        throw last;
    }

    function fail(res, e, msg) {
        const status = (e.response && e.response.status) || 500;
        return res.status(status === 401 ? 401 : (status === 403 ? 403 : 500)).json({
            error: e.truncated ? e.message : msg,
            detail: (e.response && e.response.data) ? String(e.response.data).slice(0, 400) : e.message
        });
    }

    // The same invoice can be booked in the automatic journal and again by hand.
    // Only one amount per invoice survives, the reference journal wins.
    function dedupe(rows, prefer) {
        const pref = txt(prefer) || REF_JOURNAL;
        const order = rows.slice().sort(function (a, b) {
            const pa = a.journalCode === pref ? 0 : 1;
            const pb = b.journalCode === pref ? 0 : 1;
            if (pa !== pb) return pa - pb;
            if (a.journalCode !== b.journalCode) return a.journalCode < b.journalCode ? -1 : 1;
            return (a.entryNumber || 0) - (b.entryNumber || 0);
        });
        const seen = {};
        const kept = [];
        const dropped = [];
        order.forEach(function (l) {
            const k = dupKey(l.invoice, l.amount, l.description, exactDate(l.date));
            if (seen[k]) {
                dropped.push({
                    invoice: l.invoice, journal: l.journalCode, keptInJournal: seen[k],
                    amount: r2(l.amount), description: l.description
                });
                return;
            }
            seen[k] = l.journalCode || '-';
            kept.push(l);
        });
        return { kept: kept, dropped: dropped };
    }

    // The prepaid accounts that the chosen entity really has in Exact.
    router.get('/api/prepaid/accounts', async function (req, res) {
        const h = headers();
        if (!h) return res.status(401).json({ error: 'Not authenticated' });
        const division = req.query.division ? String(req.query.division) : null;
        if (!division) return res.status(400).json({ error: 'division is required' });
        const fresh = String(req.query.fresh || '') === '1';
        const ckey = 'pacc|' + division;
        const hit = cacheGet(ckey, fresh);
        if (hit) return res.json(hit);
        try {
            const path = "financial/GLAccounts?$select=Code,Description&$filter=Code ge '160000' and Code le '169999'";
            const rows = await fetchAll(division, path, h, 40);
            const seen = {};
            const out = [];
            rows.forEach(function (g) {
                const c = txt(g.Code);
                if (!c || seen[c]) return;
                seen[c] = 1;
                out.push({ code: c, description: txt(g.Description) });
            });
            out.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
            return res.json(cacheSet(ckey, { division: division, accounts: out, lastUpdated: new Date().toISOString() }));
        } catch (e) {
            return fail(res, e, 'Failed to load the prepaid accounts of this entity');
        }
    });

    // Everything the page needs: the journals, the clean invoice list and the
    // month by month amortisation of the chosen financial year.
    router.get('/api/prepaid/schedule', async function (req, res) {
        const h = headers();
        if (!h) return res.status(401).json({ error: 'Not authenticated' });
        const division = req.query.division ? String(req.query.division) : null;
        const code = req.query.code ? String(req.query.code).trim() : '160100';
        const year = req.query.year ? parseInt(String(req.query.year), 10) : null;
        const journal = txt(req.query.journal);
        const mode = txt(req.query.mode) === 'invoice' ? 'invoice' : 'period';
        const until = txt(req.query.until) || 'year';
        if (!division) return res.status(400).json({ error: 'division is required' });
        if (!year) return res.status(400).json({ error: 'year is required' });
        const fresh = String(req.query.fresh || '') === '1';
        const ckey = 'psch|' + division + '|' + year + '|' + code + '|' + journal + '|' + mode + '|' + until;
        const hit = cacheGet(ckey, fresh);
        if (hit) return res.json(hit);
        try {
            const filter = 'FinancialYear eq ' + year +
                " and GLAccountCode ge '" + code + "' and GLAccountCode le '" + code + "zzzz'";
            const raw = await lines(division, filter, h);
            const all = raw.map(mapLine).filter(function (l) { return l.amount !== 0; });

            // What every journal holds, counted before anything is left out.
            const jmap = {};
            all.forEach(function (l) {
                const c = l.journalCode || '-';
                if (!jmap[c]) jmap[c] = { code: c, description: l.journalName || '', count: 0, debit: 0, credit: 0 };
                if (!jmap[c].description && l.journalName) jmap[c].description = l.journalName;
                jmap[c].count += 1;
                jmap[c].debit += l.debit;
                jmap[c].credit += l.credit;
            });
            const journals = Object.keys(jmap).sort().map(function (k) {
                const j = jmap[k];
                return {
                    code: j.code, description: j.description, count: j.count,
                    debit: r2(j.debit), credit: r2(j.credit), net: r2(j.debit - j.credit),
                    automatic: j.code === REF_JOURNAL
                };
            });

            let scope = all;
            if (journal && journal !== 'all') scope = all.filter(function (l) { return l.journalCode === journal; });
            const debits = scope.filter(function (l) { return l.amount > 0; });
            const credits = scope.filter(function (l) { return l.amount < 0; });
            const clean = dedupe(debits, (journal && journal !== 'all') ? journal : REF_JOURNAL);

            let cut;
            if (until === 'today') {
                const n = new Date();
                cut = { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1 };
            } else if (until !== 'year') {
                const ds = findDates(until);
                cut = ds.length ? { y: ds[0].y, m: ds[0].m } : { y: year, m: 12 };
            } else {
                cut = { y: year, m: 12 };
            }

            const rows = [];
            const skipped = [];
            clean.kept.sort(function (a, b) {
                const da = exactDate(a.date), db = exactDate(b.date);
                return ((da ? da.t : 0) - (db ? db.t : 0)) || ((a.entryNumber || 0) - (b.entryNumber || 0));
            });
            clean.kept.forEach(function (l) {
                const dt = exactDate(l.date);
                const p = period(l.description);
                const base = {
                    date: dt ? dmy(dt.y, dt.m, dt.d) : '',
                    journal: l.journalCode,
                    invoice: l.invoice,
                    description: l.description,
                    supplier: l.supplier,
                    amount: r2(l.amount)
                };
                if (!p) { skipped.push(base); return; }
                let sy = p.start.y, sm = p.start.m, sd = p.start.d;
                if (mode === 'invoice' && dt && mIndex(dt.y, dt.m) < mIndex(sy, sm)) { sy = dt.y; sm = dt.m; sd = 1; }
                const months = mIndex(p.end.y, p.end.m) - mIndex(sy, sm) + 1;
                if (months <= 0) { skipped.push(base); return; }
                const monthly = l.amount / months;
                let used = mIndex(cut.y, cut.m) - mIndex(sy, sm) + 1;
                if (used < 0) used = 0;
                if (used > months) used = months;
                const expensed = r2(monthly * used);
                rows.push({
                    no: rows.length + 1,
                    date: base.date,
                    sort: dt ? dt.t : 0,
                    cost: l.costCenter || l.costUnit || '',
                    costName: l.costCenterName || l.costUnitName || '',
                    acc: l.costUnit || l.glCode || '',
                    accName: l.costUnitName || l.glDescription || '',
                    description: l.description,
                    supplier: l.supplier,
                    invoice: l.invoice,
                    journal: l.journalCode,
                    journalName: l.journalName,
                    entryNumber: l.entryNumber,
                    total: r2(l.amount),
                    start: dmy(sy, sm, mode === 'invoice' ? 1 : sd),
                    end: dmy(p.end.y, p.end.m, p.end.d),
                    months: months,
                    used: used,
                    left: months - used,
                    monthly: r2(monthly),
                    expensed: expensed,
                    prepaid: r2(l.amount - expensed)
                });
            });

            let tAmount = 0, tExpensed = 0, tPrepaid = 0;
            rows.forEach(function (r) { tAmount += r.total; tExpensed += r.expensed; tPrepaid += r.prepaid; });
            let released = 0;
            credits.forEach(function (l) { released += l.credit; });
            let tSkipped = 0;
            skipped.forEach(function (s) { tSkipped += s.amount; });

            return res.json(cacheSet(ckey, {
                division: division, year: year, code: code,
                journal: journal || 'all', mode: mode, until: until,
                cut: dmy(cut.y, cut.m, 1),
                referenceJournal: REF_JOURNAL,
                journals: journals,
                rows: rows,
                skipped: skipped,
                duplicates: clean.dropped,
                totals: {
                    count: rows.length,
                    amount: r2(tAmount),
                    expensed: r2(tExpensed),
                    prepaid: r2(tPrepaid),
                    released: r2(released),
                    skipped: r2(tSkipped),
                    skippedCount: skipped.length,
                    duplicates: clean.dropped.length,
                    duplicateAmount: r2(clean.dropped.reduce(function (s, d) { return s + d.amount; }, 0))
                },
                lastUpdated: new Date().toISOString()
            }));
        } catch (e) {
            return fail(res, e, 'Failed to build the prepaid schedule of this entity');
        }
    });

    // Raw lines of one prepaid account for one financial year, kept for checking
    // the schedule against Exact. Nothing is left out here.
    router.get('/api/prepaid/lines', async function (req, res) {
        const h = headers();
        if (!h) return res.status(401).json({ error: 'Not authenticated' });
        const division = req.query.division ? String(req.query.division) : null;
        const code = req.query.code ? String(req.query.code).trim() : '160100';
        const year = req.query.year ? parseInt(String(req.query.year), 10) : null;
        const journal = txt(req.query.journal);
        if (!division) return res.status(400).json({ error: 'division is required' });
        if (!year) return res.status(400).json({ error: 'year is required' });
        const fresh = String(req.query.fresh || '') === '1';
        const ckey = 'plin|' + division + '|' + year + '|' + code + '|' + journal;
        const hit = cacheGet(ckey, fresh);
        if (hit) return res.json(hit);
        try {
            const filter = 'FinancialYear eq ' + year +
                " and GLAccountCode ge '" + code + "' and GLAccountCode le '" + code + "zzzz'";
            const raw = await lines(division, filter, h);
            let out = raw.map(mapLine).filter(function (l) { return l.amount !== 0; });
            if (journal && journal !== 'all') out = out.filter(function (l) { return l.journalCode === journal; });
            out.sort(function (a, b) { return (a.period - b.period) || (a.entryNumber - b.entryNumber); });
            let debit = 0, credit = 0;
            out.forEach(function (l) { debit += l.debit; credit += l.credit; });
            return res.json(cacheSet(ckey, {
                division: division,
                year: year,
                code: code,
                journal: journal || 'all',
                lines: out,
                totals: { debit: r2(debit), credit: r2(credit), net: r2(debit - credit) },
                lastUpdated: new Date().toISOString()
            }));
        } catch (e) {
            return fail(res, e, 'Failed to load the prepaid lines of this entity');
        }
    });

    return router;
};
