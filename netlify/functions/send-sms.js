// netlify/functions/send-sms.js
// ─────────────────────────────────────────────────────────────
// sms.net.bd (Alpha SMS) দিয়ে SMS পাঠায়।
//
// Netlify env variable:
//   SMS_API_KEY   — sms.net.bd panel → API page থেকে নেওয়া key (আবশ্যক)
//
// ঐচ্ছিক:
//   SMS_SENDER_ID — masking name (যেমন 'SAR'/'MindMax')।
//                   approve হওয়ার আগে খালি রাখুন; তখন default sender যাবে।
//
// ব্যবহার (POST JSON):
//   { "to": "8801XXXXXXXXX", "msg": "আপনার বার্তা" }
//   একাধিক নম্বর: { "to": "8801...,8801...", "msg": "..." }
//
// দ্রুত পরীক্ষা: ব্রাউজারে এই function-এর URL খুললে (GET) status দেখাবে।
// ─────────────────────────────────────────────────────────────

const SMS_API_KEY   = process.env.SMS_API_KEY || '';
const SMS_SENDER_ID = process.env.SMS_SENDER_ID || '';   // masking approve হলে বসান

const ENDPOINT = 'https://api.sms.net.bd/sendsms';

const reply = (status, body) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  },
  body: JSON.stringify(body),
});

// বাংলাদেশি নম্বর পরিষ্কার করে 8801XXXXXXXXX ফরম্যাটে আনে
// 01712345678 → 8801712345678 ; +8801712... → 8801712... ; একাধিক হলে comma-যুক্ত
function normalizeNumbers(raw) {
  return String(raw)
    .split(',')
    .map(n => n.trim())
    .filter(Boolean)
    .map(n => {
      n = n.replace(/[^0-9]/g, '');        // +, space, dash বাদ
      if (n.startsWith('880')) return n;   // already 880...
      if (n.startsWith('0'))   return '88' + n;   // 017... → 88017...
      if (n.startsWith('1'))   return '880' + n;  // 17...  → 88017...
      return n;
    })
    .join(',');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});

  // ── GET: দ্রুত status check ──
  if (event.httpMethod === 'GET') {
    return reply(200, {
      ok: true,
      function: 'send-sms',
      provider: 'sms.net.bd',
      sms_api_key: SMS_API_KEY ? 'set' : 'MISSING',
      sender_id: SMS_SENDER_ID || '(none — default sender)',
      note: 'POST করুন { to, msg } দিয়ে SMS পাঠাতে।',
    });
  }

  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  if (!SMS_API_KEY) {
    return reply(500, { error: 'SMS key missing — Netlify env-এ SMS_API_KEY বসান' });
  }

  let p;
  try { p = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Bad JSON' }); }

  const to  = normalizeNumbers(p.to || '');
  const msg = p.msg || p.text || '';

  if (!to)  return reply(400, { error: 'no recipient (to)' });
  if (!msg) return reply(400, { error: 'no message (msg)' });

  // sms.net.bd form-encoded body চায়
  const form = new URLSearchParams();
  form.append('api_key', SMS_API_KEY);
  form.append('msg', msg);
  form.append('to', to);
  if (SMS_SENDER_ID) form.append('sender_id', SMS_SENDER_ID);

  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    const data = await r.json().catch(() => ({}));

    // sms.net.bd সফল হলে error:0 ফেরত দেয়
    if (data && data.error === 0) {
      return reply(200, {
        sent: true,
        request_id: (data.data && data.data.request_id) || null,
        provider_msg: data.msg || 'ok',
      });
    }

    // error != 0 → ব্যর্থ (key ভুল, balance শেষ, নম্বর ভুল ইত্যাদি)
    return reply(200, {
      sent: false,
      error: (data && data.msg) || 'SMS failed',
      detail: data,
    });

  } catch (e) {
    return reply(500, { sent: false, error: String((e && e.message) || e) });
  }
};
