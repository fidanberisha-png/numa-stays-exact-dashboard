// Business Central integration for the Numa Stays dashboard.
//
// The dashboard already reads Exact Online. This module adds Dynamics 365
// Business Central through the Microsoft Entra app registration that is
// enabled in every Production environment of the tenant. It uses the client
// credentials flow, so there is no interactive login and one token serves
// all environments.
const express = require('express');
const axios = require('axios');

const TENANT = process.env.BC_TENANT_ID || '';
const CLIENT_ID = process.env.BC_CLIENT_ID || '';
const CLIENT_SECRET = process.env.BC_CLIENT_SECRET || '';
const SCOPE = 'https://api.businesscentral.dynamics.com/.default';
const DEFAULT_ENVIRONMENTS = 'ProductionDE,ProductionAT,ProductionBE,ProductionCH,ProductionDK,ProductionES,ProductionFR,ProductionGB,ProductionIT,ProductionNL,ProductionNO,ProductionPT';

function environments() {
  const raw = process.env.BC_ENVIRONMENTS || DEFAULT_ENVIRONMENTS;
    return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }

    function configured() {
      return Boolean(TENANT && CLIENT_ID && CLIENT_SECRET);
      }

      let token = null;
      let tokenExpires = 0;

      async function getToken() {
        if (token && Date.now() < tokenExpires - 60000) return token;
          if (!configured()) throw new Error('Business Central credentials are missing');
            const body = 'grant_type=client_credentials&client_id=' + encodeURIComponent(CLIENT_ID) + '&client_secret=' + encodeURIComponent(CLIENT_SECRET) + '&scope=' + encodeURIComponent(SCOPE);
              const url = 'https://login.microsoftonline.com/' + TENANT + '/oauth2/v2.0/token';
                const r = await axios.post(url, body, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
                  token = r.data.access_token;
                    tokenExpires = Date.now() + (Number(r.data.expires_in) || 3600) * 1000;
                      return token;
                      }

                      function apiBase(env) {
                        return 'https://api.businesscentral.dynamics.com/v2.0/' + TENANT + '/' + env + '/api/v2.0';
                        }

                        async function bcGet(env, path) {
                          const t = await getToken();
                            const url = path.indexOf('http') === 0 ? path : apiBase(env) + path;
                              const r = await axios.get(url, { headers: { Authorization: 'Bearer ' + t, Accept: 'application/json' } });
                                return r.data && r.data.value ? r.data.value : r.data;
                                }

                                function sum(rows, field) {
                                  let total = 0;
                                    (rows || []).forEach(function (row) { const v = Number(row[field]); if (!isNaN(v)) total += v; });
                                      return Math.round(total * 100) / 100;
                                      }

                                      async function environmentSummary(env) {
                                      const out = { environment: env, companies: [], receivables: 0, payables: 0, error: null };
                                      try {
                                      const companies = await bcGet(env, '/companies?$select=id,name,displayName');
                                      for (const c of (companies || [])) {
                                      const row = { id: c.id, name: c.displayName || c.name, receivables: 0, payables: 0, error: null };
                                      try {
                                      const customers = await bcGet(env, '/companies(' + c.id + ')/customers?$select=number,displayName,balanceDue');
                                      row.receivables = sum(customers, 'balanceDue');
                                      const vendors = await bcGet(env, '/companies(' + c.id + ')/vendors?$select=number,displayName,balance');
                                      row.payables = sum(vendors, 'balance');
                                      } catch (e) {
                                      row.error = e.message;
                                      }
                                      out.receivables += row.receivables;
                                      out.payables += row.payables;
                                      out.companies.push(row);
                                      }
                                      } catch (e) {
                                      out.error = e.message;
                                      }
                                      out.receivables = Math.round(out.receivables * 100) / 100;
                                      out.payables = Math.round(out.payables * 100) / 100;
                                      return out;
                                      }

                                      module.exports = function () {
                                      const router = express.Router();

                                      router.get('/api/bc/health', function (req, res) {
                                      res.json({ configured: configured(), tenant: TENANT || null, environments: environments() });
                                      });

                                      router.get('/api/bc/environments', function (req, res) {
                                      res.json({ environments: environments() });
                                      });

                                      router.get('/api/bc/companies', async function (req, res) {
                                      const env = req.query.environment ? String(req.query.environment) : environments()[0];
                                      try {
                                      const companies = await bcGet(env, '/companies?$select=id,name,displayName');
                                      res.json({ environment: env, companies: companies });
                                      } catch (e) {
                                      res.status(500).json({ error: e.message });
                                      }
                                      });

                                      router.get('/api/bc/summary', async function (req, res) {
                                      if (!configured()) return res.status(503).json({ error: 'Business Central credentials are missing', configured: false });
                                      const wanted = req.query.environment ? [String(req.query.environment)] : environments();
                                      const out = { environments: [], receivables: 0, payables: 0 };
                                      for (const env of wanted) {
                                      const row = await environmentSummary(env);
                                      out.receivables += row.receivables;
                                      out.payables += row.payables;
                                      out.environments.push(row);
                                      }
                                      out.receivables = Math.round(out.receivables * 100) / 100;
                                      out.payables = Math.round(out.payables * 100) / 100;
                                      res.json(out);
                                      });

                                      router.get('/api/bc/entity', async function (req, res) {
                                      const env = req.query.environment ? String(req.query.environment) : environments()[0];
                                      const company = req.query.company ? String(req.query.company) : '';
                                      const name = req.query.name ? String(req.query.name) : 'generalLedgerEntries';
                                      const top = req.query.top ? Number(req.query.top) : 100;
                                      if (!company) return res.status(400).json({ error: 'company id is required' });
                                      try {
                                      const rows = await bcGet(env, '/companies(' + company + ')/' + name + '?$top=' + top);
                                      res.json({ environment: env, company: company, name: name, rows: rows });
                                      } catch (e) {
                                      res.status(500).json({ error: e.message });
                                      }
                                      });

                                      return router;
                                      };
                                      
