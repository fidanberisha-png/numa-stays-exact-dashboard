// PrePaid dashboard API for Numa Stays.
// Reads the prepaid G/L accounts (16xxxx) and their transaction lines live from
// Exact Online. The Accrued dashboard keeps its own routes, this file stays
// separate so the two dashboards cannot break each other.
const express = require('express');
const axios = require('axios');

const REGION = process.env.EXACT_REGION || 'nl';
const BASE = 'https://start.exactonline.' + REGION + '/api/v1';
const TTL = 10 * 60 * 1000;
const cache = {};

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

module.exports = function (getToken) {
    const router = express.Router();

    function headers() {
        const t = getToken();
        if (!t) return null;
        return { Authorization: 'Bearer ' + t.access_token, Accept: 'application/json' };
    }

    // Exact hands out the rows in pages. Every page is followed to the end and if
    // the paging is cut off the caller is told instead of losing lines silently.
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
    const SEL_MIN = 'Date,EntryNumber,Description,AmountDC,FinancialPeriod,FinancialYear,GLAccountCode,GLAccountDescription,CostCenter,CostCenterDescription,AccountName,YourRef';

    function mapLine(r) {
        const amt = Number(r.AmountDC) || 0;
        return {
            date: r.Date || null,
            entryNumber: r.EntryNumber,
            journalCode: txt(r.JournalCode),
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

    // All lines of one prepaid account for one financial year.
    router.get('/api/prepaid/lines', async function (req, res) {
        const h = headers();
        if (!h) return res.status(401).json({ error: 'Not authenticated' });
        const division = req.query.division ? String(req.query.division) : null;
        const code = req.query.code ? String(req.query.code).trim() : '160100';
        const year = req.query.year ? parseInt(String(req.query.year), 10) : null;
        if (!division) return res.status(400).json({ error: 'division is required' });
        if (!year) return res.status(400).json({ error: 'year is required' });
        const fresh = String(req.query.fresh || '') === '1';
        const ckey = 'plin|' + division + '|' + year + '|' + code;
        const hit = cacheGet(ckey, fresh);
        if (hit) return res.json(hit);
        try {
            const filter = 'FinancialYear eq ' + year +
                " and GLAccountCode ge '" + code + "' and GLAccountCode le '" + code + "zzzz'";
            const raw = await lines(division, filter, h);
            const out = raw.map(mapLine).filter(function (l) { return l.amount !== 0; });
            out.sort(function (a, b) { return (a.period - b.period) || (a.entryNumber - b.entryNumber); });
            let debit = 0, credit = 0;
            out.forEach(function (l) { debit += l.debit; credit += l.credit; });
            return res.json(cacheSet(ckey, {
                division: division,
                year: year,
                code: code,
                lines: out,
                totals: { debit: debit, credit: credit, net: debit - credit },
                lastUpdated: new Date().toISOString()
            }));
        } catch (e) {
            return fail(res, e, 'Failed to load the prepaid lines of this entity');
        }
    });

    return router;
};
