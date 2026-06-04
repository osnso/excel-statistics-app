(function () {
  if (window.__wfmSkillLibraryInited) return;
  window.__wfmSkillLibraryInited = true;

  var SKILL_ITEMS = [
    {
      id: 'service-check',
      name: 'service-check 客服质检评估',
      icon: '🧑‍💼',
      category: '专项分析 / 成本/用量运营',
      status: '已实现',
      tags: ['有效共情', 'Excel批量', '结果导出', 'LLM打分', '报告文档'],
      summary: '这是当前「专项分析」里真正已经实现、可直接使用的技能。用于对客服对话或录音转写内容进行 service-check 质检，重点识别“有效共情”表现，输出质检阶段、置信度、判断点和原因说明；支持单条评估、Excel 批量评估、结果 Excel 导出和质检报告文档导出，并复用「通用分析 → AI设置」中的全局模型配置。',
      usage: [
        '入口：专项分析 → 成本/用量运营 → service-check 客服质检评估。',
        '单条评估：粘贴客服与客人对话文本，点击开始评估，返回阶段、置信度、判断点与原因。',
        '批量评估：上传包含「录音内容 / 对话内容」等字段的 Excel 文档，批量生成每条记录的评估结果，并可导出 Excel。',
        'LLM 打分：统一读取「通用分析 → AI设置」的 API Key / Base URL / 模型；配置后直接通过 LLM 输出评分和质检报告。'
      ]
    }
  ];

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  function byId(id) { return document.getElementById(id); }

  function renderSkillLibrary(keyword) {
    var q = String(keyword || '').trim().toLowerCase();
    var list = byId('skillLibraryList');
    if (!list) return;
    var items = SKILL_ITEMS.filter(function (item) {
      return !q || [item.name, item.category, item.status, item.summary].concat(item.tags).join(' ').toLowerCase().indexOf(q) >= 0;
    });
    list.innerHTML = items.map(function (item) {
      return '<div class="glossary-item">' +
        '<div class="glossary-item-header">' +
          '<span class="icon">' + item.icon + '</span>' +
          '<span class="name">' + esc(item.name) + '</span>' +
          '<span class="arrow">▼</span>' +
        '</div>' +
        '<div class="glossary-item-body">' +
          '<h4>功能总结</h4>' +
          '<p class="skill-summary">' + esc(item.summary) + '</p>' +
          '<h4>所属位置</h4>' +
          '<p>' + esc(item.category) + ' · ' + esc(item.status) + '</p>' +
          '<div class="skill-meta-row">' + item.tags.map(function (tag) { return '<span class="skill-chip">' + esc(tag) + '</span>'; }).join('') + '</div>' +
          '<h4 style="margin-top:14px;">使用方式</h4>' +
          '<ul class="skill-usage-list">' + item.usage.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul>' +
        '</div>' +
      '</div>';
    }).join('') || '<div class="glossary-item"><div class="glossary-item-header"><span class="icon">🔎</span><span class="name">未找到匹配技能</span></div></div>';
  }

  function bootSkillLibrary() {
    var fab = byId('skillLibraryFab');
    var overlay = byId('skillLibraryOverlay');
    var closeBtn = byId('skillLibraryClose');
    var search = byId('skillLibrarySearch');
    var list = byId('skillLibraryList');
    if (!fab || !overlay || !closeBtn || !search || !list) return;
    renderSkillLibrary('');
    fab.addEventListener('click', function () { overlay.classList.add('open'); setTimeout(function () { search.focus(); }, 60); });
    closeBtn.addEventListener('click', function () { overlay.classList.remove('open'); });
    overlay.addEventListener('click', function (event) { if (event.target === overlay) overlay.classList.remove('open'); });
    search.addEventListener('input', function (event) { renderSkillLibrary(event.target.value); });
    list.addEventListener('click', function (event) {
      var header = event.target.closest('.glossary-item-header');
      if (!header) return;
      var item = header.closest('.glossary-item');
      var body = item && item.querySelector('.glossary-item-body');
      var arrow = item && item.querySelector('.arrow');
      if (body) body.classList.toggle('open');
      if (arrow) arrow.classList.toggle('open');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootSkillLibrary);
  else bootSkillLibrary();
})();
