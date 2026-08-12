# Quick Start - Numa Stays Dashboard

## 🚀 Get the Dashboard Running in 3 Minutes!

### Step 1: Clone & Install
```bash
git clone https://github.com/fidanberisha-png/numa-stays-exact-dashboard.git
cd numa-stays-exact-dashboard
npm install
```

### Step 2: Create Environment File
```bash
cp .env.example .env
```

Add to `.env`:
```env
EXACT_CLIENT_ID=your_exact_client_id
EXACT_CLIENT_SECRET=your_exact_client_secret
EXACT_REDIRECT_URI=http://localhost:3000/auth/callback
EXACT_REGION=nl
SESSION_SECRET=your-random-secret-key
PORT=3000
NODE_ENV=development
```

### Step 3: Start Server
```bash
npm start
```

You'll see:
```
Server running on http://localhost:3000
Dashboard: http://localhost:3000
```

---

## 🌐 Dashboard Links

After starting the server, access:

- **Main Dashboard**: http://localhost:3000
- - **OAuth Authentication**: http://localhost:3000/auth/authorize
  - - **Invoice API**: http://localhost:3000/api/invoices
    - - **Contacts API**: http://localhost:3000/api/contacts
      - - **Status API**: http://localhost:3000/api/status
       
        - ---

        ## 📊 What You'll See

        1. **Header** - "Numa Stays Dashboard" with authentication status
        2. 2. **3 KPI Cards**:
           3.    - Total Revenue (€124,500)
                 -    - Total Invoices (285)
                      -    - Overdue Invoices (12)
                           - 3. **Recent Invoices Table** - Latest transactions
                             4. 4. **Status Indicator** - Connected/Disconnected
                               
                                5. ---
                               
                                6. ## 🔑 Get Your Exact Online Credentials
                               
                                7. 1. Go to Exact Online Admin Panel
                                   2. 2. Settings → API → App Registrations
                                      3. 3. Create New Application:
                                         4.    - Name: `Numa Stays Dashboard`
                                               -    - Redirect URI: `http://localhost:3000/auth/callback`
                                                    - 4. Save and get CLIENT_ID + CLIENT_SECRET
                                                     
                                                      5. ---
                                                     
                                                      6. ## 🐛 Troubleshooting
                                                     
                                                      7. | Issue | Solution |
                                                      8. |-------|----------|
                                                      9. | **Port 3000 already in use** | Change PORT in .env or kill process on port 3000 |
                                                      10. | **CORS Error** | Ensure NODE_ENV=development in .env |
                                                      11. | **Token Expired** | Click "Refresh" button - tokens auto-refresh every 5 min |
                                                      12. | **Can't login** | Check EXACT_CLIENT_ID & SECRET are correct |
                                                     
                                                      13. ---
                                                     
                                                      14. ## 📚 Documentation
                                                     
                                                      15. - **Full Setup Guide**: See [SETUP.md](SETUP.md)
                                                          - - **Server Code**: [server.js](server.js)
                                                            - - **Dashboard UI**: [public/dashboard.html](public/dashboard.html)
                                                             
                                                              - ---

                                                              ## 🔐 Security Notes

                                                              - **Never** commit `.env` file with real credentials
                                                              - - `.gitignore` already protects your secrets
                                                                - - Use strong SESSION_SECRET (32+ characters)
                                                                 
                                                                  - ---

                                                                  ## ✅ Development Commands

                                                                  ```bash
                                                                  # Install dependencies
                                                                  npm install

                                                                  # Start development server
                                                                  npm start

                                                                  # View real-time logs
                                                                  npm run dev

                                                                  # Check API status
                                                                  curl http://localhost:3000/api/status
                                                                  ```

                                                                  ---

                                                                  **Ready to see your dashboard?**
                                                                  Run `npm start` and open http://localhost:3000 in your browser!
