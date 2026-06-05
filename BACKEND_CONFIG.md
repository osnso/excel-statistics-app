# WFM 数据分析助手：后端接口配置说明

> 目的：解决 GitHub Pages / 纯静态网页无法直接调用公司大模型或 tripBuddy Skills 的问题。前端只负责上传、展示和导出；LLM 质检打分统一通过后端接口完成。

## 1. 已新增的后端能力

本仓库新增 `server.js`，包含：

| 接口 | 方法 | 作用 |
|---|---|---|
| `/` | GET | 托管当前静态网页 |
| `/api/health` | GET | 健康检查，返回模型配置状态 |
| `/api/service-check` | POST | 调用后端 LLM 完成 service-check 有效共情质检 |

前端「专项分析 → 成本/用量运营 → 后端接口」新增配置项：

- 接口地址：可以留空，默认调用同源相对路径 `/api/service-check`，避免在浏览器或 `fetch_api` 环境中误连 `localhost` / `127.0.0.1`；仅前后端分离部署时填写完整地址。
  - 可填写完整接口地址，例如 `https://your-domain/api/service-check`；
  - 也可填写后端服务 origin，例如 `https://your-domain`，前端会自动拼成 `https://your-domain/api/service-check`；
  - 如填写 `/api/service-check`，保持使用同源相对路径。
- 访问 Token：可选；如果后端设置了 `WFM_BACKEND_TOKEN`，这里填写对应值。
- 测试连接：默认请求同源相对路径 `/api/health`；如果填写了后端服务 origin，则自动拼成 `{origin}/api/health`。

前端调用优先级：

1. 如果未填写接口地址，默认调用同源相对路径 `/api/service-check`；
2. 如果配置了自定义后端地址或后端服务 origin，则归一化后调用 `/api/service-check`；
3. 如果浏览器 `localStorage` 中存在旧值 `http://localhost:8787/api/service-check` 或 `http://127.0.0.1:8787/api/service-check`，前端会自动迁移为 `/api/service-check`；
4. 不再建议在浏览器里保存公司模型 Token。

## 2. 本地启动

Windows PowerShell 示例：

```powershell
cd D:\Users\baojiawang\ctrip-claw\workspace\2026-06-04-task-3\repo
$env:PORT="8787"
$env:WFM_BACKEND_TOKEN="your-backend-token"   # 可选
$env:WFM_LLM_PROVIDER="openai"                # openai 或 anthropic
$env:WFM_LLM_BASE_URL="https://your-llm-gateway/v1"
$env:WFM_LLM_API_KEY="your-api-key"
$env:WFM_LLM_MODEL="your-model-name"
node server.js
```

打开：

```text
http://localhost:8787/
```

网页后端接口可以留空，默认会请求同源：

```text
/api/service-check
```

如果前端页面没有由 `server.js` 同源托管，才填写完整后端服务 origin 或完整接口地址，例如：

```text
https://your-domain
https://your-domain/api/service-check
```

如果配置了 `WFM_BACKEND_TOKEN`，网页里的「访问 Token」填写同一个值。

## 3. OpenAI 兼容模型配置

适用于大多数公司模型网关 / OpenAI 兼容接口：

```powershell
$env:WFM_LLM_PROVIDER="openai"
$env:WFM_LLM_BASE_URL="https://your-llm-gateway/v1"
$env:WFM_LLM_API_KEY="your-api-key"
$env:WFM_LLM_MODEL="your-model-name"
node server.js
```

后端会请求：

```text
POST {WFM_LLM_BASE_URL}/chat/completions
```

如果 `WFM_LLM_BASE_URL` 没有以 `/v1` 结尾，后端会自动拼成 `/v1/chat/completions`。

## 4. Anthropic 配置

```powershell
$env:WFM_LLM_PROVIDER="anthropic"
$env:WFM_LLM_BASE_URL="https://api.anthropic.com"
$env:WFM_LLM_API_KEY="your-api-key"
$env:WFM_LLM_MODEL="claude-sonnet-4-6"
node server.js
```

后端会请求：

```text
POST {WFM_LLM_BASE_URL}/v1/messages
```

## 5. service-check 请求格式

```http
POST /api/service-check
Content-Type: application/json
Authorization: Bearer <可选后端Token>
```

```json
{
  "scene": "service-check",
  "conversation": "客服与客人的完整对话文本",
  "options": {
    "output": "json",
    "needDocSummary": true
  }
}
```

## 6. service-check 返回格式

```json
{
  "success": true,
  "result": {
    "stage": "阶段二",
    "confidence": 86,
    "points": [1, 4],
    "reason": "客服有安抚动作，但未充分回应客户具体情绪。",
    "evidence": "客户表示很着急，客服仅回复稍等。",
    "suggestion": "建议先承接情绪，再说明处理动作和预计反馈时间。",
    "docSummary": "本次服务质检为阶段二，有共情动作但不够具体。",
    "source": "backend-llm"
  },
  "rawModelOutput": {}
}
```

## 7. 健康检查

```text
GET /api/health
```

返回示例：

```json
{
  "success": true,
  "service": "wfm-service-check-backend",
  "provider": "openai",
  "model": "your-model-name",
  "llmConfigured": true
}
```

## 8. 部署说明

GitHub Pages 只能托管静态文件，**不会运行 `server.js`**。要让后端接口生效，需要把 `repo` 部署到支持 Node.js 的环境，例如：

- 公司内部 Node 服务平台；
- 内网机器 + Nginx 反向代理；
- 云服务器；
- Serverless / 容器平台。

部署完成后，如果前端和后端同源，网页「后端接口」可留空并默认使用 `/api/service-check`；如果前后端分离，再把对外可访问的完整接口地址填入网页「后端接口」。

## 9. 安全建议

1. 模型 API Key 只放在后端环境变量，不要放前端；
2. 如接口暴露给多人使用，建议设置 `WFM_BACKEND_TOKEN`；
3. 如果部署在公司内网，优先接入公司统一鉴权或网关；
4. 日志中不要打印完整客服对话和模型密钥。
