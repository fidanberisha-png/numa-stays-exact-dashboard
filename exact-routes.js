    const express = require('express');
    const axios = require('axios');
    const REGION = process.env.EXACT_REGION || 'nl';
    const BASE = 'https://start.exactonline.' + REGION + '/api/v1';
    module.exports = function (getToken) {
          const router = express.Router();
          let division = null;
          function headers() {
                const t = getToken();
                if (!t) return null;
                return { Authorization: 'Bearer ' + t.access_token, Accept: 'application/json' };
          }
          async function getDivision(h) {
                if (division) return division;
                const r = await axios.get(BASE + '/current/Me?$select=CurrentDivision', { headers: h });
                division = r.data.d.results[0].CurrentDivision;
                return division;
          }
          async function list(h, path) {
                const url = BASE + '/' + (await getDivision(h)) + '/' + path;
                const r = await axios.get(url, { headers: h });
                const d = r.data.d;
                return (d && d.results) ? d.results : (Array.isArray(d) ? d : []);
          }
          router.get('/api/me', async function (req, res) {
                const h = headers();
                if (!h) return res.status(401).json({ error: 'Not authenticated' });
                try {
                      const r = await axios.get(BASE + '/current/Me', { headers: h });
                      res.json(r.data.d.results[0]);
                } catch (e) {
                      res.status(500).json({ error: 'Me failed', details: e.response ? e.response.data : e.message });
                }
          });
          router.get('/api/dashboard', async function (req, res) {
                const h = headers();
                if (!h) return res.status(401).json({ error: 'Not authenticated' });
                const out = { invoices: [], journal: [], totalRevenue: 0, pendingInvoices: 0, errors: {}, lastUpdated: new Date() };
                try {
                      out.division = await getDivision(h);
                } catch (e) {
                      out.errors.division = e.response ? e.response.data : e.message;
                      return res.status(500).json(out);
                }
                try {
                      out.invoices = await list(h, 'salesinvoice/SalesInvoices?$select=InvoiceDate,AmountDC,Status,InvoiceNumber,DueDate&$top=500&$orderby=InvoiceDate desc');
                } catch (e) {
                      out.errors.invoices = e.response ? e.response.data : e.message;
                }
                try {
                      const y = new Date().getFullYear();
                      out.journal = await list(h, 'financialtransaction/TransactionLines?$select=Date,AmountDC,GLAccountCode&$filter=Date gt datetime%27' + y + '-01-01%27&$top=1000');
                } catch (e) {
                      out.errors.journal = e.response ? e.response.data : e.message;
                }
                out.invoices.forEach(function (inv) {
                      if (inv.AmountDC) out.totalRevenue += Math.abs(inv.AmountDC);
                      if (inv.Status !== 50) out.pendingInvoices += 1;
                });
                res.json(out);
          });
          return router;
    };

