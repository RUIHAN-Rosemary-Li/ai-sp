// api/generate.js —— Vercel Serverless Function
// 前端只请求同源的 /api/generate，真正的 API Key 只存在于 Vercel 环境变量中。
//
// 需要配置的环境变量（Vercel → Project Settings → Environment Variables）：
//   API_KEY   必填，模型服务商的密钥（也兼容 DEEPSEEK_API_KEY）
//   API_BASE  可选，默认 https://api.deepseek.com
//   MODEL     可选，默认 deepseek-chat

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

function fail(res, status, message) {
  return res.status(status).json({ error: { message: String(message) } });
}

// 前端历史上把模型写成 "deepseek/deepseek-flash" 这种带厂商前缀的形式，
// 官方 API 只认 "deepseek-chat" / "deepseek-flash" 这类纯模型名，这里做一次兼容。
function normalizeModel(requested) {
  if (typeof requested === 'string') {
    const m = requested.trim();
    if (m && !m.includes('/')) return m;
  }
  return process.env.MODEL || DEFAULT_MODEL;
}

function buildEndpoint(base) {
  const b = String(base || DEFAULT_BASE).trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(b)) return b;
  if (/\/v1$/.test(b)) return b + '/chat/completions';
  return b + '/v1/chat/completions';
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch (e) { return {}; }
  }
  return body;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Method not allowed');
  }

  // 兼容两种常见变量名，避免又变成 "Bearer undefined"
  const API_KEY = process.env.API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) {
    return fail(res, 500,
      '服务器没有配置 API_KEY 环境变量。请在 Vercel 项目 Settings → Environment Variables 中添加 API_KEY，然后 Redeploy。');
  }

  const body = parseBody(req.body);
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return fail(res, 400, '请求缺少 messages 数组');
  }

  const endpoint = buildEndpoint(process.env.API_BASE);
  const payload = {
    model: normalizeModel(body.model),
    messages: messages,
    stream: false
  };
  if (typeof body.temperature === 'number') payload.temperature = body.temperature;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return fail(res, 502, '模型服务返回了非 JSON 内容（HTTP ' + resp.status + '）：' + text.slice(0, 200));
    }

    if (!resp.ok) {
      const msg = (data && data.error && (data.error.message || data.error)) || ('模型服务返回 HTTP ' + resp.status);
      return res.status(resp.status).json({ error: { message: String(msg) } });
    }

    return res.status(200).json(data);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return fail(res, 504, '模型响应超时（55 秒），请重试。');
    }
    return fail(res, 502, '无法连接模型服务：' + (err && err.message ? err.message : String(err)));
  } finally {
    clearTimeout(timer);
  }
}

// 生成整份病例可能超过默认执行时间，显式放宽到 60 秒（Hobby 计划上限）
export const config = { maxDuration: 60 };