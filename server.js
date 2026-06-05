/*
 * WFM 数据分析助手后端接口（集成版）
 *
 * 原能力：
 * - 静态资源服务：GET /
 * - 健康检查：GET /api/health
 * - service-check 质检：POST /api/service-check
 * - chaping-check 差评分析：POST /api/chaping-check
 *
 * 新增能力：
 * - 本地 Skills 扫描：GET /api/skills
 * - Skill 详情：GET /api/skills/:id
 * - Skill + LLM 执行：POST /api/skills/:id/run
 * - 通用 LLM 对话：POST /api/llm/chat
 *
 * 环境变量：
 *   PORT=8787
 *   WFM_BACKEND_TOKEN=可选，若设置则前端需传 Authorization: Bearer <token>
 *   WFM_LLM_PROVIDER=openai|anthropic，默认 openai
 *   WFM_LLM_BASE_URL=https://...，OpenAI 兼容接口可填到 /v1 或域名根路径
 *   WFM_LLM_API_KEY=模型 API Key
 *   WFM_LLM_MODEL=默认模型名称
 *   WFM_LLM_MODELS=可选模型列表，英文逗号分隔，例如 gpt-4o-mini,gpt-4o
 *   WFM_LLM_TIMEOUT_MS=60000
 *   SKILLS_DIR=本地 skills 根目录，默认当前项目 .skills
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const BACKEND_TOKEN = String(process.env.WFM_BACKEND_TOKEN || '').trim();
const PROVIDER = String(process.env.WFM_LLM_PROVIDER || 'openai').trim().toLowerCase();
const BASE_URL = String(process.env.WFM_LLM_BASE_URL || process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || '').trim().replace(/\/+$/, '');
const API_KEY = String(process.env.WFM_LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '').trim();
const MODEL = String(process.env.WFM_LLM_MODEL || process.env.OPENAI_MODEL || process.env.LLM_MODEL || (PROVIDER === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini')).trim();
const AVAILABLE_MODELS = Array.from(new Set(
  String(process.env.WFM_LLM_MODELS || process.env.OPENAI_MODELS || process.env.LLM_MODELS || MODEL)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
));
const TIMEOUT_MS = Number(process.env.WFM_LLM_TIMEOUT_MS || 60000);
const SKILLS_DIR = path.resolve(process.env.SKILLS_DIR || path.join(ROOT, '.skills'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    ...headers
  });
  res.end(payload);
}

function sendJson(res, status, body) {
  send(res, status, body, { 'Content-Type': 'application/json; charset=utf-8' });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) {
        reject(new Error('请求体过大，最大支持 8MB'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

function checkAuth(req) {
  if (!BACKEND_TOKEN) return true;
  const auth = String(req.headers.authorization || '').trim();
  return auth === `Bearer ${BACKEND_TOKEN}`;
}

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function extractJsonObject(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`模型返回不是 JSON：${raw.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

async function callOpenAICompatibleMessages(messages, options = {}) {
  const selectedModel = String(options.model || MODEL).trim() || MODEL;
  if (!BASE_URL || !API_KEY) {
    return {
      mock: true,
      content: [
        '【模拟模式】后端尚未配置大模型网关。',
        '',
        `模型：${selectedModel}`,
        `Provider：${PROVIDER}`,
        '',
        '请配置 WFM_LLM_BASE_URL / WFM_LLM_API_KEY / WFM_LLM_MODEL，或 OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL。',
        '',
        '收到的任务摘要：',
        String(messages[messages.length - 1]?.content || '').slice(0, 800)
      ].join('\n')
    };
  }

  const endpoint = /\/chat\/completions$/.test(BASE_URL)
    ? BASE_URL
    : /\/v1$/.test(BASE_URL)
      ? `${BASE_URL}/chat/completions`
      : `${BASE_URL}/v1/chat/completions`;

  const resp = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: selectedModel,
      temperature: options.temperature ?? 0.2,
      messages
    })
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`LLM 请求失败 HTTP ${resp.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 未返回 choices[0].message.content');
  return { content, raw: data };
}

async function callAnthropicMessages(messages, options = {}) {
  const selectedModel = String(options.model || MODEL).trim() || MODEL;
  if (!BASE_URL || !API_KEY) return callOpenAICompatibleMessages(messages, options);
  const endpoint = /\/v1\/messages$/.test(BASE_URL) ? BASE_URL : `${BASE_URL}/v1/messages`;
  const system = messages.find(m => m.role === 'system')?.content || '你是严谨的数据分析助手。';
  const anthropicMessages = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  const resp = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: selectedModel,
      max_tokens: options.maxTokens || 3000,
      temperature: options.temperature ?? 0.2,
      system,
      messages: anthropicMessages
    })
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`LLM 请求失败 HTTP ${resp.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  const content = (data?.content || []).map(item => item.type === 'text' ? item.text : '').join('');
  if (!content) throw new Error('LLM 未返回 content text');
  return { content, raw: data };
}

async function callLLMMessages(messages, options = {}) {
  if (PROVIDER === 'anthropic') return callAnthropicMessages(messages, options);
  return callOpenAICompatibleMessages(messages, options);
}

async function callLLMJson(prompt) {
  const result = await callLLMMessages([
    { role: 'system', content: '你是严格的质检评分器。你必须只输出一个 JSON 对象。' },
    { role: 'user', content: prompt }
  ], { temperature: 0 });
  if (result.mock) {
    return {
      stage: '不涉及',
      confidence: 0,
      points: [],
      reason: '后端未配置大模型，当前为模拟模式',
      evidence: '',
      suggestion: '配置 WFM_LLM_BASE_URL 和 WFM_LLM_API_KEY 后重试',
      docSummary: '模拟模式未进行真实质检。'
    };
  }
  return extractJsonObject(result.content);
}

function buildServiceCheckPrompt(conversation) {
  return [
    '你是 service-check 客服质检评分专家。请严格基于以下专项能力对客服对话进行「有效共情」质检打分。',
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
    String(conversation || '').slice(0, 16000)
  ].join('\n');
}

function buildChapingPrompt(conversation) {
  return [
    '你是携程展演人工差评数据分析专家。严格基于沟通内容分析，不虚构。',
    '输出严格 JSON：{"summary":"200字以内会话总结","category":"25分类之一","reason":"分类原因","improvement":"员工问题时输出改进原因和建议，否则为空","sentiment":"客户情绪"}',
    '分类只能从以下25类选择：员工问题-沟通技巧问题；员工问题-未理解客户需求；员工问题-问题解决能力欠佳；员工问题-方案给到错误；员工问题-流程执行问题；流程不符客人预期-客户联系酒店同意退改；特殊要求无法满足-提前知晓活动信息（座位/报名结果等）；特殊要求无法满足-取票/座位安排不满；特殊要求无法满足-开发票慢/邮寄相关不满；披露歧义或不完整-政策/领取等信息披露问题；资源确认异常-酒店满位；资源确认异常-确认后满；行中问题不满-演出安排不满；行中问题不满-酒店设施/安排不满；价格争议-反馈酒店降价；价格争议-服务费不满；价格争议-反馈门票降价；系统问题-系统问题；不可控因素-共性演出取消/延期等；退改条款-整单退；退改条款-酒店退改；退改条款-修改出行人；退改条款-酒店修改入住人；退改条款-酒店增加出行人；未见有不满-未见有不满。',
    '【待分析对话】',
    String(conversation || '').slice(0, 16000)
  ].join('\n');
}

function normalizeServiceResult(value) {
  const obj = value && typeof value === 'object' ? value : {};
  let stage = String(obj.stage || obj.result || obj.level || '阶段二').trim();
  if (!/^(阶段一|阶段二|阶段三|阶段四|不涉及)$/.test(stage)) stage = '阶段二';
  return {
    stage,
    confidence: Math.max(0, Math.min(100, Number(obj.confidence || 70))),
    points: Array.isArray(obj.points) ? obj.points : [],
    reason: String(obj.reason || '').trim(),
    evidence: String(obj.evidence || '').trim(),
    suggestion: String(obj.suggestion || '').trim(),
    docSummary: String(obj.docSummary || '').trim()
  };
}

async function handleServiceCheck(req, res) {
  if (!checkAuth(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
  const body = await readJson(req);
  const conversation = String(body.conversation || body.text || body.content || '').trim();
  if (!conversation) return sendJson(res, 400, { success: false, error: 'conversation 不能为空' });
  const prompt = body.prompt || buildServiceCheckPrompt(conversation);
  const raw = await callLLMJson(prompt);
  const result = normalizeServiceResult(raw);
  return sendJson(res, 200, { success: true, result, rawModelOutput: raw });
}

async function handleChapingCheck(req, res) {
  if (!checkAuth(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
  const body = await readJson(req);
  const conversation = String(body.conversation || body.text || body.content || '').trim();
  if (!conversation) return sendJson(res, 400, { success: false, error: 'conversation 不能为空' });
  const prompt = body.prompt || buildChapingPrompt(conversation);
  const raw = await callLLMJson(prompt);
  return sendJson(res, 200, { success: true, result: raw, rawModelOutput: raw });
}

function parseSkillMarkdown(markdown = '', id = '') {
  const lines = markdown.split(/\r?\n/);
  const h1 = lines.find(line => /^#\s+/.test(line));
  const title = h1 ? h1.replace(/^#\s+/, '').trim() : id;
  const descriptionLine = lines.find(line => /^(>|描述[:：]|description[:：])/i.test(line.trim()));
  const description = descriptionLine
    ? descriptionLine.replace(/^>\s*/, '').replace(/^(描述|description)[:：]\s*/i, '').trim()
    : lines.filter(line => line.trim() && !line.startsWith('#')).slice(0, 2).join(' ').slice(0, 160);
  const tags = Array.from(markdown.matchAll(/(?:tags?|标签)[:：]\s*([^\n]+)/gi))
    .flatMap(m => m[1].split(/[,，\s]+/).filter(Boolean))
    .slice(0, 8);
  return { title, description, tags };
}

function safeSkillId(id) {
  const value = String(id || '').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error('非法 skill id');
  return value;
}

async function readSkill(id) {
  const safeId = safeSkillId(id);
  const skillDir = path.resolve(SKILLS_DIR, safeId);
  if (!skillDir.startsWith(SKILLS_DIR)) throw new Error('非法 skill 路径');
  const candidates = ['SKILL.md', 'skill.md', 'README.md'];
  for (const filename of candidates) {
    const file = path.join(skillDir, filename);
    try {
      const markdown = await fsp.readFile(file, 'utf8');
      return { id: safeId, path: file, markdown, ...parseSkillMarkdown(markdown, safeId) };
    } catch {}
  }
  throw new Error(`未找到 ${safeId}/SKILL.md`);
}

async function listSkills() {
  try { await fsp.access(SKILLS_DIR); } catch { return []; }
  const entries = await fsp.readdir(SKILLS_DIR, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const skill = await readSkill(entry.name);
      skills.push({ id: skill.id, title: skill.title, description: skill.description, tags: skill.tags, path: skill.path });
    } catch {}
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

function tableToMarkdown(table) {
  if (!table) return '';
  if (typeof table === 'string') return table.slice(0, 30000);
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  if (!headers.length && !rows.length) return JSON.stringify(table).slice(0, 30000);
  const sampleRows = rows.slice(0, 200);
  const lines = [];
  lines.push(`总行数：${rows.length}`);
  if (headers.length) {
    lines.push('');
    lines.push(`| ${headers.map(v => String(v ?? '').replace(/\|/g, '\\|')).join(' | ')} |`);
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
    for (const row of sampleRows) lines.push(`| ${headers.map((_, i) => String((row || [])[i] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`);
  }
  return lines.join('\n').slice(0, 30000);
}

async function handleRunSkill(req, res, id) {
  if (!checkAuth(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
  const body = await readJson(req);
  const skill = await readSkill(id);
  const task = String(body.task || body.question || body.prompt || '请分析这份表格并输出结论。').trim();
  const selectedModel = String(body.model || MODEL).trim() || MODEL;
  const tableContext = tableToMarkdown(body.table || body.data || body.dataset);
  const messages = [
    { role: 'system', content: `你是 WFM 数据分析助手。请严格遵循以下本地 Skill 文档执行任务。\n\n${skill.markdown}` },
    { role: 'user', content: [`【用户任务】`, task, '', '【表格数据/上下文】', tableContext || '用户未提供表格数据。', '', '请使用中文 Markdown 输出，优先给出核心结论、关键指标、异常点和建议。不要编造输入中不存在的数据。'].join('\n') }
  ];
  const llm = await callLLMMessages(messages, { temperature: 0.2, model: selectedModel });
  return sendJson(res, 200, { success: true, skill: { id: skill.id, title: skill.title }, model: selectedModel, result: llm.content, mock: Boolean(llm.mock), rawModelOutput: llm.raw || null });
}

async function handleLLMChat(req, res) {
  if (!checkAuth(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
  const body = await readJson(req);
  const message = String(body.message || body.prompt || body.task || '').trim();
  if (!message) return sendJson(res, 400, { success: false, error: 'message 不能为空' });
  const selectedModel = String(body.model || MODEL).trim() || MODEL;
  const tableContext = tableToMarkdown(body.table || body.data || body.dataset);
  const messages = [
    { role: 'system', content: '你是 WFM 数据分析助手，擅长 Excel/CSV 数据分析。请用中文 Markdown 输出。' },
    { role: 'user', content: [message, '', tableContext ? `【表格数据】\n${tableContext}` : ''].join('\n') }
  ];
  const llm = await callLLMMessages(messages, { temperature: 0.2, model: selectedModel });
  return sendJson(res, 200, { success: true, model: selectedModel, result: llm.content, mock: Boolean(llm.mock), rawModelOutput: llm.raw || null });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  rel = rel.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, rel);
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
    const ext = path.extname(filePath).toLowerCase();
    const cache = rel === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      if (!checkAuth(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      return sendJson(res, 200, {
        success: true,
        service: 'wfm-excel-statistics-backend',
        provider: PROVIDER,
        model: MODEL,
        availableModels: AVAILABLE_MODELS,
        llmConfigured: Boolean(BASE_URL && API_KEY),
        skillsDir: SKILLS_DIR,
        endpoints: ['/api/service-check', '/api/chaping-check', '/api/skills', '/api/skills/:id/run', '/api/llm/chat']
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/skills') {
      if (!checkAuth(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      return sendJson(res, 200, { success: true, skillsDir: SKILLS_DIR, skills: await listSkills() });
    }

    const skillDetailMatch = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
    if (req.method === 'GET' && skillDetailMatch) {
      if (!checkAuth(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const skill = await readSkill(skillDetailMatch[1]);
      return sendJson(res, 200, { success: true, skill });
    }

    const skillRunMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/run$/);
    if (req.method === 'POST' && skillRunMatch) return handleRunSkill(req, res, skillRunMatch[1]);
    if (req.method === 'POST' && url.pathname === '/api/llm/chat') return handleLLMChat(req, res);
    if (req.method === 'POST' && url.pathname === '/api/service-check') return handleServiceCheck(req, res);
    if (req.method === 'POST' && url.pathname === '/api/chaping-check') return handleChapingCheck(req, res);

    return serveStatic(req, res, url.pathname);
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message || String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`WFM backend listening on http://localhost:${PORT}`);
  console.log(`Skills dir: ${SKILLS_DIR}`);
  console.log(`LLM configured: ${Boolean(BASE_URL && API_KEY)} (${PROVIDER}/${MODEL})`);
});
