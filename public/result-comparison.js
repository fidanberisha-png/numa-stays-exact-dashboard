/*!
 * Numa Stays - Exact Online: "Result vs previous year" widget
 * Figures taken from the Exact Online financial dashboard, division 3706020 (300 - Numa Norge AS).
 * Reporting currency is NOK (kr). The widget can display the same figures in EUR
 * using a manual rate (DKK or NOK as source currency).
 */
(function () {
  'use strict';

  var COMPANY = '300 - Numa Norge AS';

  /* [revenue, cost, result] per financial period, in reporting currency (kr).
     result = null means the period has no transactions yet. */
  var PERIODS = {
    2024: [
      [1256097.29, 1477745.98, -221648.69],
      [1244785.01, 1518337.15, -273552.14],
      [1585191.61, 1537986.64, 47204.97],
      [1630059.82, 1711505.09, -81445.27],
      [2183004.23, 2017319.20, 165685.03],
      [2742547.76, 1482927.14, 1259620.62],
      [2018249.42, 2140914.95, -122665.53],
      [2621155.96, 2814483.70, -193327.74],
      [2154251.30, 1882507.71, 271743.59],
      [1833468.33, 1863942.02, -30473.69],
      [1732568.49, 1875770.88, -143202.39],
      [1382908.71, 920205.96, 462702.75]
    ],
    2025: [
      [1416324.31, 1927250.22, -510925.91],
      [1404800.54, 1846385.44, -441584.90],
      [1688352.10, 1997916.50, -309564.40],
      [1664386.41, 2056046.04, -391659.63],
      [2524400.10, 2407994.66, 116405.44],
      [3584359.34, 2687278.63, 897080.71],
      [2461506.17, 2416325.75, 45180.42],
      [3170034.23, 2511799.55, 658234.68],
      [2591894.44, 2561944.56, 29949.88],
      [2151969.23, 2319704.77, -167735.54],
      [1860877.22, 2893089.40, -1032212.18],
      [1793404.27, -1232833.12, 3026237.39]
    ],
    2026: [
      [1545068.30, 2214736.74, -669668.44],
      [1493628.51, 2225063.24, -731434.73],
      [1884493.17, 2325811.70, -441318.53],
      [1857532.60, 2416179.90, -558647.30],
      [2924877.36, 2490248.65, 434628.71],
      [3320347.58, 2473583.35, 846764.23],
      [2192006.02, 1155014.25, 1036991.77],
      [0, 967408.08, -967408.08],
      [0, 0, null],
      [0, 0, null],
      [0, 0, null],
      [0, 0, null]
    ]
  };

  /* Manual FX rates to EUR - can be changed in the UI */
  var RATES = { DKK: 0.1340, NOK: 0.0860 };

  var state = { year: 2026, until: 8, currency: 'kr', from: 'DKK', rate: RATES.DKK };
  var chart = null;

  function sum(year, idx, until) {
    var rows = PERIODS[year], total = 0, i, v;
    if (!rows) { return null; }
    for (i = 0; i < until; i++) {
      v = rows[i] ? rows[i][idx] : null;
      if (typeof v === 'number') { total += v; }
    }
    return total;
  }

  function pick(year, idx) {
    var rows = PERIODS[year];
    return rows && rows[state.until - 1] ? rows[state.until - 1][idx] : null;
  }

  function conv(v) {
    if (v === null || v === undefined) { return null; }
    return state.currency === 'EUR' ? v * state.rate : v;
  }

  function symbol() {
    return state.currency === 'EUR' ? '\u20ac' : 'kr';
  }

  function fmt(v) {
    if (v === null || v === undefined) { return '-'; }
    var n = Math.abs(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return symbol() + (v < 0 ? '-' : '') + n;
  }

  function short(v) {
    var a = Math.abs(v);
    if (a >= 1000000) { return (v / 1000000).toFixed(1) + 'M'; }
    if (a >= 1000) { return (v / 1000).toFixed(0) + 'K'; }
    return String(Math.round(v));
  }

  function prevYear() { return state.year - 1; }

  function line(label, value, dim) {
    return '<div style="display:flex;justify-content:space-between;gap:16px;padding:4px 0;font-size:0.95em;color:' +
      (dim ? '#8a6e7d' : '#3d2a36') + '"><span>' + label + '</span><span style="font-weight:600;color:' +
      (dim ? '#8a6e7d' : '#e6007e') + '">' + fmt(value) + '</span></div>';
  }

  function block(title, idx, highlight) {
    return '<div style="flex:1;min-width:230px;padding:14px 18px;border-radius:8px;background:' +
      (highlight ? '#f2d9e6' : 'transparent') + ';border:1px solid #f2d9e6">' +
      '<div class="kpi-title" style="margin-bottom:10px">' + title + '</div>' +
      line(state.year, conv(sum(state.year, idx, state.until)), false) +
      line(prevYear(), conv(sum(prevYear(), idx, state.until)), true) +
      '<div style="height:12px"></div>' +
      line('Period ' + state.until + ' ' + state.year, conv(pick(state.year, idx)), false) +
      line('Period ' + state.until + ' ' + prevYear(), conv(pick(prevYear(), idx)), true) +
      '</div>';
  }

  function template() {
    return '<div class="chart-card" id="exactResultCard" style="margin-bottom:30px">' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px">' +
        '<div class="chart-title" style="margin:0">Result vs previous year - Exact Online</div>' +
        '<div id="erTotals" style="margin-left:auto;color:#3d2a36;font-size:0.95em"></div>' +
      '</div>' +
      '<div style="color:#8a6e7d;font-size:0.85em;margin:6px 0 18px">' + COMPANY +
        ' - figures from Exact Online, reporting currency NOK (kr)</div>' +
      '<div class="filters" style="margin-bottom:20px">' +
        '<div class="filter-group"><label>Financial year:</label><select id="erYear"></select></div>' +
        '<div class="filter-group"><label>Until period:</label><select id="erPeriod"></select></div>' +
        '<div class="filter-group"><label>Currency:</label><select id="erCurrency">' +
          '<option value="kr">kr - reporting (NOK)</option><option value="EUR">EUR</option></select></div>' +
        '<div class="filter-group" id="erFromGroup"><label>Convert from:</label><select id="erFrom">' +
          '<option value="DKK">DKK</option><option value="NOK">NOK</option></select></div>' +
        '<div class="filter-group" id="erRateGroup"><label>Rate to EUR:</label>' +
          '<input id="erRate" type="number" step="0.0001" min="0" style="width:110px;padding:6px;border-radius:6px;' +
          'border:1px solid #f2d9e6;background:#ffffff;color:#3d2a36"></div>' +
      '</div>' +
      '<div id="erBlocks" style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px"></div>' +
      '<div style="height:340px"><canvas id="exactResultChart"></canvas></div>' +
      '<div style="text-align:center;color:#8a6e7d;margin-top:10px">Result per period</div>' +
    '</div>';
  }

  function series(year) {
    var rows = PERIODS[year] || [];
    return rows.map(function (r) {
      return r && typeof r[2] === 'number' ? conv(r[2]) : null;
    });
  }

  function drawChart() {
    var el = document.getElementById('exactResultChart');
    if (!el || typeof Chart === 'undefined') { return; }
    if (chart) { chart.destroy(); }
    chart = new Chart(el.getContext('2d'), {
      type: 'line',
      data: {
        labels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        datasets: [
          {
            label: String(state.year), data: series(state.year),
            borderColor: '#e6007e', backgroundColor: '#e6007e',
            pointRadius: 4, pointBackgroundColor: '#ffffff', borderWidth: 2, tension: 0
          },
          {
            label: String(prevYear()), data: series(prevYear()),
            borderColor: '#8a6e7d', backgroundColor: '#8a6e7d',
            pointRadius: 4, pointBackgroundColor: '#ffffff', borderWidth: 2, tension: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#7a6672' } },
          tooltip: {
            callbacks: {
              label: function (c) { return c.dataset.label + ': ' + fmt(c.parsed.y); }
            }
          }
        },
        scales: {
          x: { ticks: { color: '#7a6672' }, grid: { color: '#f2d9e6' } },
          y: { ticks: { color: '#7a6672', callback: function (v) { return short(v); } }, grid: { color: '#f2d9e6' } }
        }
      }
    });
  }

  function update() {
    document.getElementById('erBlocks').innerHTML =
      block('Revenue', 0, false) + block('Cost', 1, false) + block('Result', 2, true);
    document.getElementById('erTotals').innerHTML =
      state.year + ' : ' + fmt(conv(sum(state.year, 2, state.until))) + '  |  ' +
      prevYear() + ' : ' + fmt(conv(sum(prevYear(), 2, state.until)));
    drawChart();
  }

  function toggleFx() {
    var on = state.currency === 'EUR';
    document.getElementById('erFromGroup').style.display = on ? '' : 'none';
    document.getElementById('erRateGroup').style.display = on ? '' : 'none';
  }

  function init() {
    var container = document.querySelector('.container');
    if (!container || document.getElementById('exactResultCard')) { return; }
    var wrap = document.createElement('div');
    wrap.innerHTML = template();
    container.appendChild(wrap.firstChild);

    var yearSel = document.getElementById('erYear');
    Object.keys(PERIODS).filter(function (y) {
      return PERIODS[String(Number(y) - 1)];
    }).forEach(function (y) {
      yearSel.innerHTML += '<option value="' + y + '">' + y + '</option>';
    });
    yearSel.value = String(state.year);

    var periodSel = document.getElementById('erPeriod');
    for (var i = 1; i <= 12; i++) {
      periodSel.innerHTML += '<option value="' + i + '">' + i + '</option>';
    }
    periodSel.value = String(state.until);

    document.getElementById('erCurrency').value = state.currency;
    document.getElementById('erFrom').value = state.from;
    document.getElementById('erRate').value = state.rate;
    toggleFx();

    yearSel.addEventListener('change', function () {
      state.year = Number(this.value);
      state.until = Math.min(state.until, 12);
      update();
    });
    periodSel.addEventListener('change', function () {
      state.until = Number(this.value);
      update();
    });
    document.getElementById('erCurrency').addEventListener('change', function () {
      state.currency = this.value;
      toggleFx();
      update();
    });
    document.getElementById('erFrom').addEventListener('change', function () {
      state.from = this.value;
      state.rate = RATES[state.from];
      document.getElementById('erRate').value = state.rate;
      update();
    });
    document.getElementById('erRate').addEventListener('input', function () {
      var v = parseFloat(this.value);
      if (!isNaN(v) && v > 0) { state.rate = v; update(); }
    });

    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.NumaExactResult = { periods: PERIODS, rates: RATES, state: state, refresh: update };
})();
