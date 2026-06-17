// netlify/functions/angeli.js
// ─────────────────────────────────────────────────────────────
// ANGELI — SAR-এর কথা-বলা চ্যাটবট (verbal + written, ৪ ভাষা)
//
// কাজ: কাস্টমারের প্রশ্ন নেয় → knowledge_base থেকে প্রাসঙ্গিক
//      তথ্য খোঁজে → Claude দিয়ে উত্তর বানায় → কথোপকথন সেভ করে।
//
// Netlify → Site settings → Environment variables (sar.js-এর মতোই):
//   SUPABASE_URL          https://xlkrggspepnysbouatec.supabase.co
//   SUPABASE_SERVICE_KEY  service_role key (SECRET, server-only)
//   CLAUDE_API_KEY        Anthropic key
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xlkrggspepnysbouatec.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_API_KEY || '';

const SB = {
  apikey: SERVICE_KEY,
  Authorization: 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json',
};

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

// ── Angeli-র চরিত্র (system prompt) ────────────────────────────
const ANGELI_PERSONA = `
You are Angeli, a warm, friendly little girl who is the assistant for SAR
(She AI Revolution) — a women-led food and nutrition movement, only for women.
SAR food is oil-free, sugar-free, salt-free (uses pink salt), milk-free,
artificial-colour-free, ayurvedic and organic. Recipes and menus are prepared
using AI and 250 health metrics of women.

Rules:
- Reply ONLY in the language the customer used (Bengali, English, Hindi, or Arabic).
- Be friendly, short, and clear — like a kind little girl talking.
- The CONTEXT below contains real SAR information (prices, menu, registration,
  contact, etc.). READ IT CAREFULLY and answer from it. The information may use
  different words than the customer's question (e.g. customer says "দাম", context
  says "মূল্য") — match the meaning, not just the exact word.
- Only if the answer is truly not in the CONTEXT, gently say you are not sure and
  suggest contacting SAR (WhatsApp 01346098892). Never invent facts.
- You are NOT a doctor. For medical questions, advise seeing a professional.
- SAR is in Bangladesh, a Muslim-majority country. Greet customers with
  "আসসালামু আলাইকুম" (Assalamu Alaikum) in Bengali, never "নমস্কার". In other
  languages use a warm, culturally appropriate greeting.
`.trim();

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST')    return reply(405, { error: 'POST only' });
  if (!SERVICE_KEY) return reply(500, { error: 'Missing SUPABASE_SERVICE_KEY env var' });

  let p;
  try { p = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Bad JSON' }); }

  try {
    switch (p.action) {

      // ── 1. CHAT: কাস্টমারের একটি বার্তার উত্তর দাও ──────────
      case 'chat': {
        const question  = (p.message || '').trim();
        const lang      = p.lang || 'bn';
        const inputType = p.input_type || 'written';
        let   convId    = p.conversation_id || null;
        const history   = Array.isArray(p.history) ? p.history.slice(-6) : [];

        if (!question) return reply(400, { error: 'empty message' });

        // (ক) নতুন কথোপকথন হলে একটা সারি বানাও
        if (!convId) {
          const cr = await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations`, {
            method: 'POST',
            headers: { ...SB, Prefer: 'return=representation' },
            body: JSON.stringify({ customer_id: p.customer_id || null, lang }),
          });
          const cd = await cr.json();
          convId = Array.isArray(cd) && cd[0] ? cd[0].id : null;
        }

        // (খ) knowledge_base থেকে প্রাসঙ্গিক টুকরো খোঁজো
        //     full-text search; না পেলে সাধারণ ম্যাচ
        const context = await searchKnowledge(question);

        // (গ) কাস্টমারের বার্তা সেভ করো
        await saveMessage(convId, 'user', question, lang, inputType);

        // (ঘ) Claude দিয়ে উত্তর বানাও
        const answer = await askClaude(question, context, history, lang);

        // (ঙ) Angeli-র উত্তর সেভ করো
        await saveMessage(convId, 'angeli', answer, lang, 'written');

        return reply(200, { answer, conversation_id: convId });
      }

      // ── 2. ADD_KNOWLEDGE: knowledge_base-এ টুকরো যোগ করো ────
      //     (আপলোড পেজ এই action ব্যবহার করবে)
      case 'add_knowledge': {
        const chunks = Array.isArray(p.chunks) ? p.chunks : [];
        if (!chunks.length) return reply(400, { error: 'no chunks' });

        const rows = chunks.map(c => ({
          source:       p.source || 'pdf',
          title:        p.title  || 'untitled',
          content_text: String(c).slice(0, 8000),
          lang:         p.lang   || 'bn',
        }));

        const r = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_base`, {
          method: 'POST',
          headers: { ...SB, Prefer: 'return=minimal' },
          body: JSON.stringify(rows),
        });
        if (!r.ok) return reply(500, { error: 'insert failed', detail: await r.text() });
        return reply(200, { added: rows.length });
      }

      // ── 3. KB_LIST: কোন কোন ফাইল আপলোড হয়েছে, টুকরো গুনে দেখাও ──
      case 'kb_list': {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/knowledge_base`
          + `?select=title,source,lang&order=created_at.desc&limit=2000`,
          { headers: SB });
        const rows = await r.json().catch(() => []);
        if (!Array.isArray(rows)) return reply(200, { files: [] });

        // title অনুযায়ী গুনে একত্র করি (কয়টা টুকরো প্রতি ফাইলে)
        const map = {};
        for (const x of rows) {
          const key = x.title || 'untitled';
          if (!map[key]) map[key] = { title: key, source: x.source, lang: x.lang, chunks: 0 };
          map[key].chunks++;
        }
        return reply(200, { files: Object.values(map), total: rows.length });
      }

      // ── 4. KB_DELETE: একটি ফাইলের সব টুকরো মুছে ফেলো ──────────
      case 'kb_delete': {
        const title = p.title || '';
        if (!title) return reply(400, { error: 'no title' });
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/knowledge_base`
          + `?title=eq.${encodeURIComponent(title)}`,
          { method: 'DELETE', headers: { ...SB, Prefer: 'return=minimal' } });
        if (!r.ok) return reply(500, { error: 'delete failed', detail: await r.text() });
        return reply(200, { deleted: title });
      }

      default:
        return reply(400, { error: 'unknown action: ' + p.action });
    }
  } catch (e) {
    return reply(500, { error: String(e && e.message || e) });
  }
};


// ── HELPER: knowledge_base খোঁজা ───────────────────────────────
// কৌশল: আগে শব্দ-মিল দিয়ে প্রাসঙ্গিক টুকরো খুঁজি। না পেলে (বাংলায়
// প্রায়ই শব্দ মেলে না), সাম্প্রতিক অনেকগুলো টুকরো এনে Angeli-কে দিই —
// যাতে সে সব তথ্য জেনে উত্তর দিতে পারে। মোট তথ্য ছোট বলে এটা নিরাপদ।
async function searchKnowledge(question) {
  // (১) শব্দ-মিল চেষ্টা — ইংরেজি ও বড় শব্দের জন্য কাজে দেয়
  const words = (question || '')
    .split(/\s+/)
    .filter(w => w.length > 1)
    .slice(0, 8);

  let rows = [];
  if (words.length) {
    const orFilter = words
      .map(w => `content_text.ilike.*${encodeURIComponent(w)}*`)
      .join(',');
    const url = `${SUPABASE_URL}/rest/v1/knowledge_base`
      + `?select=title,content_text`
      + `&or=(${orFilter})`
      + `&limit=8`;
    const r = await fetch(url, { headers: SB }).catch(() => null);
    if (r && r.ok) rows = await r.json().catch(() => []);
  }

  // (২) শব্দ-মিলে কিছু না পেলে — অনেকগুলো টুকরো এনে দিই (fallback)
  if (!Array.isArray(rows) || rows.length === 0) {
    const url = `${SUPABASE_URL}/rest/v1/knowledge_base`
      + `?select=title,content_text&limit=40`;
    const r = await fetch(url, { headers: SB }).catch(() => null);
    if (r && r.ok) rows = await r.json().catch(() => []);
  }

  if (!Array.isArray(rows) || !rows.length) return '';

  return rows
    .map(x => `[${x.title}] ${x.content_text}`)
    .join('\n\n')
    .slice(0, 9000);   // Claude-কে যথেষ্ট তথ্য দিই
}

// ── HELPER: একটি বার্তা সেভ করা ────────────────────────────────
async function saveMessage(convId, role, text, lang, inputType) {
  if (!convId) return;
  await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'return=minimal' },
    body: JSON.stringify({
      conversation_id: convId,
      role, message_text: text, lang, input_type: inputType,
    }),
  }).catch(() => null);
}

// ── HELPER: Claude API কল ──────────────────────────────────────
async function askClaude(question, context, history, lang) {
  // Claude key না থাকলে একটা সাধারণ fallback উত্তর
  if (!CLAUDE_KEY) {
    return lang === 'en'
      ? "Hi! I'm Angeli. The AI is not connected yet — please ask SAR to add the Claude key."
      : 'আসসালামু আলাইকুম! আমি Angeli। এখনো AI যুক্ত হয়নি — অনুগ্রহ করে SAR-কে Claude key যোগ করতে বলুন।';
  }

  const contextBlock = context
    ? `CONTEXT (SAR information):\n${context}`
    : 'CONTEXT: (no specific SAR document matched this question)';

  // আগের কয়েকটা বার্তা + এবারের প্রশ্ন
  const messages = [];
  for (const h of history) {
    if (h && h.role && h.text) {
      messages.push({
        role: h.role === 'angeli' ? 'assistant' : 'user',
        content: h.text,
      });
    }
  }
  messages.push({ role: 'user', content: `${contextBlock}\n\nCustomer question: ${question}` });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',   // সস্তা ও দ্রুত — সাধারণ চ্যাটের জন্য যথেষ্ট
      max_tokens: 600,
      system: ANGELI_PERSONA,
      messages,
    }),
  }).catch(() => null);

  if (!r || !r.ok) {
    const detail = r ? await r.text().catch(() => '') : 'no response';
    return lang === 'en'
      ? 'Sorry, I had trouble answering. Please try again.'
      : 'দুঃখিত, উত্তর দিতে সমস্যা হলো। আবার চেষ্টা করুন।';
  }

  const data = await r.json();
  const text = Array.isArray(data.content)
    ? data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
    : '';
  return text || (lang === 'en' ? 'Sorry, no answer.' : 'দুঃখিত, উত্তর পাওয়া যায়নি।');
}
