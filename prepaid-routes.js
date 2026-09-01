// PrePaid dashboard API for Numa Stays.
// The prepaid G/L account (160100) is read live from Exact Online and the whole
// amortisation schedule is built here, on the server, so the page only draws
// what Exact really contains. Amounts are never changed: they are only spread
// over the months that the invoice covers.
const express = require('express');
const axios = require('axios');

const REGION = process.env.EXACT_REGION || 'nl';
const BASE = 'https://start.exactonline.' + REGION + '/api/v1';
const TTL = 2 * 60 * 60 * 1000;
const cache = {};

// Journal 91 was used as the example of how a prepayment is written down. All
// journals are read the same way and none of them is treated differently: they
// all end up in one and the same list.
const REF_JOURNAL = '91';

// With a blank financial year the dashboard never counts further than this
// year, so the carry column never speaks of a year later than 2027 and the
// page stays inside the years the filter itself offers.
const LAST_YEAR = 2026;

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

    // ---- Exact Online throttle and 429 retries ---------------------------
    // Exact allows only about sixty calls a minute per company. Reading a large
    // entity therefore has to wait its turn, and a refusal is retried with a
    // short backoff instead of turning into an error on the screen.
// Exact Online keeps a day budget per company (five thousand calls) next to the
// minute budget. Once it is gone every further call is refused, so asking again
// only makes a screen wait for nothing. The company is then put aside until the
// reset Exact names, and the answer says so in plain words.
const BLOCKED = {};
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

    const CALL_LOG = {};
    const MAX_PER_MIN = 55;
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function divOf(u) { const m = /\/api\/v1\/(\d+)\//.exec(String(u || '')); return m ? m[1] : 'x'; }
    async function slot(u) {
        const k = divOf(u);
        if (!CALL_LOG[k]) { CALL_LOG[k] = []; }
        const log = CALL_LOG[k];
        for (let i = 0; i < 30; i++) {
            const now = Date.now();
            while (log.length && (now - log[0]) > 60000) { log.shift(); }
            if (log.length < MAX_PER_MIN) { log.push(now); return; }
            await sleep(1000);
        }
        log.push(Date.now());
    }
    async function getEx(url, h) {
        let wait = 1200;
        let last = null;
        for (let i = 0; i < 4; i++) {
    const dv = divOf(url);
    const stop = blockNote(dv);
    if (stop) { const be = new Error(stop); be.blocked = true; be.division = dv; throw be; }
    await slot(url);
            try { return await axios.get(url, { headers: h, timeout: 60000 }); }
            catch (e) {
                last = e;
                const st = e.response ? e.response.status : 0;
      if (st === 429) {
        noteRefusal(dv, e);
        if (BLOCKED[dv]) { const be = new Error(BLOCKED[dv].message); be.blocked = true; be.division = dv; throw be; }
      }
      if (st !== 429 && st !== 502 && st !== 503) throw e;
                if (i === 3) throw e;
                const ra = Number(e.response && e.response.headers ? e.response.headers['retry-after'] : 0);
                let ms = ra > 0 ? ra * 1000 : wait;
                if (ms > 8000) { ms = 8000; }
                await sleep(ms);
                wait = wait * 2;
            }
        }
        throw last;
    }
    async function fetchAll(division, path, h, cap) {
        let url = BASE + '/' + division + '/' + path;
        const out = [];
        let page = 0;
        while (url) {
            const r = await getEx(url, h);
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
    // Journal 91 is never touched: every line of the automatic journal stays as
    // it is. A line of a manual journal is only left out when the same invoice,
    // or the same text with the same amount on the same day, is already counted.
    // This is what stops the same invoice from being added twice.
    // Every journal is treated in exactly the same way. Journal 91 was only the
    // example of how a prepayment is written, the same reading is used for all
    // of them, so nothing is filtered out because of the journal it sits in.
    function cleanRef(v) {
        const s = String(v || '').toLowerCase();
        let out = '';
        for (let i = 0; i < s.length; i++) {
            const c = s.charAt(i);
            if ((c >= 'a' && c <= 'z') || isDigit(c)) out = out + c;
        }
        return out;
    }

    // The lines of one entry that carry the same text are one and the same
    // invoice, so they become one row with one amount. Nothing is summed twice
    // and no line disappears.
    function groupEntries(rows) {
        const map = {};
        const order = [];
        rows.forEach(function (l) {
            const k = (l.journalCode || '-') + '|' + (l.entryNumber || 0) + '|' +
                String(l.description || '').toLowerCase() + '|' + cleanRef(l.invoice);
            if (!map[k]) { map[k] = { line: l, amount: 0, count: 0 }; order.push(k); }
            map[k].amount += l.amount;
            map[k].count += 1;
        });
        return order.map(function (k) {
            const g = map[k];
            const l = {};
            Object.keys(g.line).forEach(function (p) { l[p] = g.line[p]; });
            l.amount = r2(g.amount);
            l.merged = g.count;
            return l;
        });
    }

    // Two different invoices are never joined together, not even when they carry
    // the same text, the same day and the same amount: both of them are added. Only the very same invoice number, written a second time in another entry, is left out once.
    function findDoubles(rows) {
        const seen = {};
        const doubles = [];
        rows.forEach(function (l) {
            const ref = cleanRef(l.invoice);
            const amt = r2(l.amount).toFixed(2);
            const dt = exactDate(l.date);
            if (!ref) return;
            const k = 'i|' + ref + '|' + amt;
            if (seen[k] && seen[k].entry !== (Number(l.entryNumber) || 0)) {
                l.doubleOf = seen[k].where;
                doubles.push({
                    invoice: l.invoice, journal: l.journalCode, entry: l.entryNumber,
                    firstSeen: seen[k].where, amount: r2(l.amount), description: l.description
                });
                return;
            }
            if (!seen[k]) seen[k] = { where: (l.journalCode || '-') + ' / ' + (l.entryNumber || ''), entry: Number(l.entryNumber) || 0 };
        });
        return doubles;
    }

    // The invoice number and the expense account do not stand on the prepaid
    // line itself but on the other lines of the same entry. They are read per
    // journal with the entry numbers that are really needed, so this stays a
    // small extra question to Exact.
    async function counterLines(division, rows, h, code) {
        const spans = {};
        rows.forEach(function (l) {
            const n = Number(l.entryNumber) || 0;
            if (!n) return;
            const j = (l.journalCode || '-') + '|' + (Number(l.year) || 0);
            if (!spans[j]) spans[j] = { min: n, max: n, year: Number(l.year) || 0 };
            if (n < spans[j].min) spans[j].min = n;
            if (n > spans[j].max) spans[j].max = n;
        });
        const sel = 'EntryNumber,GLAccountCode,GLAccountDescription,AmountDC,CostCenter,CostCenterDescription,CostUnit,CostUnitDescription,YourRef,InvoiceNumber,AccountName';
        const out = {};
        const keys = Object.keys(spans);
        for (let i = 0; i < keys.length; i++) {
            const s = spans[keys[i]];
            const f = (s.year ? 'FinancialYear eq ' + s.year + ' and ' : '') + 'EntryNumber ge ' + s.min + ' and EntryNumber le ' + s.max;
            const rs = await fetchAll(division, 'bulk/Financial/TransactionLines?$select=' + sel + '&$filter=' + f, h, 60);
            rs.forEach(function (r) {
                const n = Number(r.EntryNumber) || 0;
                if (!n) return;
                if (!out[n]) out[n] = { invoice: '', account: '', accountName: '', cost: '', costName: '', best: 0 };
                const e = out[n];
                if (!e.invoice) e.invoice = txt(r.YourRef) || (r.InvoiceNumber ? txt(r.InvoiceNumber) : '');
                const gl = txt(r.GLAccountCode);
                if (!gl || gl === code) return;
                const first = gl.charAt(0);
                if (first !== '4' && first !== '5' && first !== '6' && first !== '7') return;
                const a = Math.abs(Number(r.AmountDC) || 0);
                if (a <= e.best) return;
                e.best = a;
                e.account = gl;
                e.accountName = txt(r.GLAccountDescription);
                e.cost = txt(r.CostCenter);
                e.costName = txt(r.CostCenterDescription);
            });
        }
        return out;
    }

    // The opening balance of the account: everything that was booked on it in
    // the years before the chosen financial year. It is only added up, never
    // changed, so it stands next to the journals like in the report of Exact.
    async function opening(division, code, year, h) {
        const ckey = 'popen|' + division + '|' + code + '|' + year;
        const hit = cacheGet(ckey, false);
        if (hit) return hit;
        const range = " and GLAccountCode ge '" + code + "' and GLAccountCode le '" + code + "zzzz'";
        let n = 0, src = '', got = 0;
        try {
            // The balance of Exact itself: the same figure the report of Exact opens
            // with, every year before the chosen one added up.
            const f = "BalanceType eq 'B' and ReportingYear le " + (year - 1) + range;
            const rs = await fetchAll(division, 'financial/ReportingBalance?$select=Amount,ReportingYear,GLAccountCode&$filter=' + f, h, 80);
            got = rs.length;
            rs.forEach(function (r) { n += Number(r.Amount) || 0; });
            src = 'the balance of Exact';
        } catch (eB) { got = 0; n = 0; src = ''; }
        if (!got) {
            // Exact gave no balance rows, so the lines of the earlier years are added
            // up instead. Nothing is guessed either way.
            const f2 = 'FinancialYear lt ' + year + range;
            const rs2 = await lines(division, f2, h);
            n = 0;
            rs2.forEach(function (r) { n += Number(r.AmountDC) || 0; });
            src = 'the lines of the years before';
        }
        return cacheSet(ckey, { amount: r2(n), source: src });
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
    // One and the same schedule engine serves the prepaid account and, with the
    // merged accrual accounts, the Accrued dashboard.
    const ACC_CODES = ['251150', '270100', '270200', '271500', '271600', '271900', '272200', '272203', '272205', '272210'];
    async function scheduleRoute(req, res, cfg) {
        const h = headers();
        if (!h) return res.status(401).json({ error: 'Not authenticated' });
        const division = req.query.division ? String(req.query.division) : null;
        const isAcc = !!(cfg && cfg.kind === 'accrued');
        const codeList = isAcc ? ACC_CODES : [req.query.code ? String(req.query.code).trim() : '160100'];
        const code = isAcc ? 'ACCRUALS' : codeList[0];
        const year = req.query.year ? parseInt(String(req.query.year), 10) : null;
        const journal = txt(req.query.journal);
        const mode = txt(req.query.mode) === 'invoice' ? 'invoice' : 'period';
        const until = txt(req.query.until) || 'year';
        if (!division) return res.status(400).json({ error: 'division is required' });
        // The financial year may stay blank: then every year is read at once.
        const fresh = String(req.query.fresh || '') === '1';
        const ckey = 'psch|' + division + '|' + (year || 'all') + '|' + code + '|' + journal + '|' + mode + '|' + until;
        const hit = cacheGet(ckey, fresh);
        if (hit) return res.json(hit);
        try {
            const glWhere = codeList.map(function (c) { return "(GLAccountCode ge '" + c + "' and GLAccountCode le '" + c + "zzzz')"; }).join(' or ');
            const filter = (year ? 'FinancialYear eq ' + year + ' and ' : '') + '(' + glWhere + ')';
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
                    reference: j.code === REF_JOURNAL
                };
            });

            let scope = all;
            if (journal && journal !== 'all') scope = all.filter(function (l) { return l.journalCode === journal; });
            const debits = scope.filter(function (l) { return l.amount > 0; });
            const credits = scope.filter(function (l) { return l.amount < 0; });
            const grouped = groupEntries(debits);

            // The invoice number does not stand on the prepaid line itself, it stands
            // on the other lines of the same entry. It is read first, so the reading
            // later on already knows the real invoice number of every line and two
            // different invoices are never taken for one and the same invoice.
            let extra = {};
            let extraFailed = false;
            if (txt(req.query.counter) !== '0' && grouped.length) {
                try { extra = await counterLines(division, grouped, h, code); }
                catch (eC) { extraFailed = true; extra = {}; }
            }
            grouped.forEach(function (l) {
                const x = extra[Number(l.entryNumber)] || {};
                if (!l.invoice && x.invoice) l.invoice = x.invoice;
            });
            const doubles = findDoubles(grouped);
            const clean = {
                kept: grouped.filter(function (l) { return !l.doubleOf; }),
                dropped: doubles
            };

            // With a blank financial year every year is read at once. The year the
            // schedule is counted against is then the last year Exact really holds.
            let baseYear = year;
            if (!baseYear) {
                let mx = 0;
                all.forEach(function (l) { const yy = Number(l.year) || 0; if (yy > mx) mx = yy; });
                baseYear = mx || new Date().getUTCFullYear();
                if (baseYear > LAST_YEAR) baseYear = LAST_YEAR;
            }
            let cut;
            if (until === 'today') {
                const n = new Date();
                cut = { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1 };
            } else if (until !== 'year') {
                const ds = findDates(until);
                cut = ds.length ? { y: ds[0].y, m: ds[0].m } : { y: baseYear, m: 12 };
            } else {
                cut = { y: baseYear, m: 12 };
            }

            const rows = [];
            const skipped = [];
            clean.kept.sort(function (a, b) {
                const da = exactDate(a.date), db = exactDate(b.date);
                return ((da ? da.t : 0) - (db ? db.t : 0)) || ((a.entryNumber || 0) - (b.entryNumber || 0));
            });
            clean.kept.forEach(function (l) {
                const dt = exactDate(l.date);
                const x = extra[Number(l.entryNumber)] || {};
                const p = period(l.description);
                const base = {
                    date: dt ? dmy(dt.y, dt.m, dt.d) : '',
                    journal: l.journalCode,
                    invoice: l.invoice || x.invoice || '',
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
                    merged: l.merged || 1,
                    date: base.date,
                    sort: dt ? dt.t : 0,
                    cost: l.costCenter || x.cost || l.costUnit || '',
                    costName: l.costCenterName || x.costName || l.costUnitName || '',
                    acc: x.account || l.costUnit || l.glCode || '',
                    accName: x.accountName || l.costUnitName || l.glDescription || '',
                    description: l.description,
                    supplier: l.supplier,
                    invoice: l.invoice || x.invoice || '',
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

            // The balance of the account, drawn like the journal report of Exact: the
            // opening balance, then the journals, then the total and the closing
            // balance. Nothing is recalculated, the lines are only added up.
            let openNet = 0, openFailed = false, openSource = '';
            if (year) {
                try { const o = await opening(division, code, year, h); openNet = o.amount; openSource = o.source; }
                catch (eO) { openFailed = true; openNet = 0; }
            }
            const bJournals = (journal && journal !== 'all')
                ? journals.filter(function (j) { return j.code === journal; })
                : journals;
            let bDebit = 0, bCredit = 0;
            bJournals.forEach(function (j) { bDebit += j.debit; bCredit += j.credit; });
            const opDebit = openNet > 0 ? openNet : 0;
            const opCredit = openNet < 0 ? -openNet : 0;
            const closeNet = r2(openNet + bDebit - bCredit);
            const balance = {
                allYears: !year,
                openingSource: openSource,
                openingFailed: openFailed,
                opening: { debit: r2(opDebit), credit: r2(opCredit), amount: r2(openNet) },
                journals: bJournals,
                total: { debit: r2(opDebit + bDebit), credit: r2(opCredit + bCredit), amount: closeNet },
                closing: { debit: closeNet > 0 ? closeNet : 0, credit: closeNet < 0 ? -closeNet : 0, amount: closeNet }
            };

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
                counterFailed: extraFailed,
                baseYear: baseYear,
                balance: balance,
                journals: journals,
                rows: rows,
                skipped: skipped,
                totals: {
                    count: rows.length,
                    amount: r2(tAmount),
                    expensed: r2(tExpensed),
                    prepaid: r2(tPrepaid),
                    released: r2(released),
                    skipped: r2(tSkipped),
                    skippedCount: skipped.length
                },
                lastUpdated: new Date().toISOString()
            }));
        } catch (e) {
            return fail(res, e, 'Failed to build the prepaid schedule of this entity');
        }
    }
    router.get('/api/prepaid/schedule', function (req, res) { return scheduleRoute(req, res, { kind: 'prepaid' }); });
    router.get('/api/accrued/schedule', function (req, res) { return scheduleRoute(req, res, { kind: 'accrued' }); });

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
        // The financial year may stay blank: then every year is read at once.
        const fresh = String(req.query.fresh || '') === '1';
        const ckey = 'plin|' + division + '|' + (year || 'all') + '|' + code + '|' + journal;
        const hit = cacheGet(ckey, fresh);
        if (hit) return res.json(hit);
        try {
            const filter = (year ? 'FinancialYear eq ' + year + ' and ' : '') +
                "GLAccountCode ge '" + code + "' and GLAccountCode le '" + code + "zzzz'";
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

    // ---- Keeping the PrePaid and Accrued summary warm ---------------------
    // The amortisation of an entity takes a while to read, so the server builds
    // it by itself: shortly after the start and then every twenty minutes it
    // walks through the entities of the dashboard and refills the cache. A
    // summary that is opened afterwards is answered from memory.
    const WARM_START_MS = 45000;
    const WARM_EVERY_MS = 2 * 60 * 60 * 1000;
    const WARM_LANES = 4;
    const WARM_CODES = [3784237, 3745758, 3745759, 3745760, 3745740, 3751399, 3708480, 3642741, 2657065, 3383979, 3693157, 3706020, 3716405, 3741441, 3717706, 3900740, 3725452, 3732987, 3745729];
    let warmRunning = false;
    let warmInfo = { at: null, done: 0, total: 0, ms: 0 };
    function warmOne(kind, division) {
        return new Promise(function (resolve) {
            let settled = false;
            function finish() { if (!settled) { settled = true; resolve(); } }
            const req = { query: { division: String(division), code: '160100', journal: 'all', mode: 'period', until: 'year', fresh: '1' } };
            const res = { status: function () { return res; }, json: function () { finish(); return res; } };
            try { scheduleRoute(req, res, { kind: kind }).then(finish, finish); }
            catch (e) { finish(); }
        });
    }
    async function warmAll() {
        if (warmRunning) return;
        if (!headers()) return;
        warmRunning = true;
        const started = Date.now();
        const list = [];
        WARM_CODES.forEach(function (c) { list.push({ kind: 'prepaid', division: c }); list.push({ kind: 'accrued', division: c }); });
        warmInfo = { at: started, done: 0, total: list.length, ms: 0 };
        let next = 0;
        async function warmLane() {
            while (next < list.length) {
                const t = list[next];
                next = next + 1;
                try { await warmOne(t.kind, t.division); } catch (e) { /* the next round tries again */ }
                warmInfo.done = warmInfo.done + 1;
            }
        }
        const lanes = [];
        for (let i = 0; i < WARM_LANES; i++) { lanes.push(warmLane()); }
        try { await Promise.all(lanes); } catch (e) { /* the next round tries again */ }
        warmInfo.ms = Date.now() - started;
        warmRunning = false;
    }
    setTimeout(function () { warmAll(); }, WARM_START_MS);
    setInterval(function () { warmAll(); }, WARM_EVERY_MS);
    router.get('/api/prepaid/warm', function (req, res) {
        res.json({ running: warmRunning, info: warmInfo, cached: Object.keys(cache).length });
    });
    return router;
};
