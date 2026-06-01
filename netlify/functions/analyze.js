exports.handler = async (event) => {
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:h, body:'' };
  try {
    const { prompt } = JSON.parse(event.body || '{}');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const d = await r.json();
    return { statusCode:200, headers:h, body: JSON.stringify({ text: d.content?.[0]?.text || '' }) };
  } catch(e) {
    return { statusCode:500, headers:h, body: JSON.stringify({ error: e.message }) };
  }
};
