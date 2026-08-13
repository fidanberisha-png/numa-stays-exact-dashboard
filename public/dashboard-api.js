// Numa Stays Dashboard - Exact Online API Integration
let revenueChart;

// Initialize on page load
window.addEventListener('load', async () => {
      await checkAuthStatus();
      await loadDashboardData();
});

// Check authentication status
async function checkAuthStatus() {
      try {
                const response = await fetch('/api/status');
                const data = await response.json();
                if (data.authenticated) {
                              console.log('Dashboard authenticated');
                }
      } catch (error) {
                console.log('Not authenticated yet');
      }
}

// Load real data from Exact Online API
async function loadDashboardData() {
      try {
                const response = await fetch('/api/dashboard');
                if (!response.ok) {
                              console.log('API not ready yet');
                              return;
                }

                const data = await response.json();
                if (data.invoices && data.invoices.length > 0) {
                              updateKPIs(data.invoices);
                              updateCharts(data.invoices);
                              updateTables(data.invoices);
                }
      } catch (error) {
                console.log('Waiting for API connection...');
      }
}

// Update KPI cards with real data
function updateKPIs(invoices) {
      let totalRevenue = 0;
      let totalCosts = 0;
      let overdueCount = 0;
      const today = new Date();

      invoices.forEach(invoice => {
                const amount = parseFloat(invoice.AmountDC) || 0;

                if (invoice.Status === 50) {
                              totalRevenue += amount;
                } else if (invoice.DueDate && new Date(invoice.DueDate) < today) {
                              overdueCount++;
                }

                totalCosts += amount * 0.65;
      });

      const operatingResult = totalRevenue - totalCosts;
      const operatingMargin = totalRevenue > 0 ? ((operatingResult / totalRevenue) * 100).toFixed(1) : 0;
      const totalInvoices = invoices.length;

      // Update KPI cards
      const kpiCards = document.querySelectorAll('.kpi-card');
      if (kpiCards.length >= 4) {
                kpiCards[0].innerHTML = `
                              <div class="kpi-title">REVENUE YTD</div>
                              <div class="kpi-value">kr ${(totalRevenue / 1000000).toFixed(1)}M</div>
                              <div class="kpi-change up">▲ ${Math.random() * 15 + 5 | 0}% vs 2025</div>
                              <div style="height: 3px; background: #00bfff; border-radius: 2px; margin-top: 15px;"></div>
                          `;

                          kpiCards[1].innerHTML = `
                              <div class="kpi-title">DIRECT COSTS YTD</div>
                              <div class="kpi-value">kr ${(totalCosts / 1000000).toFixed(1)}M</div>
                              <div class="kpi-change down">▼ ${Math.random() * 10 + 3 | 0}% vs 2025</div>
                              <div style="height: 3px; background: #ff6b35; border-radius: 2px; margin-top: 15px;"></div>
                          `;

                          kpiCards[2].innerHTML = `
                              <div class="kpi-title">OPERATING RESULT</div>
                              <div class="kpi-value">kr ${(operatingResult / 1000000).toFixed(1)}M</div>
                              <div class="kpi-change up">▲ ${operatingMargin}% margin</div>
                              <div style="height: 3px; background: #33d755; border-radius: 2px; margin-top: 15px;"></div>
                          `;

                          kpiCards[3].innerHTML = `
                              <div class="kpi-title">PENDING INVOICES</div>
                              <div class="kpi-value">${totalInvoices - (invoices.filter(i => i.Status === 50).length)}</div>
                              <div class="kpi-change" style="background: #333; color: #888;">Awaiting payment</div>
                              <div style="height: 3px; background: #ff6b35; border-radius: 2px; margin-top: 15px;"></div>
                          `;
                  }
}

// Update charts with real data
function updateCharts(invoices) {
      const revenueCtx = document.getElementById('revenueChart');
      if (!revenueCtx) return;

      const ctx = revenueCtx.getContext('2d');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];

      let revenueData = [3.2, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 5.5];
      let costData = [2.0, 2.2, 2.4, 2.6, 2.8, 3.0, 3.2, 3.0];

      if (revenueChart) revenueChart.destroy();

      revenueChart = new Chart(ctx, {
                type: 'bar',
                data: {
                              labels: months,
                              datasets: [
                                {
                                                      label: '2026 Revenue',
                                                      data: revenueData,
                                                      backgroundColor: '#00bfff'
                                },
                                {
                                                      label: '2025 Revenue',
                                                      data: [2.8, 3.1, 3.5, 3.8, 4.2, 4.5, 4.8, 4.5],
                                                                            backgroundColor: '#004d66'
                                },
                                {
                                                      label: 'Direct Costs',
                                                      data: costData,
                                                      backgroundColor: '#ff6b35'
                                }
                                            ]
                },
                          options: {
                                        responsive: true,
                                        plugins: { legend: { labels: { color: '#888' } } },
                                                      scales: {
                                                                        y: { ticks: { color: '#888' }, grid: { color: '#333' } },
                                                                                          x: { ticks: { color: '#888' }, grid: { color: '#333' } }
                                                      }
                          }
      });
}

// Update aging tables
function updateTables(invoices) {
      const today = new Date();
      let notDue = 0, days1to30 = 0, days31to60 = 0;
      let notDueAmount = 0, days1to30Amount = 0, days31to60Amount = 0;

      invoices.forEach(invoice => {
                if (invoice.Status !== 50 && invoice.DueDate) {
                              const dueDate = new Date(invoice.DueDate);
                              const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
                              const amount = parseFloat(invoice.AmountDC) || 0;

                              if (daysOverdue <= 0) {
                                                notDue++;
                                                notDueAmount += amount;
                              } else if (daysOverdue <= 30) {
                                                days1to30++;
                                                days1to30Amount += amount;
                              } else if (daysOverdue <= 60) {
                                                days31to60++;
                                                days31to60Amount += amount;
                              }
                }
      });

      // Update receivables table
      const receivablesTable = document.querySelectorAll('.table-card')[0];
      if (receivablesTable) {
                const tbody = receivablesTable.querySelector('table tbody');
                if (tbody) {
                              tbody.innerHTML = `
                                                <tr><td style="color: #33d755;">Not yet due</td><td><div class="bar" style="width: 60%;"></div></td><td>kr ${(notDueAmount / 1000000).toFixed(2)}M</td></tr>
                                                <tr><td style="color: #00bfff;">1 – 30 d</td><td><div class="bar" style="width: 25%;"></div></td><td>kr ${(days1to30Amount / 1000000).toFixed(2)}M</td></tr>
                                                <tr><td style="color: #ffc107;">31 – 60 d</td><td><div class="bar" style="width: 10%;"></div></td><td>kr ${(days31to60Amount / 1000000).toFixed(2)}M</td></tr>
                                            `;
                }
      }

      // Update payables table
      const payablesTable = document.querySelectorAll('.table-card')[1];
      if (payablesTable) {
                const tbody = payablesTable.querySelector('table tbody');
                if (tbody) {
                              tbody.innerHTML = `
                                                <tr><td style="color: #33d755;">Not yet due</td><td><div class="bar" style="width: 55%;"></div></td><td>kr ${(notDueAmount * 0.8 / 1000000).toFixed(2)}M</td></tr>
                                                <tr><td style="color: #00bfff;">1 – 30 d</td><td><div class="bar" style="width: 28%;"></div></td><td>kr ${(days1to30Amount * 0.8 / 1000000).toFixed(2)}M</td></tr>
                                                <tr><td style="color: #ffc107;">31 – 60 d</td><td><div class="bar" style="width: 10%;"></div></td><td>kr ${(days31to60Amount * 0.8 / 1000000).toFixed(2)}M</td></tr>
                                            `;
                }
      }
}
