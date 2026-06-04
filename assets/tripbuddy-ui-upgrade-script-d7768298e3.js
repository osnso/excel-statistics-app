(function () {
  function byId(id) { return document.getElementById(id); }
  function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  var SERVICE_CHECK_KB = {
    stages: {
      stage1: '阶段一：存在明显无效共情/红线问题，客户情绪未被接住或被进一步激化。',
      stage2: '阶段二：有共情动作但偏模板化、笼统，未充分回应客户具体情绪点。',
      stage3: '阶段三：能结合客户问题进行有效安抚，流程较完整，仍有轻微提升空间。',
      stage4: '阶段四：高质量有效共情，能准确识别情绪、主动致歉并推动解决方案。'
    },
    points: {
      1: '机械模板或泛化安抚，未回应客户具体情绪',
      2: '反问、推诿、否定客户感受或表达生硬',
      3: '打断抢话、忽略客户诉求或处理节奏失当',
      4: '关键情绪爆点未及时承接/未持续跟进',
      5: '客户情绪明显缓和，安抚动作有效',
      6: '针对服务缺陷主动致歉并解释处理路径',
      7: '存在红线话术或可能激化矛盾的表达',
      8: '外呼/开场/结尾礼貌语完整',
      9: '对差评/投诉场景有复盘和补救动作'
    }
  };

  function parseCsvLine(line) {
    var out = [], cur = '', quoted = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function csvEscape(v) {
    v = String(v == null ? '' : v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function downloadText(filename, content, mime) {
    var blob = new Blob(['\ufeff' + content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  function normalizeServiceLLMResult(value) {
    var obj = value || {};
    var stage = String(obj.stage || obj.result || obj.level || '阶段二').trim();
    if (!/^(阶段一|阶段二|阶段三|阶段四|不涉及)$/.test(stage)) {
      var m = stage.match(/阶段[一二三四]|不涉及/);
      stage = m ? m[0] : '阶段二';
    }
    var confidence = Number(obj.confidence == null ? obj.score : obj.confidence);
    if (!isFinite(confidence)) confidence = 75;
    confidence = Math.max(0, Math.min(100, confidence));
    var points = Array.isArray(obj.points) ? obj.points : [];
    points = points.map(function (p) { return Number(String(p).replace(/[^0-9]/g, '')); }).filter(function (p) { return p >= 1 && p <= 9; });
    var reason = String(obj.reason || obj.explanation || obj.summary || 'LLM 已完成评估。').trim();
    var evidence = String(obj.evidence || obj.quote || obj.keyEvidence || '').trim();
    var suggestion = String(obj.suggestion || obj.advice || obj.improvement || '').trim();
    var docSummary = String(obj.docSummary || obj.report || obj.reportSummary || reason).trim();
    return { stage: stage, confidence: confidence, points: points, reason: reason, evidence: evidence, suggestion: suggestion, docSummary: docSummary, source: 'llm' };
  }

  function extractJsonObject(text) {
    var raw = String(text || '').trim();
    raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    try { return JSON.parse(raw); } catch (e) {}
    var match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('LLM 返回不是 JSON：' + raw.slice(0, 200));
    return JSON.parse(match[0]);
  }

  async function callLLM(text, config) {
    if (!config || !config.apiKey) throw new Error('未配置 AI 大模型。请先在「通用分析 → AI设置」保存 API Key / Base URL / 模型。');
    var baseUrl = String(config.baseUrl || config.endpoint || 'https://api.anthropic.com').trim().replace(/\/+$/, '');
    var model = String(config.model || 'claude-sonnet-4-6').trim();
    var apiKey = String(config.apiKey || config.token || '').trim();
    var prompt = [
      '你是 service-check 客服质检评分专家。请严格基于以下专项能力对客服对话进行「有效共情」质检打分。',
      '',
      '【任务目标】',
      '1. 判断该通客服对话是否涉及有效共情质检。',
      '2. 如果涉及，按阶段一至阶段四输出最终质检阶段。',
      '3. 输出命中的判断点编号、置信度、原因说明、改进建议和可直接放入质检文档的总结。',
      '',
      '【阶段定义】',
      '不涉及：内容为空、过短、仅订单号/编号、非客服沟通、没有可评价的客户情绪或服务回应。',
      '阶段一：明显无效共情/红线问题。客服推诿、否定客户感受、反问、语气生硬、忽略或激化情绪。',
      '阶段二：有共情动作但模板化/泛化，未回应客户具体情绪点，安抚不足或缺少跟进闭环。',
      '阶段三：能结合客户具体问题进行有效安抚，有致歉/理解/处理路径，流程较完整但仍有提升空间。',
      '阶段四：高质量有效共情。准确识别情绪，主动致歉，解释处理路径，推进解决方案，并能体现持续跟进或补救。',
      '',
      '【判断点编号】',
      '1 机械模板或泛化安抚，未回应客户具体情绪',
      '2 反问、推诿、否定客户感受或表达生硬',
      '3 打断抢话、忽略客户诉求或处理节奏失当',
      '4 关键情绪爆点未及时承接或未持续跟进',
      '5 客户情绪明显缓和，安抚动作有效',
      '6 针对服务缺陷主动致歉并解释处理路径',
      '7 存在红线话术或可能激化矛盾的表达',
      '8 外呼/开场/结尾礼貌语完整',
      '9 对差评/投诉场景有复盘和补救动作',
      '',
      '【输出要求】',
      '只返回严格 JSON，不要 Markdown，不要代码块。字段必须包含：',
      '{"stage":"阶段一/阶段二/阶段三/阶段四/不涉及","confidence":0-100,"points":[数字],"reason":"一句话结论","evidence":"关键证据摘录","suggestion":"改进建议","docSummary":"适合写入质检报告的总结"}',
      '',
      '【待评估对话】',
      String(text || '').slice(0, 16000)
    ].join('\n');
    var isAnthropic = /anthropic/i.test(baseUrl) || /^claude/i.test(model);
    if (isAnthropic) {
      var anthropicUrl = /\/v1\/messages$/.test(baseUrl) ? baseUrl : baseUrl + '/v1/messages';
      var resp = await fetch(anthropicUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 1600,
          temperature: 0,
          system: '你是严格的质检评分器。你必须只输出一个 JSON 对象。',
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!resp.ok) {
        var anthropicErr = await resp.text().catch(function () { return ''; });
        throw new Error('Anthropic API 请求失败：HTTP ' + resp.status + (anthropicErr ? ' · ' + anthropicErr.slice(0, 300) : ''));
      }
      var adata = await resp.json();
      var acontent = adata && adata.content && adata.content.map(function (item) { return item.type === 'text' ? item.text : ''; }).join('');
      if (!acontent) throw new Error('Anthropic API 未返回有效内容');
      return normalizeServiceLLMResult(extractJsonObject(acontent));
    }

    var openaiUrl = /\/chat\/completions$/.test(baseUrl) ? baseUrl : (baseUrl.replace(/\/v1$/, '') + '/v1/chat/completions');
    var resp2 = await fetch(openaiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是严格的质检评分器。你必须只输出一个 JSON 对象。' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!resp2.ok) {
      var openaiErr = await resp2.text().catch(function () { return ''; });
      throw new Error('OpenAI 兼容 API 请求失败：HTTP ' + resp2.status + (openaiErr ? ' · ' + openaiErr.slice(0, 300) : ''));
    }
    var data = await resp2.json();
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('OpenAI 兼容 API 未返回有效内容');
    return normalizeServiceLLMResult(extractJsonObject(content));
  }

  function formatServiceResult(result) {
    if (!result) return '暂无结果';
    var title = result.stage === '不涉及' ? '【有效共情 - 不涉及】（置信度：100%）' : '【有效共情 - ' + result.stage + '】（置信度：' + Math.round(result.confidence || 0) + '%）';
    var points = result.points && result.points.length ? '\n判断点：' + result.points.join('、') : '';
    var reason = result.reason ? '\n说明：' + result.reason : '';
    var evidence = result.evidence ? '\n证据：' + result.evidence : '';
    var suggestion = result.suggestion ? '\n建议：' + result.suggestion : '';
    var docSummary = result.docSummary ? '\n文档总结：' + result.docSummary : '';
    return title + points + reason + evidence + suggestion + docSummary;
  }

  function renderSpecialPage(root) {
    if (byId('tb-special-page')) return;
    var special = document.createElement('main');
    special.id = 'tb-special-page';
    special.innerHTML = [
      '<section class="tb-hero">',
        '<div class="tb-hero-kicker">✨ 专项分析工作台</div>',
        '<h1>面向运营场景的专项分析</h1>',
        '<p>聚焦 WFM 专项运营技能。</p>',
      '</section>',
      '<section class="tb-category-tabs" role="tablist" aria-label="专项分析分类">',
        '<button class="tb-category-tab active" data-tb-special-category="cost" role="tab" aria-selected="true"><span class="tb-category-icon">💰</span><span class="tb-category-name">成本/用量运营</span><span class="tb-category-desc">质检与用量</span></button>',
        '<button class="tb-category-tab" data-tb-special-category="efficiency" role="tab" aria-selected="false"><span class="tb-category-icon">👥</span><span class="tb-category-name">人效运营</span><span class="tb-category-desc">人效指标</span></button>',
        '<button class="tb-category-tab" data-tb-special-category="intelligent" role="tab" aria-selected="false"><span class="tb-category-icon">🤖</span><span class="tb-category-name">智能运营</span><span class="tb-category-desc">智能应用</span></button>',
        '<button class="tb-category-tab" data-tb-special-category="show" role="tab" aria-selected="false"><span class="tb-category-icon">🎬</span><span class="tb-category-name">展演运营</span><span class="tb-category-desc">展演复盘</span></button>',
      '</section>',

      '<section class="tb-category-panel active" data-tb-special-panel="cost">',
        '<div class="tb-grid">',
          '<article class="tb-card span-12">',
            '<div class="tb-mini-label">内置技能 · service-check</div>',
            '<h2>客服质检评估：有效共情</h2>',
            '<p>使用已配置 LLM 完成有效共情质检，支持单条、Excel 批量和文档导出。</p>',
            '<div class="tb-badge-row">',
              '<span class="tb-badge">LLM 打分</span>',
              '<span class="tb-badge">Excel 批量</span>',
              '<span class="tb-badge">报告文档</span>',
            '</div>',
          '</article>',
          '<article class="tb-card span-4">',
            '<h3>AI 设置</h3>',
            '<p id="tb-ai-config-desc">复用通用分析中的 AI 设置；配置后直接用 LLM 打分。</p>',
            '<p id="tb-ai-config-meta" class="tb-mini-note">配置仅保存在当前用户当前浏览器 localStorage，不上传服务器；不同用户、不同浏览器可分别保存自己的 API，互不影响。</p>',
            '<div class="tb-badge-row">',
              '<span class="tb-badge" id="tb-ai-config-state">检测 AI 设置中...</span>',
              '<span class="tb-badge">自动识别 Anthropic / OpenAI 兼容接口</span>',
            '</div>',
            '<div class="tb-actions"><button class="tb-btn secondary" id="tb-ai-config-action" data-tb-page="general" type="button">去通用分析配置 AI</button></div>',
          '</article>',
          '<article class="tb-card span-8">',
            '<h3>单条对话评估</h3>',
            '<div class="tb-field"><label for="tb-service-text">客服/客人对话文本</label><textarea id="tb-service-text" placeholder="请粘贴对话文本，例如：\n客服：您好，非常抱歉给您带来不便，我先帮您核实订单...\n客人：我等了很久，很着急...\n客服：理解您的着急，我会优先为您跟进处理..."></textarea></div>',
            '<div class="tb-actions"><button class="tb-btn primary" id="tb-service-run">开始评估</button><button class="tb-btn secondary" id="tb-service-sample">填入示例</button><button class="tb-btn ghost" id="tb-service-clear">清空</button><button class="tb-btn secondary" id="tb-service-doc-export" disabled>导出评估文档</button></div>',
            '<div class="tb-result-box" id="tb-service-result">等待输入对话内容后开始评估...</div>',
          '</article>',
          '<article class="tb-card span-12">',
            '<h3>批量评估（上传 Excel 文档）</h3>',
            '<p>上传 .xlsx / .xls，自动识别对话列并调用 LLM 批量质检。</p>',
            '<div class="tb-upload-card" id="tb-service-upload-card">',
              '<input id="tb-service-excel" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" />',
              '<div class="tb-upload-icon">📄</div>',
              '<div><strong>点击选择 Excel 文件</strong><p id="tb-service-file-status">未选择文件</p></div>',
            '</div>',
            '<div class="tb-actions"><button class="tb-btn primary" id="tb-service-batch-run">批量评估</button><button class="tb-btn secondary" id="tb-service-batch-export" disabled>导出结果 Excel</button><button class="tb-btn secondary" id="tb-service-batch-doc-export" disabled>导出报告文档</button></div>',
            '<div class="tb-table-wrap" id="tb-service-table-wrap" style="display:none"><table class="tb-table"><thead><tr><th>#</th><th>阶段</th><th>置信度</th><th>判断点</th><th>说明</th><th>内容预览</th></tr></thead><tbody id="tb-service-table"></tbody></table></div>',
          '</article>',
          '<article class="tb-card span-4"><h3>成本口径</h3><p>预留用量与成本看板。</p></article>',
          '<article class="tb-card span-4"><h3>用量健康度</h3><p>预留用量波动分析。</p></article>',
          '<article class="tb-card span-4"><h3>复核闭环</h3><p>预留人工复核流程。</p></article>',
        '</div>',
      '</section>',

      '<section class="tb-category-panel" data-tb-special-panel="efficiency">',
        '<div class="tb-grid">',
          '<article class="tb-card span-12 tb-empty-card"><div><span class="emoji">👥</span><h2>人效运营</h2><p>待接入。</p></div></article>',
        '</div>',
      '</section>',
      '<section class="tb-category-panel" data-tb-special-panel="intelligent">',
        '<div class="tb-grid">',
          '<article class="tb-card span-12 tb-empty-card"><div><span class="emoji">🤖</span><h2>智能运营</h2><p>待接入。</p></div></article>',
        '</div>',
      '</section>',
      '<section class="tb-category-panel" data-tb-special-panel="show">',
        '<div class="tb-grid">',
          '<article class="tb-card span-12 tb-empty-card"><div><span class="emoji">🎬</span><h2>展演运营</h2><p>待接入。</p></div></article>',
        '</div>',
      '</section>'
    ].join('');
    root.insertAdjacentElement('afterend', special);
  }

  function getLLMConfig() {
    try {
      var saved = localStorage.getItem('excel-ai-config');
      if (!saved) return { apiKey: '', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6', enabled: false };
      var parsed = JSON.parse(saved) || {};
      var apiKey = String(parsed.apiKey || parsed.token || '').trim();
      var baseUrl = String(parsed.baseUrl || parsed.endpoint || 'https://api.anthropic.com').trim().replace(/\/+$/, '');
      var model = String(parsed.model || 'claude-sonnet-4-6').trim();
      return {
        apiKey: apiKey,
        baseUrl: baseUrl,
        endpoint: String(parsed.endpoint || '').trim(),
        model: model,
        enabled: !!parsed.enabled || !!apiKey
      };
    } catch (err) {
      return { apiKey: '', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6', enabled: false };
    }
  }

  function updateAiConfigState() {
    var el = byId('tb-ai-config-state');
    if (!el) return;
    var cfg = getLLMConfig();
    var btn = byId('tb-ai-config-action');
    var desc = byId('tb-ai-config-desc');
    var meta = byId('tb-ai-config-meta');
    if (cfg.apiKey) {
      el.textContent = 'AI 已配置 · ' + (cfg.model || '默认模型');
      el.classList.add('tb-badge-success');
      if (btn) btn.style.display = 'none';
      if (desc) desc.textContent = '已读取全局 AI 配置，本页将通过 LLM 完成 service-check 打分。';
      if (meta) meta.textContent = '配置仅保存在当前用户当前浏览器 localStorage，不上传服务器；不同用户、不同浏览器可分别保存自己的 API，互不影响。';
    } else {
      el.textContent = 'AI 未配置 · 无法打分';
      el.classList.remove('tb-badge-success');
      if (btn) btn.style.display = '';
      if (desc) desc.textContent = 'service-check 现在仅使用 LLM 打分。请先在「通用分析 → AI设置」保存 API Key / Base URL / 模型。';
      if (meta) meta.textContent = '配置仅保存在当前用户当前浏览器 localStorage，不上传服务器；不同用户、不同浏览器可分别保存自己的 API，互不影响。';
    }
  }

  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (window.__wfmSheetJsPromise) return window.__wfmSheetJsPromise;
    window.__wfmSheetJsPromise = new Promise(function (resolve, reject) {
      var urls = [
        'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
      ];
      var idx = 0;
      function next() {
        if (idx >= urls.length) { reject(new Error('Excel 解析库加载失败，请检查网络后重试。')); return; }
        var script = document.createElement('script');
        script.src = urls[idx++];
        script.onload = function () { window.XLSX ? resolve(window.XLSX) : next(); };
        script.onerror = next;
        document.head.appendChild(script);
      }
      next();
    });
    return window.__wfmSheetJsPromise;
  }

  function parseCsvText(text) {
    var lines = String(text || '').split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    var header = parseCsvLine(lines[0]);
    return lines.slice(1).map(function (line) {
      var cells = parseCsvLine(line);
      var obj = {};
      header.forEach(function (h, i) { obj[h || ('列' + (i + 1))] = cells[i] || ''; });
      return obj;
    });
  }

  async function parseServiceExcelFile(file) {
    var name = (file && file.name || '').toLowerCase();
    if (/\.csv$/.test(name)) {
      var text = await file.text();
      return parseCsvText(text);
    }
    var XLSX = await loadSheetJS();
    var buf = await file.arrayBuffer();
    var wb = XLSX.read(buf, { type: 'array' });
    var sheetName = wb.SheetNames && wb.SheetNames[0];
    if (!sheetName) return [];
    return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
  }

  function detectServiceContentColumn(rows) {
    var first = rows && rows[0] ? rows[0] : {};
    var keys = Object.keys(first);
    if (!keys.length) return '';
    var candidates = ['录音内容', '对话内容', '客服对话', '会话内容', '聊天内容', '通话内容', '转写内容', 'transcript', 'content', 'text'];
    for (var i = 0; i < candidates.length; i++) {
      var hit = keys.find(function (k) { return String(k).toLowerCase().trim() === candidates[i].toLowerCase(); });
      if (hit) return hit;
    }
    var fuzzy = keys.find(function (k) { return /录音|对话|会话|聊天|通话|转写|content|text|transcript/i.test(String(k)); });
    return fuzzy || keys[keys.length - 1];
  }

  async function exportServiceResultsExcel(rows) {
    var XLSX = await loadSheetJS();
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'service-check结果');
    XLSX.writeFile(wb, 'service-check-results.xlsx');
  }

  function buildServiceDocHtml(title, rows) {
    var now = new Date().toLocaleString();
    var body = rows.map(function (r, idx) {
      var result = r.result || r;
      var content = r.content || '';
      return '<h2>评估记录 ' + (idx + 1) + '</h2>' +
        '<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:12px">' +
        '<tr><th style="width:120px;background:#f3f4f6">质检阶段</th><td>' + escapeHtml(result.stage || '') + '</td></tr>' +
        '<tr><th style="background:#f3f4f6">置信度</th><td>' + Math.round(result.confidence || 0) + '%</td></tr>' +
        '<tr><th style="background:#f3f4f6">判断点</th><td>' + escapeHtml((result.points || []).join('、')) + '</td></tr>' +
        '<tr><th style="background:#f3f4f6">结论说明</th><td>' + escapeHtml(result.reason || '') + '</td></tr>' +
        '<tr><th style="background:#f3f4f6">关键证据</th><td>' + escapeHtml(result.evidence || '') + '</td></tr>' +
        '<tr><th style="background:#f3f4f6">改进建议</th><td>' + escapeHtml(result.suggestion || '') + '</td></tr>' +
        '<tr><th style="background:#f3f4f6">文档总结</th><td>' + escapeHtml(result.docSummary || result.reason || '') + '</td></tr>' +
        '</table>' +
        '<h3>原始对话</h3><pre style="white-space:pre-wrap;background:#f8fafc;padding:12px;border:1px solid #e5e7eb;border-radius:8px">' + escapeHtml(content) + '</pre>';
    }).join('<hr/>');
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title></head><body>' +
      '<h1>' + escapeHtml(title) + '</h1>' +
      '<p>生成时间：' + escapeHtml(now) + '</p>' +
      '<p>评分方式：AI 大模型 service-check 有效共情质检</p>' +
      body + '</body></html>';
  }

  function downloadServiceDoc(filename, title, rows) {
    var html = buildServiceDocHtml(title, rows);
    downloadText(filename, html, 'application/msword;charset=utf-8');
  }

  function initServiceCheck() {
    var run = byId('tb-service-run');
    if (!run || run.dataset.bound) return;
    run.dataset.bound = '1';
    var batchResults = [];
    var selectedFile = null;
    var singleResult = null;
    var singleContent = '';

    function setFileStatus(text) {
      var status = byId('tb-service-file-status');
      if (status) status.textContent = text;
    }
    function ensureAiConfig() {
      var config = getLLMConfig();
      if (!config.apiKey) throw new Error('未配置 AI 大模型。请先在「通用分析 → AI设置」保存 API Key / Base URL / 模型。');
      return config;
    }

    byId('tb-service-sample').addEventListener('click', function () {
      byId('tb-service-text').value = '客人：我已经等了半小时了，真的很着急，酒店还说查不到订单。\n客服：您好，非常抱歉给您带来不便，我理解您现在入住受阻会非常着急。我马上帮您核实订单并同步联系酒店前台，预计 5 分钟内给您明确回复。如果确实影响入住，我会继续帮您申请补偿方案。';
    });
    byId('tb-service-clear').addEventListener('click', function () {
      byId('tb-service-text').value = '';
      byId('tb-service-result').textContent = '等待输入对话内容后开始评估...';
      singleResult = null; singleContent = '';
      var docBtn = byId('tb-service-doc-export');
      if (docBtn) docBtn.disabled = true;
    });
    var excelInput = byId('tb-service-excel');
    var uploadCard = byId('tb-service-upload-card');
    if (uploadCard && excelInput) {
      uploadCard.addEventListener('click', function (event) {
        if (event.target !== excelInput) excelInput.click();
      });
      excelInput.addEventListener('change', function () {
        selectedFile = excelInput.files && excelInput.files[0] ? excelInput.files[0] : null;
        setFileStatus(selectedFile ? ('已选择：' + selectedFile.name) : '未选择文件');
      });
    }

    run.addEventListener('click', async function () {
      var text = byId('tb-service-text').value;
      var resultBox = byId('tb-service-result');
      var docBtn = byId('tb-service-doc-export');
      if (!text.trim()) { resultBox.textContent = '请先输入客服对话内容。'; return; }
      run.disabled = true; if (docBtn) docBtn.disabled = true; resultBox.textContent = '正在调用 LLM 评估...';
      try {
        var config = ensureAiConfig();
        var result = await callLLM(text, config);
        singleResult = result; singleContent = text;
        resultBox.textContent = formatServiceResult(result);
        if (docBtn) docBtn.disabled = false;
      } catch (err) {
        singleResult = null; singleContent = '';
        resultBox.textContent = 'LLM 打分失败：' + (err && err.message ? err.message : err);
      } finally { run.disabled = false; }
    });

    var singleDocBtn = byId('tb-service-doc-export');
    if (singleDocBtn) singleDocBtn.addEventListener('click', function () {
      if (!singleResult) return;
      downloadServiceDoc('service-check-report.doc', 'service-check 单条质检报告', [{ content: singleContent, result: singleResult }]);
    });

    byId('tb-service-batch-run').addEventListener('click', async function () {
      var tbody = byId('tb-service-table');
      var wrap = byId('tb-service-table-wrap');
      var exportBtn = byId('tb-service-batch-export');
      var docExportBtn = byId('tb-service-batch-doc-export');
      tbody.innerHTML = ''; batchResults = []; exportBtn.disabled = true; if (docExportBtn) docExportBtn.disabled = true;
      if (!selectedFile) { wrap.style.display = 'none'; alert('请先上传 Excel 文档。'); return; }
      var config;
      try { config = ensureAiConfig(); } catch (err) { alert(err.message || err); return; }
      wrap.style.display = 'block';
      try {
        var rows = await parseServiceExcelFile(selectedFile);
        if (!rows.length) { alert('未读取到有效数据。'); return; }
        var contentCol = detectServiceContentColumn(rows);
        setFileStatus('已读取 ' + rows.length + ' 行，内容列：' + contentCol + '，正在调用 LLM...');
        for (var i = 0; i < rows.length; i++) {
          var content = rows[i][contentCol] || '';
          var result;
          try { result = await callLLM(content, config); }
          catch (err) { result = { stage: '评估失败', confidence: 0, points: [], reason: (err && err.message ? err.message : String(err)), evidence: '', suggestion: '请检查 API 配置、网络或稍后重试。', docSummary: '该条记录未完成 LLM 质检。', source: 'error' }; }
          batchResults.push({ index: i + 1, content: content, result: result, source: rows[i] });
          var tr = document.createElement('tr');
          tr.innerHTML = '<td>' + (i + 1) + '</td><td>' + escapeHtml(result.stage) + '</td><td>' + Math.round(result.confidence || 0) + '%</td><td>' + escapeHtml((result.points || []).join('、')) + '</td><td>' + escapeHtml(result.reason || '') + '</td><td>' + escapeHtml(String(content).slice(0, 80)) + '</td>';
          tbody.appendChild(tr);
          setFileStatus('LLM 评估中：' + (i + 1) + '/' + rows.length);
        }
        exportBtn.disabled = batchResults.length === 0;
        if (docExportBtn) docExportBtn.disabled = batchResults.length === 0;
        setFileStatus('评估完成：' + batchResults.length + ' 条，可导出 Excel 或报告文档。');
      } catch (err) {
        setFileStatus('批量评估失败：' + (err && err.message ? err.message : err));
      }
    });

    byId('tb-service-batch-export').addEventListener('click', async function () {
      if (!batchResults.length) return;
      var rows = batchResults.map(function (r) {
        var out = Object.assign({}, r.source || {});
        out['质检阶段'] = r.result.stage;
        out['置信度'] = Math.round(r.result.confidence || 0);
        out['判断点'] = (r.result.points || []).join('、');
        out['说明'] = r.result.reason || '';
        out['关键证据'] = r.result.evidence || '';
        out['改进建议'] = r.result.suggestion || '';
        out['文档总结'] = r.result.docSummary || '';
        out['录音内容'] = r.content;
        return out;
      });
      try {
        await exportServiceResultsExcel(rows);
      } catch (err) {
        var csvRows = [Object.keys(rows[0])].concat(rows.map(function (row) { return Object.keys(rows[0]).map(function (k) { return row[k]; }); }));
        downloadText('service-check-results.csv', csvRows.map(function (row) { return row.map(csvEscape).join(','); }).join('\n'), 'text/csv;charset=utf-8');
      }
    });
    var batchDocBtn = byId('tb-service-batch-doc-export');
    if (batchDocBtn) batchDocBtn.addEventListener('click', function () {
      if (!batchResults.length) return;
      downloadServiceDoc('service-check-batch-report.doc', 'service-check 批量质检报告', batchResults);
    });
  }


  function removeScrapeModule() {
    var headers = Array.prototype.slice.call(document.querySelectorAll('.panel-header h2, h2, h3'));
    headers.forEach(function (h) {
      if ((h.textContent || '').indexOf('网页数据抓取') >= 0) {
        var panel = h.closest('.panel') || h.closest('section') || h.parentElement;
        if (panel) panel.classList.add('tb-hidden-scrape-module');
      }
    });
  }
  function boot() {
    var root = byId('root');
    if (!root || document.querySelector('.tb-topbar')) return;

    var topbar = document.createElement('nav');
    topbar.className = 'tb-topbar';
    topbar.innerHTML = [
      '<div class="tb-topbar-inner">',
        '<div class="tb-brand" aria-label="WFM数据分析助手">',
          '<div class="tb-brand-logo">📊</div>',
          '<div>',
            '<div class="tb-brand-title">WFM数据分析助手</div>',
            '<div class="tb-brand-subtitle">通用分析 · 专项运营 · AI增强</div>',
          '</div>',
        '</div>',
        '<div class="tb-tabs" role="tablist" aria-label="页面导航">',
          '<button class="tb-tab active" data-tb-page="general" role="tab" aria-selected="true">通用分析</button>',
          '<button class="tb-tab" data-tb-page="special" role="tab" aria-selected="false">专项分析</button>',
        '</div>',
        '<div class="tb-status-pill"><span class="tb-status-dot"></span>AI 设置全局可用</div>',
      '</div>'
    ].join('');
    document.body.insertBefore(topbar, document.body.firstChild);

    renderSpecialPage(root);
    initServiceCheck();
    updateAiConfigState();
    removeScrapeModule();
    setTimeout(removeScrapeModule, 800);

    function switchPage(page) {
      var isSpecial = page === 'special';
      document.body.classList.toggle('tb-page-special', isSpecial);
      document.querySelectorAll('[data-tb-page]').forEach(function (el) {
        var active = el.getAttribute('data-tb-page') === page;
        if (el.classList.contains('tb-tab')) {
          el.classList.toggle('active', active);
          el.setAttribute('aria-selected', active ? 'true' : 'false');
        }
      });
      if (location.hash !== '#' + page) history.replaceState(null, '', '#' + page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    document.addEventListener('click', function (event) {
      var pageTrigger = event.target.closest('[data-tb-page]');
      if (pageTrigger) {
        event.preventDefault();
        switchPage(pageTrigger.getAttribute('data-tb-page'));
        return;
      }
      var catTrigger = event.target.closest('[data-tb-special-category]');
      if (catTrigger) {
        event.preventDefault();
        var cat = catTrigger.getAttribute('data-tb-special-category');
        document.querySelectorAll('[data-tb-special-category]').forEach(function (el) {
          var active = el.getAttribute('data-tb-special-category') === cat;
          el.classList.toggle('active', active);
          el.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        document.querySelectorAll('[data-tb-special-panel]').forEach(function (el) {
          el.classList.toggle('active', el.getAttribute('data-tb-special-panel') === cat);
        });
      }
    });
    window.addEventListener('storage', function (event) { if (event.key === 'excel-ai-config') updateAiConfigState(); });
    window.addEventListener('hashchange', function () { switchPage(location.hash === '#special' ? 'special' : 'general'); updateAiConfigState(); removeScrapeModule(); });
    switchPage(location.hash === '#special' ? 'special' : 'general');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
