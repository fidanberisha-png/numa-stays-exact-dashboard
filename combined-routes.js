// One call that puts the Exact Online figures of this dashboard next to the
// Dynamics 365 Business Central figures, so the group position can be read in
// a single place and picked up by Power BI.
const express = require('express');
const axios = require('axios');

function selfUrl(path) {
  const port = process.env.PORT || 3000;
return 'http://127.0.0.1:' + port + path;
}

async function safeGet(url, headers) {
try {
const r = await axios.get(url, { headers: headers || {}, timeout: 180000 });
return { ok: true, data: r.data };
} catch (e) {
return { ok: false, error: e.response && e.response.data ? e.response.data : e.message };
}
}

module.exports = function () {
  const router = express.Router();

router.get('/api/combined/summary', async function (req, res) {
const headers = req.headers.cookie ? { Cookie: req.headers.cookie } : {};
const envQuery = req.query.environment ? '?environment=' + encodeURIComponent(String(req.query.environment)) : '';
const exact = await safeGet(selfUrl('/api/dashboard'), headers);
const bc = await safeGet(selfUrl('/api/bc/summary' + envQuery), headers);
const out = { generatedAt: new Date().toISOString(), exact: { ok: exact.ok }, businessCentral: { ok: bc.ok }, totals: { exactRevenue: 0, exactPendingInvoices: 0, bcReceivables: 0, bcPayables: 0, netPosition: 0 } };
if (exact.ok) {
out.exact.division = exact.data.division || null;
out.exact.totalRevenue = Number(exact.data.totalRevenue) || 0;
out.exact.pendingInvoices = Number(exact.data.pendingInvoices) || 0;
out.exact.invoiceCount = Array.isArray(exact.data.invoices) ? exact.data.invoices.length : 0;
out.totals.exactRevenue = out.exact.totalRevenue;
out.totals.exactPendingInvoices = out.exact.pendingInvoices;
} else {
out.exact.error = exact.error;
}
if (bc.ok) {
out.businessCentral.receivables = Number(bc.data.receivables) || 0;
out.businessCentral.payables = Number(bc.data.payables) || 0;
out.businessCentral.environments = Array.isArray(bc.data.environments) ? bc.data.environments : [];
out.totals.bcReceivables = out.businessCentral.receivables;
out.totals.bcPayables = out.businessCentral.payables;
} else {
out.businessCentral.error = bc.error;
}
out.totals.netPosition = Math.round((out.totals.exactRevenue + out.totals.bcReceivables - out.totals.bcPayables) * 100) / 100;
res.json(out);
});

return router;
};
