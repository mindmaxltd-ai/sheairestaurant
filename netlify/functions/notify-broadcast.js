// netlify/functions/notify-broadcast.js
// ─────────────────────────────────────────────────────────────
// একটা গ্রুপের সব গ্রাহককে SMS পাঠায়।
// admin.html থেকে { target, msg } পায়, Supabase থেকে ঐ গ্রুপের
// phone নম্বর বের করে, প্রত্যেককে send-sms function দিয়ে পাঠায়।
//
// Netlify env (যেকোনো নামে থাকলেই চলবে — function নিজে খুঁজে নেয়):
//   SUPABASE_URL                         (আবশ্যক)
//   SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY /
//   SUPABASE_KEY / SUPABASE_ANON_KEY     (যেকোনো একটা)
//   SMS_API_KEY                          (send-sms.js ব্যবহার করে)
//
// target মান:
//   'active'  → account_status = 'active'  (সব সক্রিয়)
//   'expired' → account_status = 'expired' (মেয়াদোত্তীর্ণ)
//   'DM','OB','FL','IB','PR' → sar_category = ঐ কোড (শুধু সক্রিয়)
//
// ব্যবহার (POST JSON):
//   { "target": "DM", "msg": "আপনার বার্তা" }
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';
const SMS_API_KEY = process.env.SMS_API_KEY || '';

// এই site-এর নিজের send-sms function-এর full URL বানাতে কাজে লাগে
const SITE_URL =
  process.env.URL ||
  process.env.DEPLOY_PRIME_URL ||
  'https://sheairestaurant.com';

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

const DISEASE_CATS = ['DM', 'OB', 'FL', 'IB', 'PR'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});

  // ── GET: দ্রুত status check ──
  if (event.httpMethod === 'GET') {
    return reply(200, {
      ok: true,
      function: 'notify-broadcast',
      supabase_url: SUPABASE_URL ? 'set' : 'MISSING',
      supabase_key: SUPABASE_KEY ? 'set' : 'MISSING',
      sms_api_key: SMS_API_KEY ? 'set' : 'MISSING',
      note: 'POST করুন { target, msg } দিয়ে গ্রুপে SMS পাঠাতে।',
    });
  }

  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return reply(500, { error: 'Supabase config missing — Netlify env-এ SUPABASE_URL ও service key বসান' });
  }
  if (!SMS_API_KEY) {
    return reply(500, { error: 'SMS_API_KEY missing — Netlify env-এ বসান' });
  }

  let p;
  try { p = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Bad JSON' }); }

  const target = String(p.target || '').trim();
  const msg    = (p.msg || p.text || '').trim();

  if (!target) return reply(400, { error: 'no target group' });
  if (!msg)    return reply(400, { error: 'no message (msg)' });

  // ── target → Supabase filter বানাও ──
  let filter = '';
  if (target === 'active') {
    filter = `account_status=eq.active`;
  } else if (target === 'expired') {
    filter = `account_status=eq.expired`;
  } else if (DISEASE_CATS.includes(target)) {
    // disease group — শুধু সক্রিয় গ্রাহকদের পাঠাই
    filter = `sar_category=eq.${target}&account_status=eq.active`;
  } else {
    return reply(400, { error: 'unknown target: ' + target });
  }

  // ── Supabase থেকে phone + নাম আনো ──
  let customers;
  try {
    const url = `${SUPABASE_URL}/rest/v1/customers?select=full_name,phone&${filter}`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
      },
    });
    customers = await r.json();
    if (!r.ok) {
      return reply(r.status, { error: 'Supabase query failed', detail: customers });
    }
  } catch (e) {
    return reply(500, { error: 'Supabase fetch error: ' + String((e && e.message) || e) });
  }

  if (!Array.isArray(customers) || customers.length === 0) {
    return reply(200, { sent: 0, total: 0, note: 'এই গ্রুপে কোনো গ্রাহক পাওয়া যায়নি' });
  }

  // ── প্রত্যেককে send-sms দিয়ে পাঠাও ──
  const smsUrl = `${SITE_URL}/.netlify/functions/send-sms`;
  let sent = 0, failed = 0;
  const failures = [];

  for (const c of customers) {
    const phone = c.phone;
    if (!phone) { failed++; failures.push({ name: c.full_name, reason: 'no phone' }); continue; }

    try {
      const r = await fetch(smsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, msg }),
      });
      const d = await r.json().catch(() => ({}));
      if (d && d.sent) sent++;
      else { failed++; failures.push({ name: c.full_name, reason: (d && d.error) || 'sms failed' }); }
    } catch (e) {
      failed++;
      failures.push({ name: c.full_name, reason: String((e && e.message) || e) });
    }
  }

  return reply(200, {
    target,
    total: customers.length,
    sent,
    failed,
    failures: failures.slice(0, 20), // প্রথম ২০টা সমস্যা দেখাই
  });
};
