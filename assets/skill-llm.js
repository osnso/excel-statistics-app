(() => {
  const state = {
    // 高级用法：仍支持通过 localStorage 手动设置后端地址和 Token；页面不再展示配置区。
    apiBase: localStorage.getItem('WFM_SKILL_API_BASE') || '',
    token: localStorage.getItem('WFM_BACKEND_TOKEN') || '',
    availableModels: [],
    selectedModel: localStorage.getItem('WFM_SELECTED_LLM_MODEL') || '',
    skills: [],
    selectedSkillId: '',
    table: null
  };

  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (text) => String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function apiUrl(path) {
    const base = String(state.apiBase || '').replace(/\/+$/, '');
    return `${base}${path}`;
  }

  async function api(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    };
    const resp = await fetch(apiUrl(path), { ...options, headers });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) {
      throw new Error(data.error || `请求失败：HTTP ${resp.status}`);
    }
    return data;
  }

  function setStatus(message, type = 'info') {
    const el = $('#skillLlmStatus');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.type = type;
  }

  function parseTable(raw) {
    const text = String(raw || '').trim();
    if (!text) return { headers: [], rows: [] };
    const lines = text.split(/\r?\n/).filter(Boolean);
    const delimiter = lines.some(line => line.includes('\t')) ? '\t' : ',';
    const parseLine = (line) => {
      const cells = [];
      let cur = '';
      let quote = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
        if (ch === '"') { quote = !quote; continue; }
        if (ch === delimiter && !quote) { cells.push(cur.trim()); cur = ''; continue; }
        cur += ch;
      }
      cells.push(cur.trim());
      return cells;
    };
    const rows = lines.map(parseLine);
    return { headers: rows[0] || [], rows: rows.slice(1) };
  }

  function renderPreview() {
    const box = $('#skillLlmPreview');
    if (!box) return;
    const table = state.table;
    if (!table || !table.headers.length) {
      box.innerHTML = '<div class="muted" style="padding:12px">暂无表格数据，请粘贴 CSV/TSV 或上传文件。</div>';
      return;
    }
    const rows = table.rows.slice(0, 30);
    box.innerHTML = `
      <table>
        <thead><tr>${table.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row => `<tr>${table.headers.map((_, i) => `<td>${escapeHtml(row[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <div class="muted" style="padding:8px 10px">共 ${table.rows.length} 行，预览前 ${rows.length} 行。</div>
    `;
  }

  function renderSkills() {
    const box = $('#skillLlmSkills');
    if (!box) return;
    if (!state.skills.length) {
      box.innerHTML = '<div class="muted">未发现本地 Skills。请确认后端 SKILLS_DIR 下存在 */SKILL.md。</div>';
      return;
    }
    box.innerHTML = state.skills.map(skill => `
      <article class="skill-card ${state.selectedSkillId === skill.id ? 'active' : ''}" data-skill-id="${escapeHtml(skill.id)}">
        <h4>${escapeHtml(skill.title || skill.id)}</h4>
        <p>${escapeHtml(skill.description || '暂无描述')}</p>
        <div>${(skill.tags || []).map(tag => `<span class="skill-tag">${escapeHtml(tag)}</span>`).join('')}</div>
        <small class="muted">${escapeHtml(skill.id)}</small>
      </article>
    `).join('');
    box.querySelectorAll('.skill-card').forEach(card => {
      card.addEventListener('click', () => {
        state.selectedSkillId = card.dataset.skillId;
        renderSkills();
      });
    });
  }

  function renderModels(models, currentModel) {
    const select = $('#skillLlmModel');
    if (!select) return;
    state.availableModels = Array.isArray(models) && models.length ? models : (currentModel ? [currentModel] : []);
    if (!state.selectedModel || !state.availableModels.includes(state.selectedModel)) {
      state.selectedModel = currentModel || state.availableModels[0] || '';
    }
    select.innerHTML = state.availableModels.map(model => `
      <option value="${escapeHtml(model)}" ${model === state.selectedModel ? 'selected' : ''}>${escapeHtml(model)}</option>
    `).join('');
  }

  async function loadHealth() {
    const data = await api('/api/health');
    renderModels(data.availableModels || data.models || [], data.model || '');
    const health = $('#skillLlmHealth');
    if (health) {
      health.innerHTML = `
        <strong>${data.llmConfigured ? 'LLM 已配置' : '模拟模式'}</strong>　
        <span>Provider：${escapeHtml(data.provider || '-')}</span>
      `;
    }
    return data;
  }

  async function loadSkills() {
    setStatus('正在刷新 Skills...', 'info');
    const data = await api('/api/skills');
    state.skills = data.skills || [];
    if (!state.selectedSkillId && state.skills[0]) state.selectedSkillId = state.skills[0].id;
    renderSkills();
    setStatus(`已加载 ${state.skills.length} 个 Skills`, 'success');
  }

  async function runSkill() {
    if (!state.selectedSkillId) throw new Error('请先选择一个 Skill');
    const task = $('#skillLlmTask').value.trim() || '请分析这份表格，并给出核心结论、异常点和建议。';
    setStatus('正在调用 Skill + LLM...', 'info');
    $('#skillLlmResult').textContent = '分析中...';
    const data = await api(`/api/skills/${encodeURIComponent(state.selectedSkillId)}/run`, {
      method: 'POST',
      body: JSON.stringify({ task, table: state.table, model: state.selectedModel })
    });
    $('#skillLlmResult').textContent = data.result || JSON.stringify(data, null, 2);
    setStatus(data.mock ? '已返回模拟结果：请配置大模型环境变量后获得真实结果' : `分析完成（${data.model || state.selectedModel || '默认模型'}）`, data.mock ? 'info' : 'success');
  }

  async function runChat() {
    const message = $('#skillLlmTask').value.trim() || '请分析这份表格，并给出核心结论、异常点和建议。';
    setStatus('正在调用 LLM...', 'info');
    $('#skillLlmResult').textContent = '分析中...';
    const data = await api('/api/llm/chat', {
      method: 'POST',
      body: JSON.stringify({ message, table: state.table, model: state.selectedModel })
    });
    $('#skillLlmResult').textContent = data.result || JSON.stringify(data, null, 2);
    setStatus(data.mock ? '已返回模拟结果：请配置大模型环境变量后获得真实结果' : `分析完成（${data.model || state.selectedModel || '默认模型'}）`, data.mock ? 'info' : 'success');
  }

  function loadDemo() {
    const demo = '日期,团队,工单量,满意度,平均处理时长\n2026-06-01,A组,120,95%,4.2\n2026-06-01,B组,86,88%,6.1\n2026-06-02,A组,132,96%,4.0\n2026-06-02,B组,91,87%,6.4\n2026-06-03,A组,118,94%,4.5\n2026-06-03,B组,160,79%,8.2';
    $('#skillLlmRawData').value = demo;
    state.table = parseTable(demo);
    renderPreview();
    setStatus('已加载示例数据', 'success');
  }

  function bindEvents() {
    const modelSelect = $('#skillLlmModel');
    if (modelSelect) {
      modelSelect.addEventListener('change', () => {
        state.selectedModel = modelSelect.value;
        localStorage.setItem('WFM_SELECTED_LLM_MODEL', state.selectedModel);
        setStatus(`已选择模型：${state.selectedModel}`, 'success');
      });
    }
    $('#skillLlmRefresh').addEventListener('click', async () => {
      try { await loadHealth(); await loadSkills(); } catch (err) { setStatus(err.message, 'error'); }
    });
    $('#skillLlmParse').addEventListener('click', () => {
      state.table = parseTable($('#skillLlmRawData').value);
      renderPreview();
      setStatus(`已解析 ${state.table.rows.length} 行数据`, 'success');
    });
    $('#skillLlmDemo').addEventListener('click', loadDemo);
    $('#skillLlmRunSkill').addEventListener('click', () => runSkill().catch(err => { $('#skillLlmResult').textContent = err.message; setStatus(err.message, 'error'); }));
    $('#skillLlmRunChat').addEventListener('click', () => runChat().catch(err => { $('#skillLlmResult').textContent = err.message; setStatus(err.message, 'error'); }));
    $('#skillLlmFile').addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const text = await file.text();
      $('#skillLlmRawData').value = text;
      state.table = parseTable(text);
      renderPreview();
      setStatus(`已读取文件：${file.name}`, 'success');
    });
  }

  function syncHashVisibility() {
    const section = $('#localSkillLlmWorkbench');
    if (!section) return;
    if (location.hash === '#special') {
      setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    }
  }

  async function init() {
    if (!$('#localSkillLlmWorkbench')) return;
    bindEvents();
    renderPreview();
    try { await loadHealth(); await loadSkills(); } catch (err) { setStatus(`后端未连接：${err.message}`, 'error'); }
    syncHashVisibility();
    window.addEventListener('hashchange', syncHashVisibility);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
