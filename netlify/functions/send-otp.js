// netlify/functions/send-otp.js
// ─────────────────────────────────────────────────────────────
// OTP পাঠায় ও যাচাই করে। কোড Supabase-এর otp_codes টেবিলে থাকে।
//
// Netlify env:
//   SUPABASE_URL                         (আবশ্যক)
//   SUPABASE_SERVICE_KEY / ..._ROLE_KEY / SUPABASE_KEY  (যেকোনো একটা)
//   SMS_API_KEY                          (send-sms.js ব্যবহার করে)
//
// ব্যবহার (POST JSON):
//   পাঠাতে:   { "action":"send",   "phone":"01XXXXXXXXX" }
//   যাচাই:    { "action":"verify", "phone":"01XXXXXXXXX", "code":"123456" }
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';
const SMS_API_KEY = process.env.SMS_API_KEY || '';

const SITE_URL =
  process.env.URL ||
  process.env.DEPLOY_PRIME_URL ||
  'https://sheairestaurant.com';

const OTP_TTL_MIN = 5;       // কোড কত মিনিট বৈধ
const MAX_ATTEMPTS = 5;      // সর্বোচ্চ ভুল চেষ্টা

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

// নম্বর 8801XXXXXXXXX ফরম্যাটে আনে
function normPhone(raw) {
  let n = String(raw).replace(/[^0-9]/g, '');
  if (n.startsWith('880')) return n;
  if (n.startsWith('0'))   return '88' + n;
  if (n.startsWith('1'))   return '880' + n;
  return n;
}

// Supabase helper
async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});

  if (event.httpMethod === 'GET') {
    return reply(200, {
      ok: true,
      function: 'send-otp',
      supabase_url: SUPABASE_URL ? 'set' : 'MISSING',
      supabase_key: SUPABASE_KEY ? 'set' : 'MISSING',
      sms_api_key: SMS_API_KEY ? 'set' : 'MISSING',
      note: 'POST { action:"send"|"verify", phone, code? }',
    });
  }

  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return reply(500, { error: 'Supabase config missing' });
  }

  let p;
  try { p = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Bad JSON' }); }

  const action = String(p.action || '').trim();
  const phone  = normPhone(p.phone || '');
  if (!phone) return reply(400, { error: 'no phone' });

  // ─────────── SEND ───────────
  if (action === 'send') {
    if (!SMS_API_KEY) return reply(500, { error: 'SMS_API_KEY missing' });

    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
    const expires = new Date(Date.now() + OTP_TTL_MIN * 60000).toISOString();

    // আগের পুরোনো কোড মুছে দাও (একই নম্বরের)
    await sb(`otp_codes?phone=eq.${phone}`, { method: 'DELETE' });

    // নতুন কোড রাখো
    const ins = await sb('otp_codes', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ phone, code, expires_at: expires, verified: false, attempts: 0 }),
    });
    if (!ins.ok) {
      return reply(500, { error: 'could not store OTP', detail: ins.data });
    }

    // SMS পাঠাও (brand নাম সহ — sms.net.bd নিয়ম)
    const msg = `SAR যাচাই কোড: ${code} । ${OTP_TTL_MIN} মিনিট বৈধ। কাউকে শেয়ার করবেন না।`;
    try {
      const r = await fetch(`${SITE_URL}/.netlify/functions/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, msg }),
      });
      const d = await r.json().catch(() => ({}));
      if (d && d.sent) {
        return reply(200, { sent: true, phone, expires_in_min: OTP_TTL_MIN });
      }
      return reply(200, { sent: false, error: 'SMS failed', detail: d });
    } catch (e) {
      return reply(500, { sent: false, error: String((e && e.message) || e) });
    }
  }

  // ─────────── VERIFY ───────────
  if (action === 'verify') {
    const code = String(p.code || '').trim();
    if (!code) return reply(400, { error: 'no code' });

    // সর্বশেষ কোড আনো
    const q = await sb(`otp_codes?phone=eq.${phone}&order=created_at.desc&limit=1`);
    if (!q.ok || !Array.isArray(q.data) || q.data.length === 0) {
      return reply(200, { verified: false, error: 'কোনো কোড পাওয়া যায়নি — আবার পাঠান' });
    }
    const row = q.data[0];

    if (row.verified) {
      return reply(200, { verified: true, note: 'already verified' });
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      return reply(200, { verified: false, error: 'অনেকবার ভুল হয়েছে — নতুন কোড নিন' });
    }
    if (new Date(row.expires_at) < new Date()) {
      return reply(200, { verified: false, error: 'কোডের মেয়াদ শেষ — আবার পাঠান' });
    }

    if (row.code === code) {
      await sb(`otp_codes?id=eq.${row.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ verified: true }),
      });
      return reply(200, { verified: true });
    } else {
      await sb(`otp_codes?id=eq.${row.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ attempts: (row.attempts || 0) + 1 }),
      });
      const left = MAX_ATTEMPTS - (row.attempts + 1);
      return reply(200, { verified: false, error: `কোড ভুল — আর ${left} বার চেষ্টা করতে পারবেন` });
    }
  }

  return reply(400, { error: 'unknown action (send/verify)' });
};
