// netlify/functions/send-email.js
// ─────────────────────────────────────────────────────────────
// Resend দিয়ে ইমেইল পাঠায়।
// Netlify env variable (যেকোনো একটা নামে থাকলেই চলবে):
//   RESEND_KEY  বা  RESEND_API_KEY
// ঐচ্ছিক: RESEND_FROM (পাঠানোর ঠিকানা; না দিলে ডিফল্ট ব্যবহার হয়)
//
// ব্যবহার (POST JSON):
//   { "to": "customer@email.com", "subject": "...", "html": "<p>...</p>" }
// ─────────────────────────────────────────────────────────────

const RESEND_KEY =
  process.env.RESEND_KEY ||
  process.env.RESEND_API_KEY ||
  '';

// আপনার যাচাইকৃত ডোমেইন থাকলে এখানে বসান, যেমন 'SAR <noreply@sheairestaurant.com>'
// ডোমেইন যাচাই না করা থাকলে Resend-এর টেস্ট ঠিকানা ব্যবহার করুন।
const FROM =
  process.env.RESEND_FROM ||
  'SAR <onboarding@resend.dev>';

const reply = (status, body) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST')    return reply(405, { error: 'POST only' });

  if (!RESEND_KEY) {
    return reply(500, { error: 'Resend key missing — set RESEND_KEY in Netlify env' });
  }

  let p;
  try { p = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Bad JSON' }); }

  const to      = p.to;
  const subject = p.subject || 'SAR বার্তা';
  const html    = p.html || p.text || '';

  if (!to)   return reply(400, { error: 'no recipient (to)' });
  if (!html) return reply(400, { error: 'no content (html)' });

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return reply(r.status, { sent: false, error: 'Resend error', detail: data });
    }
    return reply(200, { sent: true, id: data.id || null });

  } catch (e) {
    return reply(500, { sent: false, error: String(e && e.message || e) });
  }
};
