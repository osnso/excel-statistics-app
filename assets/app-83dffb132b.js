(function(){
  if (window.__ADV_UI_INIT) return;
  window.__ADV_UI_INIT = true;

  var CURRENT_DATA = null; // { headers: [...], data: [[...], ...] }
  var CURRENT_CAT = 'descriptive_advanced';
  var CURRENT_SUB = 'cv_skew_kurt';
  var CURRENT_RESULT = null;

  // Category -> sub-types mapping
  var SUB_TYPES = {
    descriptive_advanced: [
      { id: 'cv_skew_kurt', label: '离散系数与分布形态', params: ['col'] }
    ],
    distribution: [
      { id: 'normal', label: '正态分布', params: ['col'] },
      { id: 't', label: 't 分布', params: ['col'] },
      { id: 'f', label: 'F 分布', params: ['col', 'df1', 'df2'] },
      { id: 'chisq', label: '卡方分布', params: ['col', 'df', 'expectedVar'] }
    ],
    chisquare: [
      { id: 'gof', label: '拟合优度检验', params: ['col'] },
      { id: 'contingency', label: '列联分析', params: ['rowCol', 'colCol'] }
    ],
    timeseries: [
      { id: 'ts_descriptive', label: '描述性统计', params: ['col'] },
      { id: 'ts_decomp', label: '季节分解', params: ['col', 'period'] },
      { id: 'ts_ma', label: '移动平均预测', params: ['col', 'window'] },
      { id: 'ts_exp', label: '指数平滑预测', params: ['col', 'alpha'] },
      { id: 'ts_trend', label: '线性趋势预测', params: ['col'] }
    ]
  };

  // Parameter definitions
  var PARAM_DEFS = {
    col: { label: '数据列', type: 'select' },
    rowCol: { label: '行变量列', type: 'select' },
    colCol: { label: '列变量列', type: 'select' },
    period: { label: '季节周期', type: 'number', default: '4', hint: '例如：季度数据=4，月度数据=12' },
    window: { label: '移动窗口', type: 'number', default: '3', hint: '用于计算平均值的期数' },
    alpha: { label: '平滑系数 α', type: 'number', default: '0.3', hint: '0~1，越大越依赖近期数据' },
    df1: { label: '分子自由度 df1', type: 'number', default: '1' },
    df2: { label: '分母自由度 df2', type: 'number', default: '10' },
    df: { label: '自由度 df', type: 'number', default: '5' },
    expectedVar: { label: '期望方差', type: 'number', default: '1' }
  };

  function getCatLabel(cat) {
    var labels = { descriptive_advanced: '描述性统计进阶', distribution: '概率分布', chisquare: '卡方检验', timeseries: '时间序列分析' };
    return labels[cat] || cat;
  }

  // Render sub-type buttons
  function renderSubtypes(cat) {
    var container = document.getElementById('advSubtypes');
    var subs = SUB_TYPES[cat] || [];
    if (subs.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = subs.map(function(s) {
      return '<button class="adv-subtype-btn' + (s.id === CURRENT_SUB ? ' active' : '') + '" data-sub="' + s.id + '">' + s.label + '</button>';
    }).join('');
    // Attach events
    var btns = container.querySelectorAll('.adv-subtype-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function() {
        container.querySelectorAll('.adv-subtype-btn').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
        CURRENT_SUB = this.getAttribute('data-sub');
        renderParams(CURRENT_CAT, CURRENT_SUB);
      });
    }
    // Auto-select first sub
    if (subs.length > 0) {
      var activeSub = container.querySelector('.adv-subtype-btn.active');
      if (!activeSub) {
        var first = container.querySelector('.adv-subtype-btn');
        if (first) { first.classList.add('active'); CURRENT_SUB = subs[0].id; }
      }
      renderParams(cat, CURRENT_SUB);
    }
  }

  // Render parameter inputs
  function renderParams(cat, sub) {
    var container = document.getElementById('advParams');
    var subs = SUB_TYPES[cat] || [];
    var found = null;
    for (var i = 0; i < subs.length; i++) {
      if (subs[i].id === sub) { found = subs[i]; break; }
    }
    if (!found || !found.params || found.params.length === 0) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'grid';
    container.innerHTML = found.params.map(function(p) {
      var def = PARAM_DEFS[p] || { label: p, type: 'text', default: '' };
      if (def.type === 'select') {
        return '<div class="adv-param-group"><label>' + def.label + '</label><select id="advParam_' + p + '"><option value="">-- 先获取数据 --</option></select></div>';
      } else {
        return '<div class="adv-param-group"><label>' + def.label + '</label><input type="' + def.type + '" id="advParam_' + p + '" value="' + (def.default || '') + '" placeholder="' + (def.hint || '') + '"><span style="font-size:0.75rem;color:#9ca3af">' + (def.hint || '') + '</span></div>';
      }
    }).join('');
    // Populate column selects if data available
    populateColumnSelects();
  }

  function populateColumnSelects() {
    if (!CURRENT_DATA) return;
    var selects = document.querySelectorAll('#advParams select');
    for (var i = 0; i < selects.length; i++) {
      var currentVal = selects[i].value;
      selects[i].innerHTML = '<option value="">-- 选择列 --</option>';
      // Check which params need numeric or categorical
      var paramId = selects[i].id.replace('advParam_', '');
      var needsNumeric = true; // default
      // For GOF and contingency, some selects need categorical
      if (CURRENT_SUB === 'gof' || paramId === 'rowCol' || paramId === 'colCol') {
        needsNumeric = false;
      }
      for (var c = 0; c < CURRENT_DATA.headers.length; c++) {
        var h = CURRENT_DATA.headers[c];
        var selected = (h === currentVal) ? ' selected' : '';
        selects[i].innerHTML += '<option value="' + c + '"' + selected + '>' + h + '</option>';
      }
    }
  }

  // Extract data from table
  function fetchFromTable() {
    var tables = document.querySelectorAll('.table-wrapper table');
    if (!tables.length) {
      setStatus('未找到数据表格，请先上传数据', false);
      return false;
    }
    var table = tables[0];
    var headers = [];
    var headerRow = table.querySelector('thead tr');
    if (headerRow) {
      var ths = headerRow.querySelectorAll('th');
      for (var i = 0; i < ths.length; i++) headers.push(ths[i].textContent.trim());
    }
    var data = [];
    var rows = table.querySelectorAll('tbody tr');
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].querySelectorAll('td');
      var rowData = [];
      for (var c = 0; c < cells.length; c++) rowData.push(cells[c].textContent.trim());
      if (rowData.length > 0) data.push(rowData);
    }
    if (headers.length === 0 || data.length === 0) {
      setStatus('未能从表格中提取数据', false);
      return false;
    }
    CURRENT_DATA = { headers: headers, data: data };
    populateColumnSelects();
    setStatus('已获取 ' + data.length + ' 行 x ' + headers.length + ' 列数据 ✓', true);
    return true;
  }

  function setStatus(msg, ok) {
    var el = document.getElementById('advStatus');
    el.textContent = msg;
    el.className = 'adv-status' + (ok ? ' ok' : '');
  }

  function getParamValues() {
    var params = {};
    var subs = SUB_TYPES[CURRENT_CAT] || [];
    var found = null;
    for (var i = 0; i < subs.length; i++) {
      if (subs[i].id === CURRENT_SUB) { found = subs[i]; break; }
    }
    if (found && found.params) {
      for (var j = 0; j < found.params.length; j++) {
        var el = document.getElementById('advParam_' + found.params[j]);
        if (el) params[found.params[j]] = el.value;
      }
    }
    return params;
  }

  // Render results
  function renderResult(result) {
    var container = document.getElementById('advResult');
    if (!result) {
      container.innerHTML = '<div class="adv-result-empty">选择分析类型后点击"运行分析"</div>';
      return;
    }
    if (result.error) {
      container.innerHTML = '<div class="adv-error">' + result.error + '</div>';
      return;
    }

    var html = '';
    if (result.title) {
      html += '<h3 style="font-size:0.95rem;font-weight:600;color:#1f2937;margin:0 0 12px">📊 ' + result.title + '</h3>';
    }

    // Main result table
    if (result.rows && result.rows.length > 0) {
      html += '<table class="adv-result-table"><thead><tr><th>指标</th><th style="text-align:right">值</th><th>说明</th></tr></thead><tbody>';
      for (var i = 0; i < result.rows.length; i++) {
        var r = result.rows[i];
        html += '<tr><td class="label">' + r.label + '</td><td class="value">' + r.value + '</td><td class="note">' + (r.note || '') + '</td></tr>';
      }
      html += '</tbody></table>';
    }

    // Extra table (e.g. observed/expected for GOF, contingency matrix)
    if (result.extraRows && Array.isArray(result.extraRows) && !Array.isArray(result.extraRows[0])) {
      html += '<table class="adv-extra-table"><thead><tr><th>类别</th><th>观测频数</th><th>期望频数</th></tr></thead><tbody>';
      for (var k = 0; k < result.extraRows.length; k++) {
        html += '<tr><td>' + result.extraRows[k].category + '</td><td>' + result.extraRows[k].observed + '</td><td>' + result.extraRows[k].expected + '</td></tr>';
      }
      html += '</tbody></table>';
    }

    // Contingency matrix
    if (result.rowCats && result.colCats && result.extraRows) {
      html += '<h4 style="font-size:0.85rem;font-weight:600;margin:12px 0 8px;color:#374151">列联表</h4>';
      html += '<table class="adv-extra-table"><thead><tr><th></th>';
      for (var ci = 0; ci < result.colCats.length; ci++) html += '<th>' + result.colCats[ci] + '</th>';
      html += '</tr></thead><tbody>';
      for (var ri = 0; ri < result.rowCats.length; ri++) {
        html += '<tr><td style="font-weight:600">' + result.rowCats[ri] + '</td>';
        for (var cj = 0; cj < result.colCats.length; cj++) {
          html += '<td>' + (result.extraRows[ri] ? result.extraRows[ri][cj] || 0 : 0) + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
    }

    // Chart
    if (result.chart) {
      html += '<div class="adv-chart-container"><canvas id="advChart"></canvas></div>';
    }

    container.innerHTML = html;

    // Draw chart if needed
    if (result.chart) {
      setTimeout(function() { drawChart(result.chart); }, 50);
    }

    document.getElementById('advCopyBtn').style.display = 'inline-flex';
    CURRENT_RESULT = result;
  }

  // Simple SVG charting (no external dependencies)
  function drawChart(chartData) {
    var canvas = document.getElementById('advChart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.parentElement.clientWidth - 32;
    var H = 260;
    canvas.width = W * (window.devicePixelRatio || 1);
    canvas.height = H * (window.devicePixelRatio || 1);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    var padding = { top: 20, right: 20, bottom: 40, left: 55 };
    var plotW = W - padding.left - padding.right;
    var plotH = H - padding.top - padding.bottom;

    ctx.clearRect(0, 0, W, H);

    if (chartData.type === 'distribution' || chartData.type === 't' || chartData.type === 'f' || chartData.type === 'chisq') {
      // Distribution PDF plot
      var pdf = chartData.pdf || [];
      if (pdf.length === 0) return;
      var xMin = pdf[0].x, xMax = pdf[pdf.length - 1].x;
      var yMin = 0, yMax = 0;
      for (var i = 0; i < pdf.length; i++) { if (pdf[i].y > yMax) yMax = pdf[i].y; }
      yMax *= 1.1;

      function xPos(x) { return padding.left + (x - xMin) / (xMax - xMin) * plotW; }
      function yPos(y) { return padding.top + plotH - (y - yMin) / (yMax - yMin) * plotH; }

      // Grid
      ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
      for (var gx = 0; gx <= 5; gx++) {
        var xg = padding.left + gx / 5 * plotW;
        ctx.beginPath(); ctx.moveTo(xg, padding.top); ctx.lineTo(xg, padding.top + plotH); ctx.stroke();
      }
      for (var gy = 0; gy <= 4; gy++) {
        var yg = padding.top + gy / 4 * plotH;
        ctx.beginPath(); ctx.moveTo(padding.left, yg); ctx.lineTo(padding.left + plotW, yg); ctx.stroke();
      }

      // PDF fill
      ctx.beginPath();
      ctx.moveTo(xPos(pdf[0].x), yPos(0));
      for (var p = 0; p < pdf.length; p++) ctx.lineTo(xPos(pdf[p].x), yPos(pdf[p].y));
      ctx.lineTo(xPos(pdf[pdf.length - 1].x), yPos(0));
      ctx.closePath();
      ctx.fillStyle = 'rgba(79,70,229,0.15)'; ctx.fill();

      // PDF line
      ctx.beginPath();
      for (var q = 0; q < pdf.length; q++) {
        q === 0 ? ctx.moveTo(xPos(pdf[q].x), yPos(pdf[q].y)) : ctx.lineTo(xPos(pdf[q].x), yPos(pdf[q].y));
      }
      ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2; ctx.stroke();

      // Shade tail for significance
      if (chartData.tStat !== undefined) {
        var critX = Math.abs(chartData.tStat);
        var critPx = xPos(Math.max(critX, xMin));
        ctx.fillStyle = 'rgba(239,68,68,0.2)';
        ctx.beginPath();
        ctx.moveTo(critPx, yPos(0));
        for (var t1 = 0; t1 < pdf.length; t1++) {
          if (pdf[t1].x >= critX) ctx.lineTo(xPos(pdf[t1].x), yPos(pdf[t1].y));
        }
        ctx.lineTo(xPos(pdf[pdf.length - 1].x), yPos(0));
        ctx.closePath(); ctx.fill();

        // Left tail
        ctx.beginPath();
        ctx.moveTo(xPos(pdf[0].x), yPos(0));
        for (var t2 = 0; t2 < pdf.length; t2++) {
          if (pdf[t2].x <= -critX) ctx.lineTo(xPos(pdf[t2].x), yPos(pdf[t2].y));
        }
        ctx.lineTo(xPos(-critX), yPos(0));
        ctx.closePath(); ctx.fill();
      }
      if (chartData.fStat !== undefined) {
        var fPx = xPos(chartData.fStat);
        ctx.fillStyle = 'rgba(239,68,68,0.2)';
        ctx.beginPath();
        ctx.moveTo(fPx, yPos(0));
        for (var f1 = 0; f1 < pdf.length; f1++) {
          if (pdf[f1].x >= chartData.fStat) ctx.lineTo(xPos(pdf[f1].x), yPos(pdf[f1].y));
        }
        ctx.lineTo(xPos(pdf[pdf.length - 1].x), yPos(0));
        ctx.closePath(); ctx.fill();
      }
      if (chartData.chi2 !== undefined) {
        var cPx = xPos(chartData.chi2);
        ctx.fillStyle = 'rgba(239,68,68,0.2)';
        ctx.beginPath();
        ctx.moveTo(cPx, yPos(0));
        for (var c1 = 0; c1 < pdf.length; c1++) {
          if (pdf[c1].x >= chartData.chi2) ctx.lineTo(xPos(pdf[c1].x), yPos(pdf[c1].y));
        }
        ctx.lineTo(xPos(pdf[pdf.length - 1].x), yPos(0));
        ctx.closePath(); ctx.fill();
      }

      // X axis
      ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padding.left, padding.top + plotH); ctx.lineTo(padding.left + plotW, padding.top + plotH); ctx.stroke();
      ctx.fillStyle = '#6b7280'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      for (var lx = 0; lx <= 5; lx++) {
        var xl = xMin + lx / 5 * (xMax - xMin);
        ctx.fillText(xl.toFixed(1), xPos(xl), padding.top + plotH + 16);
      }

      // Y axis
      ctx.beginPath(); ctx.moveTo(padding.left, padding.top); ctx.lineTo(padding.left, padding.top + plotH); ctx.stroke();
      ctx.textAlign = 'right';
      for (var ly = 0; ly <= 4; ly++) {
        var yl = yMin + ly / 4 * (yMax - yMin);
        ctx.fillText(yl.toFixed(2), padding.left - 6, yPos(yl) + 4);
      }

      // Label
      ctx.fillStyle = '#374151'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      var chartLabels = { distribution: '概率密度函数', t: 't 分布概率密度', f: 'F 分布概率密度', chisq: '卡方分布概率密度' };
      ctx.fillText(chartLabels[chartData.type] || '概率密度', W / 2, padding.top - 6);

    } else if (chartData.type === 'ts_line' || chartData.type === 'ts_forecast') {
      // Time series line chart
      var vals = chartData.data || [];
      if (vals.length === 0) return;
      var xMin2 = 0, xMax2 = Math.max(vals.length - 1, 1);
      var yMin2 = Math.min.apply(null, vals), yMax2 = Math.max.apply(null, vals);
      var range = yMax2 - yMin2 || 1;
      yMin2 -= range * 0.1; yMax2 += range * 0.1;

      function xP(x) { return padding.left + (x - xMin2) / (xMax2 - xMin2) * plotW; }
      function yP(y) { return padding.top + plotH - (y - yMin2) / (yMax2 - yMin2) * plotH; }

      // Grid
      ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
      for (var gx2 = 0; gx2 <= 5; gx2++) {
        var xg2 = padding.left + gx2 / 5 * plotW;
        ctx.beginPath(); ctx.moveTo(xg2, padding.top); ctx.lineTo(xg2, padding.top + plotH); ctx.stroke();
      }
      for (var gy2 = 0; gy2 <= 4; gy2++) {
        var yg2 = padding.top + gy2 / 4 * plotH;
        ctx.beginPath(); ctx.moveTo(padding.left, yg2); ctx.lineTo(padding.left + plotW, yg2); ctx.stroke();
      }

      // Original data
      ctx.beginPath();
      for (var d = 0; d < vals.length; d++) {
        d === 0 ? ctx.moveTo(xP(d), yP(vals[d])) : ctx.lineTo(xP(d), yP(vals[d]));
      }
      ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2; ctx.stroke();

      // Data points
      for (var d2 = 0; d2 < vals.length; d2++) {
        ctx.beginPath(); ctx.arc(xP(d2), yP(vals[d2]), 3, 0, Math.PI * 2); ctx.fillStyle = '#4f46e5'; ctx.fill();
      }

      // Forecasts (smoothed / fitted)
      if (chartData.forecasts) {
        var fData = chartData.forecasts;
        var offset = chartData.type === 'ts_forecast' && !chartData.trend ? (chartData.window || 1) : 0;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        for (var f = 0; f < fData.length; f++) {
          var idx = f + offset;
          f === 0 ? ctx.moveTo(xP(idx), yP(fData[f])) : ctx.lineTo(xP(idx), yP(fData[f]));
        }
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.setLineDash([]);

        // Forecast points
        for (var f2 = 0; f2 < fData.length; f2++) {
          ctx.beginPath(); ctx.arc(xP(f2 + offset), yP(fData[f2]), 3, 0, Math.PI * 2); ctx.fillStyle = '#ef4444'; ctx.fill();
        }
      }

      if (chartData.type === 'ts_forecast' && chartData.data && chartData.forecasts) {
        // Legend
        ctx.fillStyle = '#4f46e5'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillRect(W - 150, padding.top, 10, 3); ctx.fillText(' 实际值', W - 136, padding.top + 5);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(W - 75, padding.top, 10, 3); ctx.fillText(' 拟合/预测', W - 61, padding.top + 5);
      }

      // Axes
      ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padding.left, padding.top + plotH); ctx.lineTo(padding.left + plotW, padding.top + plotH); ctx.stroke();
      ctx.fillStyle = '#6b7280'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      for (var lx2 = 0; lx2 <= 5; lx2++) {
        var xl2 = Math.round(xMin2 + lx2 / 5 * xMax2);
        ctx.fillText(xl2.toString(), xP(xl2), padding.top + plotH + 16);
      }
      ctx.beginPath(); ctx.moveTo(padding.left, padding.top); ctx.lineTo(padding.left, padding.top + plotH); ctx.stroke();
      ctx.textAlign = 'right';
      for (var ly2 = 0; ly2 <= 4; ly2++) {
        var yl2 = yMin2 + ly2 / 4 * (yMax2 - yMin2);
        ctx.fillText(yl2.toFixed(1), padding.left - 6, yP(yl2) + 4);
      }
      ctx.fillStyle = '#374151'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(chartData.label || '时间序列', W / 2, padding.top - 6);

    } else if (chartData.type === 'ts_decomp') {
      // Draw original data only (simplified)
      var dVals = chartData.data || [];
      if (dVals.length === 0) return;
      var xM3 = 0, xM4 = Math.max(dVals.length - 1, 1);
      var yM3 = Math.min.apply(null, dVals), yM4 = Math.max.apply(null, dVals);
      var r3 = yM4 - yM3 || 1;
      yM3 -= r3 * 0.1; yM4 += r3 * 0.1;

      function xP3(x) { return padding.left + (x - xM3) / (xM4 - xM3) * plotW; }
      function yP3(y) { return padding.top + plotH - (y - yM3) / (yM4 - yM3) * plotH; }

      ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
      for (var a = 0; a <= 5; a++) {
        var xa = padding.left + a / 5 * plotW;
        ctx.beginPath(); ctx.moveTo(xa, padding.top); ctx.lineTo(xa, padding.top + plotH); ctx.stroke();
      }

      ctx.beginPath();
      for (var d3 = 0; d3 < dVals.length; d3++) {
        d3 === 0 ? ctx.moveTo(xP3(d3), yP3(dVals[d3])) : ctx.lineTo(xP3(d3), yP3(dVals[d3]));
      }
      ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2; ctx.stroke();

      if (chartData.trend) {
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        for (var t = 0; t < chartData.trend.length; t++) {
          if (isNaN(chartData.trend[t])) continue;
          t === 0 ? ctx.moveTo(xP3(t), yP3(chartData.trend[t])) : ctx.lineTo(xP3(t), yP3(chartData.trend[t]));
        }
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = '#6b7280'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      for (var b = 0; b <= 5; b++) {
        ctx.fillText(Math.round(xM3 + b / 5 * xM4).toString(), xP3(Math.round(xM3 + b / 5 * xM4)), padding.top + plotH + 16);
      }
      ctx.fillStyle = '#374151'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('时间序列分解 (蓝色=原始, 红色=趋势)', W / 2, padding.top - 6);
      // Axes
      ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padding.left, padding.top + plotH); ctx.lineTo(padding.left + plotW, padding.top + plotH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padding.left, padding.top); ctx.lineTo(padding.left, padding.top + plotH); ctx.stroke();
    }
  }

  // ====== EVENT BINDING ======

  // Tab switching
  var tabs = document.getElementById('advTabs');
  tabs.addEventListener('click', function(e) {
    var btn = e.target.closest('.adv-tab');
    if (!btn) return;
    tabs.querySelectorAll('.adv-tab').forEach(function(t) { t.classList.remove('active'); });
    btn.classList.add('active');
    CURRENT_CAT = btn.getAttribute('data-cat');
    CURRENT_SUB = (SUB_TYPES[CURRENT_CAT] || [])[0]?.id || '';
    renderSubtypes(CURRENT_CAT);
  });

  // Fetch data button
  document.getElementById('advFetchBtn').addEventListener('click', function() {
    fetchFromTable();
    document.getElementById('advCopyBtn').style.display = 'none';
  });

  // Run button
  document.getElementById('advRunBtn').addEventListener('click', function() {
    if (!CURRENT_DATA) {
      setStatus('请先点击"从表格获取数据"', false);
      return;
    }
    var params = getParamValues();
    // Validate column params are not empty
    var subs = SUB_TYPES[CURRENT_CAT] || [];
    var found = null;
    for (var i = 0; i < subs.length; i++) {
      if (subs[i].id === CURRENT_SUB) { found = subs[i]; break; }
    }
    if (found && found.params) {
      for (var j = 0; j < found.params.length; j++) {
        if ((found.params[j] === 'col' || found.params[j] === 'rowCol' || found.params[j] === 'colCol') && (!params[found.params[j]] || params[found.params[j]] === '')) {
          setStatus('请选择数据列', false);
          return;
        }
      }
    }
    this.textContent = '⏳ 计算中...';
    this.disabled = true;
    setStatus('正在分析...', false);
    // Use setTimeout to allow UI update
    var self = this;
    setTimeout(function() {
      try {
        var result = ADV.runAnalysis(CURRENT_CAT, CURRENT_SUB, CURRENT_DATA, params);
        renderResult(result);
        if (result && !result.error) {
          setStatus('分析完成 ✓', true);
        }
      } catch (e) {
        renderResult({ error: e.message });
        setStatus('分析出错', false);
      }
      self.textContent = '▶ 运行分析';
      self.disabled = false;
    }, 50);
  });

  // Copy button
  document.getElementById('advCopyBtn').addEventListener('click', function() {
    if (!CURRENT_RESULT || !CURRENT_RESULT.rows) return;
    var text = CURRENT_RESULT.title + '\n';
    for (var i = 0; i < CURRENT_RESULT.rows.length; i++) {
      text += CURRENT_RESULT.rows[i].label + '\t' + CURRENT_RESULT.rows[i].value + '\t' + (CURRENT_RESULT.rows[i].note || '') + '\n';
    }
    navigator.clipboard.writeText(text).then(function() {
      var old = document.getElementById('advStatus').textContent;
      setStatus('已复制到剪贴板 ✓', true);
      setTimeout(function() { setStatus(old, true); }, 2000);
    });
  });

  // Initialize with first category
  renderSubtypes(CURRENT_CAT);
})();
