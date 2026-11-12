// api/transcribe.js —— 语音转文字（OpenAI 兼容 /audio/transcriptions）
// 前端把录音（16k 单声道 WAV）POST 到这里，这里转发给国内语音识别服务。
//
// 需要配置的环境变量（Vercel → Settings → Environment Variables）：
//   ASR_KEY   必填，硅基流动 API Key（也兼容 SILICONFLOW_API_KEY）
//   ASR_BASE  可选，默认 https://api.siliconflow.cn/v1
//   ASR_MODEL 可选，默认 FunAudioLLM/SenseVoiceSmall

export const config = { maxDuration: 60 };

const DEFAULT_BASE = 'https://api.siliconflow.cn/v1';
const DEFAULT_MODEL = 'FunAudioLLM/SenseVoiceSmall';

function fail(res, status, message) {
  return res.status(status).json({ error: { message: String(message) } });
}

export default async function handler(req, res) {
  const KEY = process.env.ASR_KEY || process.env.SILICONFLOW_API_KEY || process.env.OPENAI_API_KEY;

  // 前端启动时用它判断走云端识别还是浏览器识别
  if (req.method === 'GET') {
    return res.status(200).json({ configured: !!KEY, model: process.env.ASR_MODEL || DEFAULT_MODEL });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return fail(res, 405, 'Method not allowed');
  }
  if (!KEY) {
    return fail(res, 500, '服务器没有配置 ASR_KEY（语音识别密钥）。请在 Vercel 添加 ASR_KEY，然后 Redeploy。');
  }

  let buf;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    buf = Buffer.concat(chunks);
  } catch (e) {
    return fail(res, 400, '读取音频失败：' + (e.message || e));
  }
  if (!buf || !buf.length) return fail(res, 400, '没有收到音频数据');
  if (buf.length > 4 * 1024 * 1024) return fail(res, 413, '录音太大，请把答案说得短一点');

  const type = String(req.headers['content-type'] || 'audio/wav').split(';')[0].trim() || 'audio/wav';
  const ext = /mp4|m4a/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : /mpeg|mp3/.test(type) ? 'mp3' : 'wav';

  const base = (process.env.ASR_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const endpoint = /\/audio\/transcriptions$/.test(base) ? base : base + '/audio/transcriptions';

  const form = new FormData();
  form.append('file', new Blob([buf], { type }), 'answer.' + ext);
  form.append('model', process.env.ASR_MODEL || DEFAULT_MODEL);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY },
      body: form,
      signal: controller.signal
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return fail(res, 502, '语音服务返回了非 JSON 内容（HTTP ' + r.status + '）：' + text.slice(0, 160));
    }
    if (!r.ok) {
      const msg = (data && data.error && (data.error.message || data.error)) || ('语音服务返回 HTTP ' + r.status);
      return fail(res, r.status >= 400 && r.status < 600 ? r.status : 502, msg);
    }
    const out = typeof data === 'string' ? data : (data.text || (data.result && data.result.text) || '');
    return res.status(200).json({ text: String(out).trim() });
  } catch (err) {
    if (err && err.name === 'AbortError') return fail(res, 504, '语音识别超时，请说短一点再试');
    return fail(res, 502, '无法连接语音服务：' + (err && err.message ? err.message : String(err)));
  } finally {
    clearTimeout(timer);
  }
}