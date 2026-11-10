// api/generate.js
export default async function handler(req, res) {
  // 只允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // API Key 从环境变量读，前端永远看不到
  const API_KEY = process.env.API_KEY;
  const API_BASE = process.env.API_BASE || 'https://api.deepseek.com';

  try {
    const response = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: req.body.model || 'deepseek-chat',
        messages: req.body.messages,
        temperature: 0.7
      })
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
