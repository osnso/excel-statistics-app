/*
 * WFM 数据分析助手后端接口
 * - 静态资源服务：GET /
 * - 健康检查：GET /api/health
 * - service-check 质检：POST /api/service-check
 *
 * 环境变量：
 *   PORT=8787
 *   WFM_BACKEND_TOKEN=可选，若设置则前端需传 Authorization: Bearer <token>
 *   WFM_LLM_PROVIDER=openai|anthropic，默认 openai
 *   WFM_LLM_BASE_URL=https://...，OpenAI 兼容接口可填到 /v1 或域名根路径
 *   WFM_LLM_API_KEY=模型 API Key
 *   WFM_LLM_MODEL=模型名称
 *   WFM_LLM_TIMEOUT_MS=60000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const BACKEND_TOKEN = String(process.env.WFM_BACKEND_TOKEN || '').trim();
const PROVIDER = String(process.env.WFM_LLM_PROVIDER || 'openai').trim().toLowerCase();
const BASE_URL = String(process.env.WFM_LLM_BASE_URL || '').trim().replace(/\/+$/, '');
const API_KEY = String(process.env.WFM_LLM_API_KEY || '').trim();
const MODEL = String(process.env.WFM_LLM_MODEL || (PROVIDER === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini')).trim();
const TIMEOUT_MS = Number(process.env.WFM_LLM_TIMEOUT_MS || 60000);

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
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
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
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('请求体过大，最大支持 2MB'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

function checkAuth(req) {
  if (!BACKEND_TOKEN) return true;
  const auth = String(req.headers.authorization || '').trim();
  return auth === `Bearer ${BACKEND_TOKEN}`;
}

function buildServiceCheckPrompt(conversation) {
  return [
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
    String(conversation || '').slice(0, 16000)
  ].join('\n');
}

function buildChapingPrompt(conversation) {
  return [
    '你是携程展演人工差评数据分析专家。严格基于沟通内容分析，不虚构。',
    '输出严格 JSON：{"summary":"200字以内会话总结","category":"25分类之一","reason":"分类原因","improvement":"员工问题时输出改进原因和建议，否则为空","sentiment":"客户情绪"}',
    '分类只能从以下25类选择：员工问题-沟通技巧问题；员工问题-未理解客户需求；员工问题-问题解决能力欠佳；员工问题-方案给到错误；员工问题-流程执行问题；流程不符客人预期-客户联系酒店同意退改；特殊要求无法满足-提前知晓活动信息（座位/报名结果等）；特殊要求无法满足-取票/座位安排不满；特殊要求无法满足-开发票慢/邮寄相关不满；披露歧义或不完整-政策/领取等信息披露问题；资源确认异常-酒店满位；资源确认异常-确认后满；行中问题不满-演出安排不满；行中问题不满-酒店设施/安排不满；价格争议-反馈酒店降价；价格争议-服务费不满；价格争议-反馈门票降价；系统问题-系统问题；不可控因素-共性演出取消/延期等；退改条款-整单退；退改条款-酒店退改；退改条款-修改出行人；退改条款-酒店修改入住人；退改条款-酒店增加出行人；未见有不满-未见有不满。',
    '易错：催出票/座位号/地址/连坐归“特殊要求无法满足-提前知晓活动信息”；活动前座位投诉归“特殊要求无法满足-取票/座位安排不满”；活动后视野/音响/艺人体验投诉归“行中问题不满-演出安排不满”。',
    '【待分析对话】',
    String(conversation || '').slice(0, 16000)
  ].join('\n');
}


function extractJsonObject(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`模型返回不是 JSON：${raw.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

function normalizeServiceResult(value) {
  const obj = value && typeof value === 'object' ? value : {};
  let stage = String(obj.stage || obj.result || obj.level || '阶段二').trim();
  if (!/^(阶段一|阶段二|阶段三|阶段四|不涉及)$/.test(stage)) {
    const m = stage.match(/阶段[一二三四]|不涉及/);
    stage = m ? m[0] : '阶段二';
  }
  let confidence = Number(obj.confidence == null ? obj.score : obj.confidence);
  if (!Number.isFinite(confidence)) confidence = 75;
  confidence = Math.max(0, Math.min(100, confidence));
  let points = Array.isArray(obj.points) ? obj.points : [];
  points = points
    .map(p => Number(String(p).replace(/[^0-9]/g, '')))
    .filter(p => p >= 1 && p <= 9);
  return {
    stage,
    confidence,
    points,
    reason: String(obj.reason || obj.explanation || obj.summary || 'LLM 已完成评估。').trim(),
    evidence: String(obj.evidence || obj.quote || obj.keyEvidence || '').trim(),
    suggestion: String(obj.suggestion || obj.advice || obj.improvement || '').trim(),
    docSummary: String(obj.docSummary || obj.report || obj.reportSummary || obj.reason || 'LLM 已完成评估。').trim(),
    source: 'backend-llm'
  };
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAICompatible(prompt) {
  if (!BASE_URL || !API_KEY) throw new Error('后端未配置 WFM_LLM_BASE_URL 或 WFM_LLM_API_KEY');
  const endpoint = /\/chat\/completions$/.test(BASE_URL)
    ? BASE_URL
    : `${BASE_URL.replace(/\/v1$/, '')}/v1/chat/completions`;
  const resp = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你是严格的质检评分器。你必须只输出一个 JSON 对象。' },
        { role: 'user', content: prompt }
      ]
    })
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`LLM 请求失败 HTTP ${resp.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 未返回 choices[0].message.content');
  return extractJsonObject(content);
}

async function callAnthropic(prompt) {
  if (!BASE_URL || !API_KEY) throw new Error('后端未配置 WFM_LLM_BASE_URL 或 WFM_LLM_API_KEY');
  const endpoint = /\/v1\/messages$/.test(BASE_URL) ? BASE_URL : `${BASE_URL}/v1/messages`;
  const resp = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1600,
      temperature: 0,
      system: '你是严格的质检评分器。你必须只输出一个 JSON 对象。',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`LLM 请求失败 HTTP ${resp.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  const content = (data?.content || []).map(item => item.type === 'text' ? item.text : '').join('');
  if (!content) throw new Error('LLM 未返回 content text');
  return extractJsonObject(content);
}

async function callLLM(prompt) {
  if (PROVIDER === 'anthropic') return callAnthropic(prompt);
  return callOpenAICompatible(prompt);
}

async function handleServiceCheck(req, res) {
  if (!checkAuth(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
  const body = await readJson(req);
  const conversation = String(body.conversation || body.text || body.content || '').trim();
  if (!conversation) return sendJson(res, 400, { success: false, error: 'conversation 不能为空' });
  const prompt = body.prompt || buildServiceCheckPrompt(conversation);
  const raw = await callLLM(prompt);
  const result = normalizeServiceResult(raw);
  return sendJson(res, 200, { success: true, result, rawModelOutput: raw });
}

async function handleChapingCheck(req, res) {
  if (!checkAuth(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
  const body = await readJson(req);
  const conversation = String(body.conversation || body.text || body.content || '').trim();
  if (!conversation) return sendJson(res, 400, { success: false, error: 'conversation 不能为空' });
  const prompt = body.prompt || buildChapingPrompt(conversation);
  const raw = await callLLM(prompt);
  return sendJson(res, 200, { success: true, result: raw, rawModelOutput: raw });
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
        service: 'wfm-service-check-backend',
        provider: PROVIDER,
        model: MODEL,
        llmConfigured: Boolean(BASE_URL && API_KEY)
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/service-check') return await handleServiceCheck(req, res);
    if (req.method === 'POST' && url.pathname === '/api/chaping-check') return await handleChapingCheck(req, res);
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
    return sendJson(res, 405, { success: false, error: 'Method Not Allowed' });
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err?.message || String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`[WFM] static + API server listening on http://localhost:${PORT}`);
  console.log(`[WFM] health: http://localhost:${PORT}/api/health`);
  console.log(`[WFM] service-check: POST http://localhost:${PORT}/api/service-check`);
  console.log(`[WFM] chaping-check: POST http://localhost:${PORT}/api/chaping-check`);
});
