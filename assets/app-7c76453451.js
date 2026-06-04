/* --- ADV Statistical Library --- */
window.ADV = {};

// Support: Error function (Horner approximation)
ADV.erf = function(x) {
  var sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  var a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  var t = 1 / (1 + p * x);
  var y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
};

ADV.SQRT2PI = Math.sqrt(2 * Math.PI);

// Lanczos approximation (g=7, coefficients from GNU Scientific Library)
ADV.logGamma = function(z) {
  var c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
           771.32342877765313, -176.61502916214059, 12.507343278686905,
           -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - ADV.logGamma(1 - z);
  z -= 1;
  var x = c[0];
  for (var i = 1; i < 9; i++) x += c[i] / (z + i);
  var t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
};

// Regularized Lower Incomplete Gamma Function P(a,x)
ADV.lowRegIncGamma = function(a, x) {
  if (x < a + 1) {
    // Series expansion
    var ap = a, sum = 1 / a, del = sum;
    for (var n = 1; n <= 100; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-10) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - ADV.logGamma(a));
  } else {
    // Continued fraction
    var b = x + 1 - a, c = 1 / 1e-30, d = 1 / b, h = d;
    for (var n = 1; n <= 100; n++) {
      var an = -n * (n - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = b + an / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-10) break;
    }
    return 1 - h * Math.exp(-x + a * Math.log(x) - ADV.logGamma(a));
  }
};

// Regularized Incomplete Beta Function I_x(a,b) using continued fraction
ADV.regIncBeta = function(a, b, x) {
  if (x < 0 || x > 1) return NaN;
  if (x === 0 || x === 1) return x;
  // Use symmetry: I_x(a,b) = 1 - I_{1-x}(b,a) for x > (a+1)/(a+b+2)
  var bt = Math.exp(ADV.logGamma(a + b) - ADV.logGamma(a) - ADV.logGamma(b) +
           a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return bt * ADV._betaCFrac(a, b, x) / a;
  } else {
    return 1 - bt * ADV._betaCFrac(b, a, 1 - x) / b;
  }
};

// Modified Lentz's continued fraction for incomplete beta
ADV._betaCFrac = function(a, b, x) {
  var qab = a + b, qap = a + 1, qam = a - 1;
  var c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  var h = d;
  for (var m = 1; m <= 200; m++) {
    var m2 = 2 * m;
    // Even step
    var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    // Odd step
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    var del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-10) break;
  }
  return h;
};

// === DISTRIBUTIONS ===

ADV.normalPDF = function(x, mean, std) {
  if (std === undefined) std = 1;
  if (mean === undefined) mean = 0;
  var z = (x - mean) / std;
  return Math.exp(-0.5 * z * z) / (std * ADV.SQRT2PI);
};

ADV.normalCDF = function(x, mean, std) {
  if (std === undefined) std = 1;
  if (mean === undefined) mean = 0;
  return 0.5 * (1 + ADV.erf((x - mean) / (std * Math.SQRT2)));
};

ADV.tCDF = function(t, df) {
  if (df <= 0) return NaN;
  var x = df / (df + t * t);
  return 1 - 0.5 * ADV.regIncBeta(df / 2, 0.5, x);
};

ADV.fCDF = function(f, df1, df2) {
  if (df1 <= 0 || df2 <= 0 || f < 0) return NaN;
  var x = df1 * f / (df1 * f + df2);
  return ADV.regIncBeta(df1 / 2, df2 / 2, x);
};

ADV.chiSquarePDF = function(x, df) {
  if (x < 0 || df <= 0) return 0;
  return Math.pow(x, df / 2 - 1) * Math.exp(-x / 2) /
         (Math.pow(2, df / 2) * Math.exp(ADV.logGamma(df / 2)));
};

ADV.chiSquareCDF = function(x, df) {
  if (x < 0 || df <= 0) return NaN;
  return ADV.lowRegIncGamma(df / 2, x / 2);
};

// === HYPOTHESIS TESTS ===

ADV.chiSquareGOF = function(observed, expected) {
  if (!observed || !expected || observed.length !== expected.length) return null;
  var chi2 = 0, n = observed.length;
  for (var i = 0; i < n; i++) {
    if (expected[i] <= 0) return null;
    chi2 += (observed[i] - expected[i]) * (observed[i] - expected[i]) / expected[i];
  }
  var df = n - 1;
  var p = 1 - ADV.chiSquareCDF(chi2, df);
  return { chi2: chi2, df: df, p: p };
};

ADV.chiSquareContingency = function(matrix) {
  if (!matrix || matrix.length < 2 || matrix[0].length < 2) return null;
  var rows = matrix.length, cols = matrix[0].length;
  var rowSums = new Array(rows).fill(0);
  var colSums = new Array(cols).fill(0);
  var total = 0;
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      var v = matrix[r][c];
      rowSums[r] += v;
      colSums[c] += v;
      total += v;
    }
  }
  var chi2 = 0;
  for (var r2 = 0; r2 < rows; r2++) {
    for (var c2 = 0; c2 < cols; c2++) {
      var expected = rowSums[r2] * colSums[c2] / total;
      if (expected > 0) {
        chi2 += (matrix[r2][c2] - expected) * (matrix[r2][c2] - expected) / expected;
      }
    }
  }
  var df = (rows - 1) * (cols - 1);
  var p = 1 - ADV.chiSquareCDF(chi2, df);
  // Cramer's V
  var cramerV = Math.sqrt(chi2 / (total * Math.min(rows - 1, cols - 1)));
  return { chi2: chi2, df: df, p: p, cramerV: cramerV, n: total };
};

// === DESCRIPTIVE ADVANCED ===

ADV.mean = function(arr) {
  var s = 0, n = arr.length;
  for (var i = 0; i < n; i++) s += arr[i];
  return s / n;
};

ADV.calcCV = function(data) {
  var n = data.length;
  if (n < 2) return null;
  var m = ADV.mean(data);
  if (m === 0) return null;
  var sq = 0;
  for (var i = 0; i < n; i++) sq += (data[i] - m) * (data[i] - m);
  var std = Math.sqrt(sq / (n - 1));
  return { cv: std / m, cvPercent: (std / m) * 100, mean: m, std: std, n: n };
};

ADV.calcSkewness = function(data) {
  var n = data.length;
  if (n < 3) return null;
  var m = ADV.mean(data);
  var sq = 0, cb = 0;
  for (var i = 0; i < n; i++) {
    var d = data[i] - m;
    sq += d * d;
    cb += d * d * d;
  }
  var var_ = sq / (n - 1);
  var std = Math.sqrt(var_);
  if (std === 0) return 0;
  var skew = (n / ((n - 1) * (n - 2))) * cb / (std * std * std);
  return skew;
};

ADV.calcKurtosis = function(data) {
  var n = data.length;
  if (n < 4) return null;
  var m = ADV.mean(data);
  var sq = 0, fr = 0;
  for (var i = 0; i < n; i++) {
    var d = data[i] - m;
    sq += d * d;
    fr += d * d * d * d;
  }
  var var_ = sq / (n - 1);
  if (var_ === 0) return 0;
  var std = Math.sqrt(var_);
  var kurt = (n * (n + 1) / ((n - 1) * (n - 2) * (n - 3))) * fr / (std * std * std * std);
  var excess = kurt - 3 * (n - 1) * (n - 1) / ((n - 2) * (n - 3));
  return { kurtosis: kurt, excessKurtosis: excess };
};

// === TIME SERIES ===

ADV.tsDescriptive = function(data, dates) {
  if (!data || data.length < 3) return null;
  var n = data.length;
  var m = ADV.mean(data);
  // Trend detection: simple linear regression on index
  var sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (var i = 0; i < n; i++) {
    sx += i; sy += data[i]; sxx += i * i; sxy += i * data[i];
  }
  var slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  var intercept = (sy - slope * sx) / n;
  // Autocorrelation (lag 1)
  var m1 = m;
  var num = 0, den = 0;
  for (var j = 1; j < n; j++) {
    num += (data[j] - m1) * (data[j - 1] - m1);
    den += (data[j - 1] - m1) * (data[j - 1] - m1);
  }
  var acf1 = den > 0 ? num / den : 0;
  return {
    n: n, mean: m, min: Math.min.apply(null, data), max: Math.max.apply(null, data),
    slope: slope, intercept: intercept, acf1: acf1,
    trend: slope > 0 ? '上升' : (slope < 0 ? '下降' : '平稳')
  };
};

ADV.seasonalDecomp = function(data, period) {
  if (!data || data.length < period * 2) return null;
  var n = data.length;
  // Step 1: Centered moving average (trend)
  var trend = [];
  for (var i = 0; i < n; i++) {
    if (period % 2 === 0) {
      if (i < period / 2 || i >= n - period / 2) { trend.push(NaN); continue; }
      var s1 = 0;
      for (var j = i - period / 2; j <= i + period / 2; j++) s1 += data[j];
      trend.push(s1 / (period + 1));
    } else {
      var half = Math.floor(period / 2);
      if (i < half || i >= n - half) { trend.push(NaN); continue; }
      var s2 = 0;
      for (var k = i - half; k <= i + half; k++) s2 += data[k];
      trend.push(s2 / period);
    }
  }
  // Step 2: Detrended
  var detrend = [];
  for (var a = 0; a < n; a++) {
    detrend.push(isNaN(trend[a]) ? NaN : data[a] - trend[a]);
  }
  // Step 3: Seasonal component (average detrended per season)
  var seasonal = new Array(n).fill(0);
  var seasonalCount = new Array(n).fill(0);
  for (var b = 0; b < n; b++) {
    if (!isNaN(detrend[b])) {
      var idx = b % period;
      seasonal[idx] += detrend[b];
      seasonalCount[idx]++;
    }
  }
  var seasonalMean = new Array(period).fill(0);
  for (var c = 0; c < period; c++) {
    seasonalMean[c] = seasonalCount[c] > 0 ? seasonal[c] / seasonalCount[c] : 0;
  }
  // Center seasonal components
  var sm = ADV.mean(seasonalMean);
  for (var d = 0; d < period; d++) seasonalMean[d] -= sm;
  // Fill seasonal array
  var seasonalFull = [];
  for (var e = 0; e < n; e++) {
    seasonalFull.push(seasonalMean[e % period]);
  }
  // Step 4: Residual
  var residual = [];
  for (var f = 0; f < n; f++) {
    residual.push(data[f] - (isNaN(trend[f]) ? 0 : trend[f]) - seasonalFull[f]);
  }
  return { trend: trend, seasonal: seasonalFull, residual: residual, period: period };
};

ADV.movingAverage = function(data, window) {
  if (!data || data.length < window) return null;
  var forecasts = [];
  for (var i = window; i < data.length; i++) {
    var s = 0;
    for (var j = i - window; j < i; j++) s += data[j];
    forecasts.push(s / window);
  }
  var next = 0;
  for (var k = data.length - window; k < data.length; k++) next += data[k];
  next /= window;
  // Calculate errors
  var mae = 0, rmse = 0;
  for (var l = 0; l < forecasts.length; l++) {
    mae += Math.abs(forecasts[l] - data[window + l]);
    rmse += (forecasts[l] - data[window + l]) * (forecasts[l] - data[window + l]);
  }
  mae /= forecasts.length;
  rmse = Math.sqrt(rmse / forecasts.length);
  return { forecasts: forecasts, next: next, window: window, mae: mae, rmse: rmse };
};

ADV.expSmoothing = function(data, alpha) {
  if (!data || data.length < 2) return null;
  if (alpha === undefined) alpha = 0.3;
  var smoothed = [data[0]];
  for (var i = 1; i < data.length; i++) {
    smoothed.push(alpha * data[i] + (1 - alpha) * smoothed[i - 1]);
  }
  var next = alpha * data[data.length - 1] + (1 - alpha) * smoothed[smoothed.length - 1];
  // Errors (one-step-ahead)
  var mae = 0, rmse = 0;
  for (var j = 1; j < data.length; j++) {
    mae += Math.abs(smoothed[j - 1] - data[j]);
    rmse += (smoothed[j - 1] - data[j]) * (smoothed[j - 1] - data[j]);
  }
  mae /= (data.length - 1);
  rmse = Math.sqrt(rmse / (data.length - 1));
  return { smoothed: smoothed, next: next, alpha: alpha, mae: mae, rmse: rmse };
};

ADV.linearTrend = function(data) {
  if (!data || data.length < 3) return null;
  var n = data.length;
  var sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (var i = 0; i < n; i++) {
    sx += i; sy += data[i]; sxx += i * i; sxy += i * data[i];
  }
  var slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  var intercept = (sy - slope * sx) / n;
  // Fitted values
  var fitted = [];
  for (var j = 0; j < n; j++) fitted.push(intercept + slope * j);
  var next = intercept + slope * n;
  // R-squared
  var m = ADV.mean(data);
  var ssRes = 0, ssTot = 0;
  for (var k = 0; k < n; k++) {
    ssRes += (data[k] - fitted[k]) * (data[k] - fitted[k]);
    ssTot += (data[k] - m) * (data[k] - m);
  }
  var r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  return { slope: slope, intercept: intercept, fitted: fitted, next: next, r2: r2, equation: 'y = ' + intercept.toFixed(4) + ' + ' + slope.toFixed(4) + 'x' };
};

// === Column utilities ===
ADV.getNumericCols = function(headers, data) {
  var numeric = [];
  for (var c = 0; c < headers.length; c++) {
    var vals = [];
    for (var r = 0; r < data.length; r++) {
      if (data[r][c] !== undefined && data[r][c] !== '') {
        vals.push(data[r][c]);
      }
    }
    // Check if mostly numeric (>60%)
    var numCount = 0;
    for (var v = 0; v < vals.length; v++) {
      if (!isNaN(parseFloat(vals[v])) && isFinite(vals[v])) numCount++;
    }
    if (vals.length > 0 && numCount / vals.length > 0.6) {
      numeric.push({ index: c, name: headers[c] });
    }
  }
  return numeric;
};

ADV.getColData = function(headers, data, colIdx) {
  var vals = [];
  for (var r = 0; r < data.length; r++) {
    if (data[r][colIdx] !== undefined && data[r][colIdx] !== '') {
      var v = parseFloat(data[r][colIdx]);
      if (!isNaN(v) && isFinite(v)) vals.push(v);
    }
  }
  return vals;
};

ADV.getCatColData = function(headers, data, colIdx) {
  var vals = [];
  for (var r = 0; r < data.length; r++) {
    if (data[r][colIdx] !== undefined && data[r][colIdx] !== '') {
      vals.push(String(data[r][colIdx]).trim());
    }
  }
  return vals;
};

// === Runner ===
ADV.runAnalysis = function(category, subType, tableData, params) {
  if (!tableData || !tableData.headers || !tableData.data || tableData.data.length === 0) {
    return { error: '请先获取数据' };
  }
  var headers = tableData.headers;
  var data = tableData.data;
  try {
    switch (category) {
      case 'descriptive_advanced': return ADV._runDescriptiveAdvanced(subType, headers, data, params);
      case 'distribution': return ADV._runDistribution(subType, headers, data, params);
      case 'chisquare': return ADV._runChiSquare(subType, headers, data, params);
      case 'timeseries': return ADV._runTimeSeries(subType, headers, data, params);
      default: return { error: '未知分析类别' };
    }
  } catch (e) {
    return { error: '分析出错: ' + e.message };
  }
};

ADV._runDescriptiveAdvanced = function(subType, headers, data, params) {
  var colIdx = parseInt(params.col);
  var vals = ADV.getColData(headers, data, colIdx);
  if (vals.length < 3) return { error: '数据不足（至少需要3个有效数值）' };

  var result = { title: '描述性统计进阶 - ' + headers[colIdx], rows: [] };
  // CV
  var cv = ADV.calcCV(vals);
  if (cv) {
    result.rows.push({ label: '离散系数 (CV)', value: cv.cv.toFixed(4), note: cv.cvPercent.toFixed(2) + '%' });
    result.rows.push({ label: '均值', value: cv.mean.toFixed(4), note: '' });
    result.rows.push({ label: '标准差', value: cv.std.toFixed(4), note: '' });
  }
  // Skewness
  var skew = ADV.calcSkewness(vals);
  if (skew !== null) {
    var skewNote = Math.abs(skew) < 0.5 ? '近似对称' : (skew > 0 ? '右偏（正偏）' : '左偏（负偏）');
    result.rows.push({ label: '偏度 (Skewness)', value: skew.toFixed(4), note: skewNote });
  }
  // Kurtosis
  var kurt = ADV.calcKurtosis(vals);
  if (kurt !== null) {
    var kurtNote = Math.abs(kurt.excessKurtosis) < 0.5 ? '接近正态' : (kurt.excessKurtosis > 0 ? '尖峰' : '平峰');
    result.rows.push({ label: '峰度 (Kurtosis)', value: kurt.kurtosis.toFixed(4), note: '' });
    result.rows.push({ label: '超额峰度 (Excess)', value: kurt.excessKurtosis.toFixed(4), note: kurtNote });
  }
  result.rows.push({ label: '样本量 (N)', value: vals.length.toString(), note: '' });
  return result;
};

ADV._runDistribution = function(subType, headers, data, params) {
  var distNames = { normal: '正态分布', t: 't分布', f: 'F分布', chisq: '卡方分布' };
  var result = { title: distNames[subType] || '概率分布', rows: [], chart: null };

  if (subType === 'normal') {
    var colIdx = parseInt(params.col);
    var vals = ADV.getColData(headers, data, colIdx);
    if (vals.length < 2) return { error: '数据不足' };
    var m = ADV.mean(vals);
    var sq = 0;
    for (var i = 0; i < vals.length; i++) sq += (vals[i] - m) * (vals[i] - m);
    var s = Math.sqrt(sq / (vals.length - 1));

    // Generate PDF points
    var min = m - 4 * s, max = m + 4 * s, step = (max - min) / 50;
    var pdfPoints = [], cdfPoints = [];
    for (var x = min; x <= max; x += step) {
      pdfPoints.push({ x: x, y: ADV.normalPDF(x, m, s) });
      cdfPoints.push({ x: x, y: ADV.normalCDF(x, m, s) });
    }

    // Kolmogorov-Smirnov-like test using normal probability plot correlation
    var sorted = vals.slice().sort(function(a,b){return a-b;});
    var qq = [];
    for (var j = 0; j < sorted.length; j++) {
      var pp = (j + 0.5) / sorted.length;
      qq.push({ observed: sorted[j], expected: m + s * Math.SQRT2 * ADV.erf(2 * pp - 1) });
    }

    result.rows.push({ label: '均值 μ', value: m.toFixed(4), note: '' });
    result.rows.push({ label: '标准差 σ', value: s.toFixed(4), note: '' });
    result.rows.push({ label: '样本量', value: vals.length.toString(), note: '' });
    result.chart = { type: 'distribution', pdf: pdfPoints, cdf: cdfPoints, qq: qq, label: headers[colIdx] };

  } else if (subType === 't') {
    var colIdx = parseInt(params.col);
    var vals = ADV.getColData(headers, data, colIdx);
    if (vals.length < 2) return { error: '数据不足' };
    var m = ADV.mean(vals);
    var sq = 0;
    for (var a = 0; a < vals.length; a++) sq += (vals[a] - m) * (vals[a] - m);
    var se = Math.sqrt(sq / (vals.length - 1)) / Math.sqrt(vals.length);
    var tStat = m / se;
    var df = vals.length - 1;
    var pVal = 2 * (1 - ADV.tCDF(Math.abs(tStat), df));

    var minT = -4, maxT = 4, stepT = 0.2;
    var tPdf = [];
    for (var xt = minT; xt <= maxT; xt += stepT) {
      tPdf.push({ x: xt, y: Math.exp(ADV.logGamma((df+1)/2) - ADV.logGamma(df/2)) / Math.sqrt(df*Math.PI) * Math.pow(1 + xt*xt/df, -(df+1)/2) });
    }

    result.rows.push({ label: 't 统计量', value: tStat.toFixed(4), note: '' });
    result.rows.push({ label: '自由度 (df)', value: df.toString(), note: '' });
    result.rows.push({ label: 'p 值（双尾）', value: pVal.toFixed(4), note: pVal < 0.05 ? '显著' : '不显著' });
    result.chart = { type: 't', pdf: tPdf, tStat: tStat, df: df };

  } else if (subType === 'f') {
    var colIdx = parseInt(params.col);
    var vals = ADV.getColData(headers, data, colIdx);
    if (vals.length < 3) return { error: '数据不足' };
    var df1 = parseInt(params.df1) || 1;
    var df2 = parseInt(params.df2) || vals.length - 1;
    var mf = ADV.mean(vals);
    var varF = 0;
    for (var b = 0; b < vals.length; b++) varF += (vals[b] - mf) * (vals[b] - mf);
    varF /= (vals.length - 1);
    var fStat = varF > 0 ? varF / 1 : 1;
    var pValF = 1 - ADV.fCDF(fStat, df1, df2);

    var minF = 0, maxF = 5, stepF = 0.1;
    var fPdf = [];
    for (var xf = minF; xf <= maxF; xf += stepF) {
      var lnPdf = (df1/2)*Math.log(df1) + (df2/2)*Math.log(df2) + ADV.logGamma((df1+df2)/2) - ADV.logGamma(df1/2) - ADV.logGamma(df2/2) + (df1/2-1)*Math.log(xf) - ((df1+df2)/2)*Math.log(df1*xf+df2);
      fPdf.push({ x: xf, y: Math.exp(lnPdf) });
    }
    result.rows.push({ label: 'F 统计量', value: fStat.toFixed(4), note: '' });
    result.rows.push({ label: '分子自由度 (df1)', value: df1.toString(), note: '' });
    result.rows.push({ label: '分母自由度 (df2)', value: df2.toString(), note: '' });
    result.rows.push({ label: 'p 值', value: pValF.toFixed(4), note: pValF < 0.05 ? '显著' : '不显著' });
    result.chart = { type: 'f', pdf: fPdf, fStat: fStat, df1: df1, df2: df2 };

  } else if (subType === 'chisq') {
    var colIdx = parseInt(params.col);
    var vals = ADV.getColData(headers, data, colIdx);
    if (vals.length < 2) return { error: '数据不足' };
    var df = parseInt(params.df) || Math.max(1, vals.length - 1);
    var chi2Stat = 0;
    // If user provides expected variance
    var expectedVar = parseFloat(params.expectedVar) || 1;
    var mv = ADV.mean(vals);
    var sv = 0;
    for (var c = 0; c < vals.length; c++) sv += (vals[c] - mv) * (vals[c] - mv);
    chi2Stat = sv / expectedVar;
    var pValChi = 1 - ADV.chiSquareCDF(chi2Stat, df);

    var minC = 0, maxC = Math.max(chi2Stat * 1.5, 10), stepC = maxC / 60;
    var chiPdf = [];
    for (var xc = 0.1; xc <= maxC; xc += stepC) {
      chiPdf.push({ x: xc, y: ADV.chiSquarePDF(xc, df) });
    }
    result.rows.push({ label: '卡方统计量', value: chi2Stat.toFixed(4), note: '' });
    result.rows.push({ label: '自由度 (df)', value: df.toString(), note: '' });
    result.rows.push({ label: 'p 值', value: pValChi.toFixed(4), note: pValChi < 0.05 ? '显著' : '不显著' });
    result.chart = { type: 'chisq', pdf: chiPdf, chi2: chi2Stat, df: df };
  }
  return result;
};

ADV._runChiSquare = function(subType, headers, data, params) {
  if (subType === 'gof') {
    var colIdx = parseInt(params.col);
    var vals = ADV.getCatColData(headers, data, colIdx);
    if (vals.length < 2) return { error: '分类数据不足' };
    // Count frequencies
    var freq = {};
    for (var i = 0; i < vals.length; i++) {
      freq[vals[i]] = (freq[vals[i]] || 0) + 1;
    }
    var categories = Object.keys(freq);
    var observed = categories.map(function(k) { return freq[k]; });
    var expected = [];
    for (var j = 0; j < categories.length; j++) expected.push(vals.length / categories.length);
    var test = ADV.chiSquareGOF(observed, expected);
    if (!test) return { error: '计算失败' };

    var result = { title: '卡方拟合优度检验', rows: [], extraRows: [] };
    result.rows.push({ label: '卡方统计量', value: test.chi2.toFixed(4), note: '' });
    result.rows.push({ label: '自由度', value: test.df.toString(), note: '' });
    result.rows.push({ label: 'p 值', value: test.p.toFixed(4), note: test.p < 0.05 ? '拒绝均匀分布假设' : '不能拒绝均匀分布假设' });

    result.extraRows = [];
    for (var k = 0; k < categories.length; k++) {
      result.extraRows.push({ category: categories[k], observed: observed[k], expected: expected[k].toFixed(2) });
    }
    return result;

  } else if (subType === 'contingency') {
    var rowCol = parseInt(params.rowCol);
    var colCol = parseInt(params.colCol);
    var rowVals = ADV.getCatColData(headers, data, rowCol);
    var colVals = ADV.getCatColData(headers, data, colCol);
    if (rowVals.length !== colVals.length || rowVals.length < 4) return { error: '数据不足或行列不匹配' };

    // Build contingency table
    var rowCats = [], colCats = [];
    for (var r = 0; r < rowVals.length; r++) {
      if (rowCats.indexOf(rowVals[r]) === -1) rowCats.push(rowVals[r]);
      if (colCats.indexOf(colVals[r]) === -1) colCats.push(colVals[r]);
    }
    var matrix = [];
    for (var r2 = 0; r2 < rowCats.length; r2++) {
      matrix[r2] = new Array(colCats.length).fill(0);
    }
    for (var r3 = 0; r3 < rowVals.length; r3++) {
      var ri = rowCats.indexOf(rowVals[r3]);
      var ci = colCats.indexOf(colVals[r3]);
      matrix[ri][ci]++;
    }
    var test = ADV.chiSquareContingency(matrix);
    if (!test) return { error: '计算失败' };

    var result = { title: '卡方列联分析', rows: [], extraRows: matrix, rowCats: rowCats, colCats: colCats };
    result.rows.push({ label: '卡方统计量', value: test.chi2.toFixed(4), note: '' });
    result.rows.push({ label: '自由度', value: test.df.toString(), note: '' });
    result.rows.push({ label: 'p 值', value: test.p.toFixed(4), note: test.p < 0.05 ? '存在显著关联' : '无显著关联' });
    result.rows.push({ label: "Cramer's V", value: test.cramerV.toFixed(4), note: test.cramerV > 0.3 ? '中等以上关联' : '弱关联' });
    result.rows.push({ label: '总样本量', value: test.n.toString(), note: '' });
    return result;
  }
  return { error: '未知子类型' };
};

ADV._runTimeSeries = function(subType, headers, data, params) {
  var colIdx = parseInt(params.col);
  var vals = ADV.getColData(headers, data, colIdx);
  if (vals.length < 3) return { error: '数据不足（至少需要3个数据点）' };

  if (subType === 'ts_descriptive') {
    var tsd = ADV.tsDescriptive(vals);
    if (!tsd) return { error: '计算失败' };
    var result = { title: '时间序列描述性统计 - ' + headers[colIdx], rows: [] };
    result.rows.push({ label: '观测数', value: tsd.n.toString(), note: '' });
    result.rows.push({ label: '均值', value: tsd.mean.toFixed(4), note: '' });
    result.rows.push({ label: '最小值', value: tsd.min.toFixed(4), note: '' });
    result.rows.push({ label: '最大值', value: tsd.max.toFixed(4), note: '' });
    result.rows.push({ label: '趋势斜率', value: tsd.slope.toFixed(4), note: tsd.trend });
    result.rows.push({ label: '趋势截距', value: tsd.intercept.toFixed(4), note: '' });
    result.rows.push({ label: '自相关 ACF(1)', value: tsd.acf1.toFixed(4), note: Math.abs(tsd.acf1) > 0.5 ? '强自相关' : '弱自相关' });
    result.chart = { type: 'ts_line', data: vals, label: headers[colIdx] };
    return result;

  } else if (subType === 'ts_decomp') {
    var period = parseInt(params.period) || 4;
    if (vals.length < period * 2) return { error: '数据不足，需要至少 ' + (period * 2) + ' 个数据点' };
    var decomp = ADV.seasonalDecomp(vals, period);
    if (!decomp) return { error: '分解失败，请检查数据或调整周期' };
    var result = { title: '时间序列分解 (周期=' + period + ')', rows: [], chart: { type: 'ts_decomp', data: vals, trend: decomp.trend, seasonal: decomp.seasonal, residual: decomp.residual, period: period } };
    result.rows.push({ label: '周期长度', value: period.toString(), note: '' });
    result.rows.push({ label: '数据长度', value: vals.length.toString(), note: '' });
    // Compute seasonal strength
    var varOrig = 0, mOrig = ADV.mean(vals);
    for (var i = 0; i < vals.length; i++) varOrig += (vals[i] - mOrig) * (vals[i] - mOrig);
    result.rows.push({ label: '季节成分', value: '已提取', note: '共 ' + period + ' 个季节因子' });
    return result;

  } else if (subType === 'ts_ma') {
    var window = parseInt(params.window) || 3;
    if (window < 2 || window >= vals.length) return { error: '窗口大小应在 2~' + (vals.length - 1) + ' 之间' };
    var ma = ADV.movingAverage(vals, window);
    if (!ma) return { error: '计算失败' };
    var result = { title: '移动平均预测 (窗口=' + window + ')', rows: [], chart: { type: 'ts_forecast', data: vals, forecasts: ma.forecasts, label: headers[colIdx], window: window } };
    result.rows.push({ label: '窗口大小', value: window.toString(), note: '' });
    result.rows.push({ label: '下一期预测值', value: ma.next.toFixed(4), note: '' });
    result.rows.push({ label: 'MAE', value: ma.mae.toFixed(4), note: '' });
    result.rows.push({ label: 'RMSE', value: ma.rmse.toFixed(4), note: '' });
    return result;

  } else if (subType === 'ts_exp') {
    var alpha = parseFloat(params.alpha) || 0.3;
    if (alpha <= 0 || alpha > 1) return { error: '平滑系数 α 应在 (0, 1] 之间' };
    var exp = ADV.expSmoothing(vals, alpha);
    if (!exp) return { error: '计算失败' };
    var result = { title: '指数平滑预测 (α=' + alpha + ')', rows: [], chart: { type: 'ts_forecast', data: vals, forecasts: exp.smoothed, label: headers[colIdx], alpha: alpha } };
    result.rows.push({ label: '平滑系数 α', value: alpha.toFixed(2), note: '' });
    result.rows.push({ label: '下一期预测值', value: exp.next.toFixed(4), note: '' });
    result.rows.push({ label: 'MAE', value: exp.mae.toFixed(4), note: '' });
    result.rows.push({ label: 'RMSE', value: exp.rmse.toFixed(4), note: '' });
    return result;

  } else if (subType === 'ts_trend') {
    var lt = ADV.linearTrend(vals);
    if (!lt) return { error: '计算失败' };
    var result = { title: '线性趋势预测', rows: [], chart: { type: 'ts_forecast', data: vals, forecasts: lt.fitted, label: headers[colIdx], trend: true } };
    result.rows.push({ label: '回归方程', value: lt.equation, note: '' });
    result.rows.push({ label: '斜率', value: lt.slope.toFixed(4), note: '' });
    result.rows.push({ label: '截距', value: lt.intercept.toFixed(4), note: '' });
    result.rows.push({ label: 'R²', value: lt.r2.toFixed(4), note: lt.r2 > 0.8 ? '拟合良好' : '拟合一般' });
    result.rows.push({ label: '下一期预测值', value: lt.next.toFixed(4), note: '' });
    return result;
  }
  return { error: '未知时间序列分析类型' };
};

/* --- END ADV Library --- */
