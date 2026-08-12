const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const session = require('express-session');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Static files
app.use(express.static('public'));

// Root route - serve dashboard.html
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/dashboard.html');
});

// OAuth Configuration
const EXACT_CLIENT_ID = process.env.EXACT_CLIENT_ID;
const EXACT_CLIENT_SECRET = process.env.EXACT_CLIENT_SECRET;
const EXACT_REDIRECT_URI = process.env.EXACT_REDIRECT_URI;
const EXACT_REGION = process.env.EXACT_REGION || 'nl';

// Exact Online API endpoints
const EXACT_AUTH_URL = `https://start.exactonline.${EXACT_REGION}/api/oauth2/auth`;
const EXACT_TOKEN_URL = `https://start.exactonline.${EXACT_REGION}/api/oauth2/token`;
const EXACT_API_BASE = `https://api.exactonline.com/${EXACT_REGION}/api/v1/`;

// Token storage
let tokenData = null;
let lastRefresh = Date.now();
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ====================================
// OAuth Routes
// ====================================

// Login route - Initiates OAuth flow
app.get('/auth/login', (req, res) => {
  try {
    // Generate random state for security
    const state = require('crypto').randomBytes(32).toString('hex');
    req.session.oauthState = state;

    // Build authorization URL
    const authUrl = `${EXACT_AUTH_URL}?` +
      `response_type=code&` +
      `client_id=${EXACT_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(EXACT_REDIRECT_URI)}&` +
      `state=${state}`;

    console.log('Redirecting to Exact Online login:', authUrl);
    res.redirect(authUrl);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// OAuth callback - Handles redirect from Exact Online
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  if (state !== req.session.oauthState) {
    return res.status(401).json({ error: 'State mismatch' });
  }

  try {
    const response = await axios.post(EXACT_TOKEN_URL, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: EXACT_REDIRECT_URI,
      client_id: EXACT_CLIENT_ID,
      client_secret: EXACT_CLIENT_SECRET
    });

    tokenData = response.data;
    tokenData.created_at = Date.now();
    req.session.authenticated = true;

    console.log('OAuth authentication successful');
    res.redirect('/?authenticated=true');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// ====================================
// API Routes - Financial Data
// ====================================

// Get authentication status
app.get('/api/status', (req, res) => {
  res.json({
    authenticated: !!tokenData,
    lastRefresh: lastRefresh,
    nextRefresh: lastRefresh + REFRESH_INTERVAL
  });
});

// Get invoices (Sales & Purchase)
app.get('/api/invoices', async (req, res) => {
  try {
    if (!tokenData) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (isTokenExpired()) {
      await refreshToken();
    }

    const response = await axios.get(
      `${EXACT_API_BASE}salesinvoices`,
      {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/json'
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Get contacts
app.get('/api/contacts', async (req, res) => {
  try {
    if (!tokenData) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (isTokenExpired()) {
      await refreshToken();
    }

    const response = await axios.get(
      `${EXACT_API_BASE}contacts`,
      {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/json'
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// Get comprehensive dashboard data
app.get('/api/dashboard', async (req, res) => {
  try {
    if (!tokenData) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (isTokenExpired()) {
      await refreshToken();
    }

    const headers = {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Accept': 'application/json'
    };

    // Fetch invoices and journal entries in parallel
    const [invoicesResp, journalResp] = await Promise.all([
      axios.get(`${EXACT_API_BASE}salesinvoices`, { headers }),
      axios.get(`${EXACT_API_BASE}journalentries?$filter=JournalType eq 70 or JournalType eq 80`, { headers })
    ]);

    const invoices = invoicesResp.data.d || [];
    const journal = journalResp.data.d || [];

    // Calculate KPIs from invoices
    let totalRevenue = 0;
    let pendingInvoices = [];

    invoices.forEach(inv => {
      if (inv.Amount) totalRevenue += Math.abs(inv.Amount);
      if (inv.Status !== 4) { // Not paid
        pendingInvoices.push(inv);
      }
    });

    res.json({
      invoices: invoices,
      journal: journal,
      totalRevenue: totalRevenue,
      pendingInvoices: pendingInvoices.length,
      lastUpdated: new Date()
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get GL accounts (Chart of Accounts)
app.get('/api/glaccounts', async (req, res) => {
  try {
    if (!tokenData) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (isTokenExpired()) {
      await refreshToken();
    }

    const response = await axios.get(
      `${EXACT_API_BASE}glaccounts`,
      {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/json'
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching GL accounts:', error);
    res.status(500).json({ error: 'Failed to fetch GL accounts' });
  }
});

// Get bank accounts
app.get('/api/bankaccounts', async (req, res) => {
  try {
    if (!tokenData) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (isTokenExpired()) {
      await refreshToken();
    }

    const response = await axios.get(
      `${EXACT_API_BASE}bankaccounts`,
      {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/json'
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching bank accounts:', error);
    res.status(500).json({ error: 'Failed to fetch bank accounts' });
  }
});

// ====================================
// Helper Functions
// ====================================

// Check if token has expired
function isTokenExpired() {
  if (!tokenData) return false;
  const expiresIn = tokenData.expires_in * 1000;
  const createdAt = tokenData.created_at;
  return (Date.now() - createdAt) > (expiresIn * 0.9);
}

// Refresh the access token
async function refreshToken() {
  try {
    const response = await axios.post(EXACT_TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: tokenData.refresh_token,
      client_id: EXACT_CLIENT_ID,
      client_secret: EXACT_CLIENT_SECRET
    });

    tokenData = response.data;
    tokenData.created_at = Date.now();
    lastRefresh = Date.now();
    console.log('Token refreshed successfully');
  } catch (error) {
    console.error('Token refresh failed:', error);
  }
}

// Auto-refresh token every 5 minutes
setInterval(() => {
  if (tokenData && isTokenExpired()) {
    refreshToken();
  }
}, REFRESH_INTERVAL);

// ====================================
// Error Handling
// ====================================

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ====================================
// Start Server
// ====================================

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Dashboard: http://localhost:' + PORT);
});
