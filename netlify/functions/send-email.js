// netlify/functions/send-email.js
// ─────────────────────────────────────────────────────────────
// Resend দিয়ে ইমেইল পাঠায়।
//
// Netlify env variable (যেকোনো একটা নামে থাকলেই চলবে):
//   RESEND_KEY  বা  RESEND_API_KEY
//
// ঐচ্ছিক:
//   RESEND_FROM  — পাঠানোর ঠিকানা।
//                  domain verify হওয়ার আগে এখানে 'SAR <onboarding@resend.dev>'
//                  বসিয়ে test করতে পারেন। না দিলে নিচের default ব্যবহার হবে।
//
// ব্যবহার (POST JSON):
//   { "to": "customer@email.com", "subject": "...", "html": "<p>...</p>" }
//   text চাইলে: { "to": "...", "subject": "...", "html": "...", "text": "..." }
//
// দ্রুত পরীক্ষা: ব্রাউজারে এই function-এর URL খুললে (GET) status দেখাবে।
// ─────────────────────────────────────────────────────────────

const RESEND_KEY =
  process.env.RESEND_KEY ||
  process.env.RESEND_API_KEY ||
  '';

// domain verify হয়ে গেলে এই ঠিকানা দিয়েই যাবে।
// verify হওয়ার আগে Netlify env-এ RESEND_FROM = 'SAR <onboarding@resend.dev>' বসিয়ে test করুন।
const FROM =
  process.env.RESEND_FROM ||
  'SAR <noreply@sheairestaurant.com>';

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

// HTML থেকে মোটামুটি একটা plain-text বানায় (deliverability ভালো হয়)
function htmlToText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/(div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')   // বাকি সব tag ফেলে দাও
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});

  // ── GET: দ্রুত status check (ব্রাউজারে খুললেই দেখা যাবে) ──
  if (event.httpMethod === 'GET') {
    return reply(200, {
      ok: true,
      function: 'send-email',
      resend_key: RESEND_KEY ? 'set' : 'MISSING',
      from: FROM,
      note: 'POST করুন { to, subject, html } দিয়ে ইমেইল পাঠাতে।',
    });
  }

  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  if (!RESEND_KEY) {
    return reply(500, { error: 'Resend key missing — Netlify env-এ RESEND_KEY বসান' });
  }

  let p;
  try { p = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Bad JSON' }); }

  const to      = p.to;
  const subject = p.subject || 'SAR বার্তা';
  const html    = p.html || p.text || '';
  // text না দিলে html থেকে বানিয়ে নাও
  const text    = p.text || (html ? htmlToText(html) : '');

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
        text,
      }),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return reply(r.status, { sent: false, error: 'Resend error', detail: data });
    }
    return reply(200, { sent: true, id: data.id || null });

  } catch (e) {
    return reply(500, { sent: false, error: String((e && e.message) || e) });
  }
};
