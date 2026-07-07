// netlify/functions/doctor.js
// ─────────────────────────────────────────────────────────────
// SAR — ডাক্তার পোর্টাল (doctor.html)-এর জন্য ডেডিকেটেড, সম্পূর্ণ আলাদা AI ফাংশন।
//
// কেন আলাদা ফাইল: analyze.js dashboard/daily-report/queue-worker ইত্যাদি অনেক
// পেজ শেয়ার করে — তাই সেখানে মডেল/টাইমিং পরিবর্তন করলে অন্য জায়গায় প্রভাব
// পড়ার ঝুঁকি থাকে। এই ফাইলটা শুধুমাত্র doctor.html কল করে, তাই এখানে
// স্বাধীনভাবে দ্রুত মডেল ব্যবহার করা যায় — Netlify-এর synchronous function
// timeout (free/Personal প্ল্যানে ১০ সেকেন্ড, Pro-তে ২৬ সেকেন্ড) এড়াতে।
//
// claude-haiku-4-5 বেছে নেওয়া হয়েছে কারণ এটা claude-sonnet-4-6-এর তুলনায়
// উল্লেখযোগ্যভাবে দ্রুত উত্তর দেয় (সাধারণত ২-৫ সেকেন্ডে, এই আকারের prompt/
// output-এ) — তাই ১০ সেকেন্ড সীমার ভেতরেও নির্ভরযোগ্যভাবে শেষ হওয়ার কথা।
//
// Netlify env vars (analyze.js/sar.js-এর সাথে শেয়ার্ড — নতুন কিছু বসাতে হবে না):
//   CLAUDE_API_KEY  বা  CLAUDE_KEY  বা  ANTHROPIC_API_KEY   (যেকোনো একটা)
//
// ব্যবহার (POST JSON):
//   { "prompt": "..." }  →  { "text": "...", "parsed": {...} | null }
//
// দ্রুত পরীক্ষা: ব্রাউজারে এই function-এর URL খুললে (GET) status দেখাবে।
// ─────────────────────────────────────────────────────────────

const CLAUDE_KEY =
  process.env.CLAUDE_API_KEY ||
  process.env.CLAUDE_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  '';

const MODEL = 'claude-haiku-4-5';   // দ্রুত মডেল — doctor.html-এর sync timeout এড়ানোর জন্য বেছে নেওয়া
const MAX_TOKENS = 3000;   // ৫টা বিস্তারিত rx আইটেম + ৮টা আরও ফিল্ড (দু'আ সহ) সম্পূর্ণ করতে যথেষ্ট বাজেট —
                            // ১৫০০ টোকেনে rx-এর পরের ফিল্ডগুলো (general/home/ayurvedic/unani/homeopathic/
                            // islamic/dangers/alerts) generate হওয়ার আগেই বাজেট শেষ হয়ে যাচ্ছিল

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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});

  // ── GET: দ্রুত status check (ব্রাউজারে URL খুললেই দেখা যাবে) ──
  if (event.httpMethod === 'GET') {
    return reply(200, {
      ok: true,
      function: 'doctor (doctor.html-এর জন্য ডেডিকেটেড, fast-model AI — analyze.js থেকে সম্পূর্ণ আলাদা)',
      model: MODEL,
      claude_key: CLAUDE_KEY ? 'set' : 'MISSING',
      note: 'POST { prompt } দিয়ে কল করুন। শুধু doctor.html এই function ব্যবহার করে — অন্য কোনো পেজ এর উপর নির্ভর করে না।',
    });
  }

  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  if (!CLAUDE_KEY) {
    return reply(200, { text: '', parsed: null, error: 'CLAUDE_API_KEY (বা CLAUDE_KEY/ANTHROPIC_API_KEY) missing — Netlify env-এ বসান' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Bad JSON' }); }

  const prompt = (body.prompt || '').trim();
  if (!prompt) return reply(400, { error: 'no prompt' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return reply(200, {
        text: '', parsed: null,
        error: `Claude API ${r.status}`,
        detail: detail.slice(0, 500),
      });
    }

    const data = await r.json();
    const raw = Array.isArray(data.content)
      ? data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      : '';

    // সার্ভার-সাইডেই একটা basic JSON parse চেষ্টা — সফল হলে client-এর
    // robustParseAI()-এর জন্য অপেক্ষা করতে হয় না, ব্যর্থ হলে client নিজেই সামলাবে
    let parsed = null;
    try {
      let clean = raw.replace(/```json|```/g, '').trim();
      const a = clean.indexOf('{');
      const b = clean.lastIndexOf('}');
      if (a > -1 && b > a) parsed = JSON.parse(clean.slice(a, b + 1));
    } catch (e) { /* client-side robustParseAI() fallback থাকবে */ }

    return reply(200, { text: raw, parsed });
  } catch (e) {
    return reply(200, { text: '', parsed: null, error: String((e && e.message) || e) });
  }
};
