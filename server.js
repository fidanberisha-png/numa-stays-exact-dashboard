const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const session = require('express-session');
const crypto = require('crypto');

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
app.use(require('./exact-routes')(function () { return tokenData; }));
app.use(require('./ageing-routes')(function () { return tokenData; }));
app.use(require('./gl-balance-routes')(function () { return tokenData; }));
app.use(require('./accrued-routes')(function () { return tokenData; }));
app.use(require('./prepaid-routes')(function () { return tokenData; }));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration - CRITICAL for OAuth state persistence
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: process.env.NODE_ENV === 'production',
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000
    }
}));

// Static files
app.use(express.static('public'));

// Root route - serve dashboard.html
// Accrued dashboard page
app.get('/accrued', (req, res) => {
    res.sendFile(__dirname + '/public/accrued.html');
});

app.get('/prepaid', (req, res) => {
    res.sendFile(__dirname + '/public/prepaid.html');
});

app.get('/summary', (req, res) => {
    res.sendFile(__dirname + '/public/summary.html');
});

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
const TOKEN_FILE = process.env.TOKEN_FILE || '/tmp/exact-token.json';

// The Exact token used to live only inside this process, so every restart or
// idle spin-down of the instance logged the dashboard out and all reports came
// back empty. The token is now also kept on disk and can be bootstrapped from
// the EXACT_REFRESH_TOKEN environment variable after a fresh deploy.
function saveToken() {
        try {
                    require('fs').writeFileSync(TOKEN_FILE, JSON.stringify(tokenData));
        } catch (e) {
                    console.error('Could not store the Exact token:', e.message);
        }
}

function loadToken() {
        try {
                    const stored = JSON.parse(require('fs').readFileSync(TOKEN_FILE, 'utf8'));
                    if (stored && stored.refresh_token) {
                                    console.log('Exact token restored from disk');
                                    return stored;
                    }
        } catch (e) { }
        if (process.env.EXACT_REFRESH_TOKEN) {
                    console.log('Exact token bootstrapped from EXACT_REFRESH_TOKEN');
                    return { refresh_token: process.env.EXACT_REFRESH_TOKEN, access_token: '', expires_in: 600, created_at: 0 };
        }
        return null;
}

let tokenData = loadToken();
let lastRefresh = Date.now();
const REFRESH_INTERVAL = 60 * 1000;

// ====================================
// OAuth Routes
// ====================================

// Login route - Initiates OAuth flow
app.get('/auth/login', (req, res) => {
    try {
          const state = crypto.randomBytes(32).toString('hex');
          req.session.oauthState = state;
          req.session.save((err) => {
                  if (err) {
                            console.error('Session save error:', err);
                            return res.status(500).json({ error: 'Session error' });
                  }

                                 const authUrl = `${EXACT_AUTH_URL}?response_type=code&client_id=${EXACT_CLIENT_ID}&redirect_uri=${encodeURIComponent(EXACT_REDIRECT_URI)}&state=${state}`;
                  console.log('Redirecting to Exact Online login');
                  res.redirect(authUrl);
          });
    } catch (error) {
          console.error('Login error:', error);
          res.status(500).json({ error: 'Login failed' });
    }
});

// OAuth callback
app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;

          console.log('OAuth callback received');
    console.log('Stored state:', req.session.oauthState);
    console.log('Returned state:', state);

          delete req.session.oauthState;

          try {
                const response = await axios.post(EXACT_TOKEN_URL, new URLSearchParams({
                        grant_type: 'authorization_code',
                        code,
                        redirect_uri: EXACT_REDIRECT_URI,
                        client_id: EXACT_CLIENT_ID,
                        client_secret: EXACT_CLIENT_SECRET
                }));

      tokenData = response.data;
                tokenData.created_at = Date.now();
                      saveToken();
                req.session.authenticated = true;
                req.session.save();

      console.log('OAuth authentication successful');
                res.redirect('/?authenticated=true');
          } catch (error) {
                console.error('OAuth token exchange error:', error.response?.data || error.message);
                res.status(500).json({ error: 'Authentication failed', details: error.response?.data || error.message });
          }
});

// Logout route
app.get('/auth/logout', (req, res) => {
    tokenData = null;
    req.session.destroy((err) => {
          if (err) console.error('Session destroy error:', err);
          res.redirect('/');
    });
});

// ====================================
// API Routes - Financial Data
// ====================================

app.get('/api/status', (req, res) => {
    res.json({
          authenticated: !!tokenData,
                    hasRefreshToken: !!(tokenData && tokenData.refresh_token),
          lastRefresh: lastRefresh,
          nextRefresh: lastRefresh + REFRESH_INTERVAL
    });
});

// ====================================
// Helper Functions
// ====================================

function isTokenExpired() {
    if (!tokenData) return false;
    const expiresIn = tokenData.expires_in * 1000;
    const createdAt = tokenData.created_at;
    return (Date.now() - createdAt) > (expiresIn * 0.6);
}

async function refreshToken() {
    try {
          const response = await axios.post(EXACT_TOKEN_URL, new URLSearchParams({
                  grant_type: 'refresh_token',
                  refresh_token: tokenData.refresh_token,
                  client_id: EXACT_CLIENT_ID,
                  client_secret: EXACT_CLIENT_SECRET
          }));

      tokenData = response.data;
          tokenData.created_at = Date.now();
          lastRefresh = Date.now();
          console.log('Token refreshed successfully');
                saveToken();
    } catch (error) {
          console.error('Token refresh failed:', error.message);
                if (error.response && error.response.status === 400) {
                                tokenData = null;
                                saveToken();
                                console.error('Exact refused the refresh token, press Connect Exact Online again');
                }
    }
}

setInterval(() => {
    if (tokenData && isTokenExpired()) {
          refreshToken();
    }
}, REFRESH_INTERVAL);

// A token restored from disk has no usable access token any more, so refresh
// it right away instead of waiting for the first report to fail.
if (tokenData && tokenData.refresh_token) {
        refreshToken();
}

// ====================================
// Error Handling
// ====================================

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ====================================
// Start Server
// ====================================

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Dashboard: http://localhost:' + PORT);
});

    // =========================================
// Keep alive + token safety net
// =========================================
// The Exact token only lives in memory, so an idle spin-down or a restart of
// this instance logs the dashboard out and every report then shows no data.
// A small self ping keeps the instance awake and the token being refreshed.
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || '';
if (SELF_URL) {
        setInterval(function () {
                    axios.get(SELF_URL + '/api/status').then(function () { }).catch(function () { });
        }, 10 * 60 * 1000);
}

