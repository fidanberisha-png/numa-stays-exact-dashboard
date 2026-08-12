# Numa Stays Exact Online Dashboard - Setup Guide

Welcome! This guide will walk you through setting up the Exact Online Financial Dashboard for Numa Stays property management.

## Prerequisites

- Node.js (v18 or higher)
- - npm or yarn
  - - Exact Online account with admin access
    - - Git
     
      - ## Step 1: Clone the Repository
     
      - ```bash
        git clone https://github.com/fidanberisha-png/numa-stays-exact-dashboard.git
        cd numa-stays-exact-dashboard
        ```

        ## Step 2: Install Dependencies

        ```bash
        npm install
        ```

        This will install all required packages:
        - **express** - Web server framework
        - - **axios** - HTTP client for API calls
          - - **dotenv** - Environment variable management
            - - **cors** - Cross-origin resource sharing
              - - **body-parser** - Request body parsing
                - - **express-session** - Session management
                 
                  - ## Step 3: Register Application with Exact Online
                 
                  - To connect to Exact Online, you need to register your application:
                 
                  - 1. Go to Exact Online Admin Panel
                    2. 2. Navigate to **Settings → API → App Registrations**
                       3. 3. Click **New Application**
                          4. 4. Fill in the following details:
                            
                             5.    | Field | Value |
                             6.   |-------|-------|
                             7.      | **Application Name** | Numa Stays Dashboard |
                             8.     | **Redirect URI** | `http://localhost:3000/auth/callback` |
                             9.    | **Description** | Real-time financial dashboard for Numa Stays property management |
                            
                             10.5. Accept the terms and click **Save**
                             6. You'll receive:
                             7.    - **Client ID**
                                   -    - **Client Secret**
                                        -    - Keep these secure!
                                         
                                             - ## Step 4: Configure Environment Variables
                                         
                                             - 1. Copy the example configuration:
                                               2. ```bash
                                                  cp .env.example .env
                                                  ```

                                                  2. Edit `.env` and add your Exact Online credentials:
                                                 
                                                  3. ```env
                                                     # Exact Online OAuth Configuration
                                                     EXACT_CLIENT_ID=your_client_id_from_step_3
                                                     EXACT_CLIENT_SECRET=your_client_secret_from_step_3
                                                     EXACT_REDIRECT_URI=http://localhost:3000/auth/callback
                                                     EXACT_REGION=nl

                                                     # Server Configuration
                                                     PORT=3000
                                                     NODE_ENV=development

                                                     # Session Configuration (generate a random string)
                                                     SESSION_SECRET=your-random-session-secret-key-here
                                                     ```

                                                     ### Generating SESSION_SECRET

                                                     To generate a secure session secret:

                                                     ```bash
                                                     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
                                                     ```

                                                     Copy the output and paste it as your SESSION_SECRET.

                                                     ## Step 5: Start the Server

                                                     ```bash
                                                     npm start
                                                     ```

                                                     You should see:
                                                     ```
                                                     Server running on http://localhost:3000
                                                     Dashboard: http://localhost:3000
                                                     ```

                                                     ## Step 6: Access the Dashboard

                                                     1. Open your browser and go to `http://localhost:3000`
                                                     2. 2. Click the **"Authenticate"** button (or refresh button in header)
                                                        3. 3. You'll be redirected to Exact Online login
                                                           4. 4. Log in with your Exact Online credentials
                                                              5. 5. Approve the application access request
                                                                 6. 6. You'll be redirected back to the dashboard with real invoice data!
                                                                   
                                                                    7. ## API Endpoints
                                                                   
                                                                    8. Once authenticated, the dashboard can access:
                                                                   
                                                                    9. ### `/api/invoices`
                                                                    10. Fetches all sales invoices from Exact Online
                                                                    11. ```javascript
                                                                        GET /api/invoices
                                                                        ```

                                                                        ### `/api/contacts`
                                                                        Retrieves customer/contact information
                                                                        ```javascript
                                                                        GET /api/contacts
                                                                        ```

                                                                        ### `/api/status`
                                                                        Check authentication and refresh status
                                                                        ```javascript
                                                                        GET /api/status
                                                                        ```

                                                                        ## Features

                                                                        ✅ **OAuth 2.0 Authentication** - Secure connection to Exact Online
                                                                        ✅ **Auto Token Refresh** - Tokens automatically refresh every 5 minutes
                                                                        ✅ **Real-time Invoice Data** - Live access to your financial data
                                                                        ✅ **Responsive Dashboard** - Works on desktop and tablet
                                                                        ✅ **KPI Cards** - Total Revenue, Invoice Count, Overdue Invoices
                                                                        ✅ **Data Charts** - Revenue trends and invoice status visualization
                                                                        ✅ **Customer Analytics** - Top customers and recent invoices

                                                                        ## Dashboard Components

                                                                        - **Header** - Application title with authentication status
                                                                        - - **KPI Cards** - Key performance indicators
                                                                          -   - Total Revenue (from paid invoices)
                                                                              -   - Total Invoices (this period)
                                                                                  -   - Overdue Invoices (requiring attention)
                                                                                      - - **Recent Invoices Table** - Latest 4 invoices with status
                                                                                        - - **Charts** - Visual representation of financial data
                                                                                         
                                                                                          - ## Deployment
                                                                                         
                                                                                          - ### Deploy to Render.com (Recommended)
                                                                                         
                                                                                          - 1. Push your code to GitHub
                                                                                            2. 2. Go to render.com and sign in
                                                                                               3. 3. Click "New +" and select "Web Service"
                                                                                                  4. 4. Connect your GitHub repository
                                                                                                     5. 5. Configure environment variables in Render dashboard
                                                                                                        6. 6. Set redirect URI in Exact Online to your Render URL
                                                                                                           7. 7. Deploy!
                                                                                                             
                                                                                                              8. ### Example Render Redirect URI
                                                                                                              9. ```
                                                                                                                 https://your-app-name.onrender.com/auth/callback
                                                                                                                 ```
                                                                                                                 
                                                                                                                 ## Troubleshooting
                                                                                                                 
                                                                                                                 ### "State mismatch" Error
                                                                                                                 - Clear browser cookies
                                                                                                                 - - Restart the server
                                                                                                                   - - Check SESSION_SECRET is consistent
                                                                                                                    
                                                                                                                     - ### Token Expired Error
                                                                                                                     - - The token will auto-refresh every 5 minutes
                                                                                                                       - - Manual refresh available via dashboard button
                                                                                                                        
                                                                                                                         - ### CORS Error
                                                                                                                         - - Ensure CORS middleware is enabled in server.js
                                                                                                                           - - Check your redirect URI matches exactly in Exact Online settings
                                                                                                                            
                                                                                                                             - ### Connection Refused
                                                                                                                             - - Ensure server is running on port 3000
                                                                                                                               - - Check NODE_ENV and EXACT_REGION settings
                                                                                                                                
                                                                                                                                 - ## File Structure
                                                                                                                                
                                                                                                                                 - ```
                                                                                                                                   numa-stays-exact-dashboard/
                                                                                                                                   ├── server.js              # Express server with OAuth integration
                                                                                                                                   ├── public/
                                                                                                                                   │   └── dashboard.html     # Frontend dashboard UI
                                                                                                                                   ├── package.json           # Dependencies
                                                                                                                                   ├── .env.example           # Environment variables template
                                                                                                                                   ├── .env                   # Your local configuration (git-ignored)
                                                                                                                                   ├── .gitignore             # Git ignore rules
                                                                                                                                   ├── README.md              # Project overview
                                                                                                                                   └── SETUP.md               # This file
                                                                                                                                   ```
                                                                                                                                   
                                                                                                                                   ## Security Notes
                                                                                                                                   
                                                                                                                                   ⚠️ **Important:**
                                                                                                                                   - Never commit `.env` file with real credentials
                                                                                                                                   - - Keep CLIENT_SECRET secure - never expose it in frontend code
                                                                                                                                     - - Use HTTPS in production
                                                                                                                                       - - Rotate credentials regularly
                                                                                                                                         - - Use strong SESSION_SECRET (minimum 32 characters)
                                                                                                                                          
                                                                                                                                           - ## Maintenance
                                                                                                                                          
                                                                                                                                           - ### Keeping Dependencies Updated
                                                                                                                                          
                                                                                                                                           - ```bash
                                                                                                                                             npm update
                                                                                                                                             npm audit fix  # Fix security vulnerabilities
                                                                                                                                             ```
                                                                                                                                             
                                                                                                                                             ### Monitoring Token Usage
                                                                                                                                             
                                                                                                                                             Check `/api/status` endpoint to see:
                                                                                                                                             - Authentication status
                                                                                                                                             - - Last refresh time
                                                                                                                                               - - Next scheduled refresh
                                                                                                                                                
                                                                                                                                                 - ## Support & Documentation
                                                                                                                                                
                                                                                                                                                 - - **Exact Online API Docs**: https://support.exactonline.com/community/s/knowledge-base
                                                                                                                                                   - - **Express.js Docs**: https://expressjs.com/
                                                                                                                                                     - - **OAuth 2.0 Spec**: https://tools.ietf.org/html/rfc6749
                                                                                                                                                      
                                                                                                                                                       - ## License
                                                                                                                                                      
                                                                                                                                                       - This project is licensed under the MIT License.
                                                                                                                                                      
                                                                                                                                                       - ## Author
                                                                                                                                                      
                                                                                                                                                       - Created for Numa Stays property management - Shqiperia
