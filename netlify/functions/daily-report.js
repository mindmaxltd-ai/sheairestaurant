// netlify/functions/daily-report.js
// ───────────────────────────────────────────────────────────────────────────
// SAR — প্রতিদিন ভোর ৬টার সম্পূর্ণ অটোমেশন (এক ফাইলেই পুরো পাইপলাইন)
//
// এই ফাংশনটি যা করে (প্রতিদিন একবার, cron-job.org থেকে ডাকা হলে):
//   1. সব আপার (customer) metrics ডেটাবেস থেকে আনে
//   2. প্রত্যেকের জন্য AI/engine বিশ্লেষণ চালিয়ে meal_score বানায়  → ai_analysis টেবিলে সেভ
//   3. প্রত্যেকের জন্য একটা HTML রিপোর্ট বানিয়ে PDF করে
//   4. PDF টা Supabase Storage এ আপলোড করে → একটা পাবলিক লিংক বানায়
//   5. লিংকটা reports টেবিলে সেভ করে (dashboard এ "রিপোর্ট দেখুন" বোতামে দেখানোর জন্য)
//   6. Twilio (SMS/WhatsApp) + Resend (ইমেইল) দিয়ে আপাকে লিংকসহ বার্তা পাঠায়
//
// ── ডেভেলপারের জন্য নোট ─────────────────────────────────────────────────────
// Netlify → Site settings → Environment variables এ এগুলো থাকতে হবে:
//   SUPABASE_URL            https://xlkrggspepnysbouatec.supabase.co
//   SUPABASE_SERVICE_KEY    service_role key (গোপন, শুধু সার্ভারে)
//   CRON_SECRET             নিজে একটা পাসওয়ার্ড বানান (যেমন: sar-secret-9f3k2)
//   TWILIO_ACCOUNT_SID      Twilio console থেকে (AC...)
//   TWILIO_AUTH_TOKEN       Twilio auth token
//   TWILIO_FROM             Twilio নম্বর বা WhatsApp sender (যেমন: whatsapp:+14155238886)
//   RESEND_API_KEY          resend.com থেকে (re_...)
//   RESEND_FROM             পাঠানোর ইমেইল (যেমন: SAR <report@sheairestaurant.com>)
//   PUBLIC_SITE             https://sheairestaurant.com   (লিংক বানাতে)
//
// নির্ভরশীলতা: কোনো বাইরের npm package লাগে না (puppeteer বাদ দেওয়া হয়েছে)।
// (PDF বানানোর জন্য — সেটআপ গাইডে বিস্তারিত আছে)
// ───────────────────────────────────────────────────────────────────────────

// PDF (puppeteer) বাদ — Netlify Scheduled Function-এ এটি crash করত ও পুরো chain আটকে যেত।
// ৬টার core কাজ: analysis + ai_analysis/reports সেভ + SMS/email। PDF পরে আলাদাভাবে যোগ করা যাবে।

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET || '';
const PUBLIC_SITE  = process.env.PUBLIC_SITE || 'https://sheairestaurant.com';

// Claude AI key (doctor.html এর মতো আসল AI বিশ্লেষণের জন্য)
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_KEY || '';

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM  = process.env.TWILIO_FROM || '';
const RESEND_KEY   = process.env.RESEND_API_KEY || '';
const RESEND_FROM  = process.env.RESEND_FROM || 'SAR <onboarding@resend.dev>';

const SB = {
  apikey: SERVICE_KEY,
  Authorization: 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json',
};

const reply = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

const BUCKET = 'reports'; // Supabase Storage bucket এর নাম

exports.handler = async (event) => {
  // ── নিরাপত্তা: শুধু সঠিক গোপন-শব্দ থাকলেই চলবে ──
  // cron-job.org থেকে ডাকার সময় URL এ ?secret=আপনার_CRON_SECRET যোগ করতে হবে
  const givenSecret = (event.queryStringParameters || {}).secret || '';
  if (CRON_SECRET && givenSecret !== CRON_SECRET) {
    return reply(401, { error: 'Unauthorized — wrong or missing secret' });
  }
  if (!SERVICE_KEY) return reply(500, { error: 'Missing SUPABASE_SERVICE_KEY' });

  const today = new Date().toISOString().slice(0, 10);
  const summary = { date: today, analyzed: 0, reports: 0, sms: 0, email: 0, errors: [] };

  try {
    // ── 1. সব আপার metrics + যোগাযোগের তথ্য আনা ──
    const mr = await fetch(
      `${SUPABASE_URL}/rest/v1/customer_metrics?select=*`, { headers: SB });
    const people = await mr.json();
    if (!Array.isArray(people) || people.length === 0) {
      return reply(200, { ...summary, note: 'কোনো আপার metrics নেই' });
    }

    // customers টেবিল থেকে নাম/ফোন/ইমেইল আনা (এক ডাকে সব)
    const cr = await fetch(
      `${SUPABASE_URL}/rest/v1/customers?select=id,full_name,phone,email`, { headers: SB });
    const custList = await cr.json();
    const custMap = {};
    if (Array.isArray(custList)) custList.forEach(c => { custMap[c.id] = c; });

    // PDF browser বাদ — সরাসরি analysis loop

    // ── প্রত্যেক আপার জন্য লুপ ──
    for (const m of people) {
      const cid  = m.customer_id;
      const cust = custMap[cid] || {};
      const name = cust.full_name || 'আপা';

      try {
        // ── 2. আসল Claude AI বিশ্লেষণ (২৫০ metrics + prescription + order) ──
        const cat = pickCat(m);
        const ai  = await aiAnalyze(m, cat, cust, cid);   // Claude AI
        const a   = localScore(m, cat);                    // fallback সংখ্যা

        // AI সফল হলে AI data, নাহলে localScore
        const healthScore = (ai && ai.health_score) ? ai.health_score : a.score;
        const dailyKcal   = (ai && ai.daily_kcal)   ? ai.daily_kcal   : a.target;
        const dailyProt   = (ai && ai.daily_protein)? ai.daily_protein: a.protein;
        const focusV      = (ai && ai.focus)        ? ai.focus        : a.focus;

        const analysisRow = {
          customer_id:   cid,
          analysis_date: today,
          analysis_type: 'daily_6am',
          category:      cat,
          health_score:  healthScore,                      // dashboard এটাই পড়ে
          meal_score:    a.score,
          daily_kcal:    dailyKcal,
          daily_protein: dailyProt,
          focus:         focusV,
          // AI text fields (থাকলে)
          health_summary_bn:      ai ? ai.health_summary_bn      : null,
          nutrition_advice_bn:    ai ? ai.nutrition_advice_bn    : null,
          general_suggestions_bn: ai ? ai.general_suggestions_bn : null,
          home_remedies_bn:       ai ? ai.home_remedies_bn       : null,
          ayurvedic_bn:           ai ? ai.ayurvedic_bn           : null,
          motivational_message_bn:ai ? ai.motivational_message_bn: null,
          problems_json:          ai ? ai.problems_json          : null,
          daily_menu_recommendation_json: ai ? ai.daily_menu_recommendation_json : null,
          result_json:   { ...(ai||a), score_date: today, source: 'daily 6AM AI' },
        };
        // analysis_date+customer_id unique — merge-duplicates দিয়ে upsert
        await fetch(`${SUPABASE_URL}/rest/v1/ai_analysis`, {
          method: 'POST', headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(analysisRow),
        });
        summary.analyzed++;

        // ── 3. reports টেবিলে সেভ (dashboard report card-এর জন্য) — HTML report link ──
        const reportUrl = `${PUBLIC_SITE}/report.html?customer_id=${cid}`;
        await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
          method: 'POST',
          headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            customer_id: cid,
            report_date: today,
            pdf_url:     reportUrl,        // HTML report পেজ link (PDF না)
            meal_score:  healthScore,
            category:    cat,
          }),
        });

        // ── 4. SMS/WhatsApp + ইমেইল পাঠানো (report link সহ) ──
        const mealUrl = reportUrl;
        const shortMsg =
          `প্রিয় ${name}, আজকের আপনার SAR স্বাস্থ্য রিপোর্ট তৈরি!\n`
          + `স্বাস্থ্য স্কোর: ${healthScore}/100\n`
          + `রিপোর্ট দেখুন: ${mealUrl}`;

        // SAR-এর নিজের কাজ-করা send-sms function
        if (cust.phone) {
          try {
            const sr = await fetch(`${PUBLIC_SITE}/.netlify/functions/send-sms`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: cust.phone, msg: shortMsg }),
            });
            const sd = await sr.json().catch(()=>({}));
            if (sd && sd.sent) summary.sms++;
            else summary.errors.push(`SMS fail: ${name}`);
          } catch(e){ summary.errors.push(`SMS err: ${name}`); }
        }
        // SAR-এর নিজের কাজ-করা send-email function
        if (cust.email) {
          try {
            const emailHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:1rem">
              <h2 style="color:#E91E8C">🌸 SAR — আজকের স্বাস্থ্য রিপোর্ট</h2>
              <p>প্রিয় ${name},</p>
              <p>আজকের আপনার স্বাস্থ্য স্কোর: <b>${healthScore}/100</b></p>
              <p><a href="${mealUrl}" target="_blank" style="display:inline-block;background:#059669;color:#fff;padding:.6rem 1.2rem;border-radius:8px;text-decoration:none">📄 পূর্ণ রিপোর্ট দেখুন</a></p>
              <p style="color:#999;font-size:.75rem;margin-top:1.5rem">SAR — women-led · women-run · women-only</p></div>`;
            const er = await fetch(`${PUBLIC_SITE}/.netlify/functions/send-email`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: cust.email, subject: 'SAR — আজকের স্বাস্থ্য রিপোর্ট', html: emailHtml }),
            });
            const ed = await er.json().catch(()=>({}));
            if (ed && (ed.sent || ed.id)) summary.email++;
            else summary.errors.push(`Email fail: ${name}`);
          } catch(e){ summary.errors.push(`Email err: ${name}`); }
        }

      } catch (perErr) {
        summary.errors.push(`${name}: ${String(perErr.message || perErr)}`);
      }
    }

    return reply(200, summary);

  } catch (err) {
    return reply(500, { error: String(err.message || err), summary });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// সাহায্যকারী ফাংশনগুলো
// ═══════════════════════════════════════════════════════════════════════════

// ── Twilio দিয়ে SMS / WhatsApp ──
async function sendSMS(toPhone, body) {
  try {
    // বাংলাদেশি নম্বর: 01XXXXXXXXX → +8801XXXXXXXXX
    let to = String(toPhone).trim();
    if (to.startsWith('01')) to = '+88' + to;
    if (!to.startsWith('+')) to = '+' + to;
    // WhatsApp sender হলে গ্রাহকের নম্বরেও whatsapp: লাগবে
    if (TWILIO_FROM.startsWith('whatsapp:')) to = 'whatsapp:' + to;

    const creds = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
    const params = new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body });
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + creds,
                   'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    return r.ok;
  } catch { return false; }
}

// ── Resend দিয়ে ইমেইল ──
async function sendEmail(toEmail, name, score, pdfUrl, cid) {
  try {
    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:auto">
        <h2 style="color:#059669">SAR সার — আজকের স্বাস্থ্য রিপোর্ট</h2>
        <p>প্রিয় ${name},</p>
        <p>আজকের আপনার সম্পূর্ণ স্বাস্থ্য ও খাদ্য বিশ্লেষণ তৈরি হয়েছে।</p>
        <p style="font-size:18px"><b>খাবার স্কোর: ${score}/100</b></p>
        <p>
          <a href="${pdfUrl}" style="background:#059669;color:#fff;padding:10px 18px;
             border-radius:8px;text-decoration:none">📄 পূর্ণ রিপোর্ট (PDF) দেখুন</a>
        </p>
        <p>
          <a href="${PUBLIC_SITE}/meal-score.html?customer_id=${cid}">🍽️ আজকের কাস্টমাইজড মেনু দেখুন</a>
        </p>
        <hr><p style="color:#888;font-size:12px">She AI Revolution — নারীর জন্য, নারীর দ্বারা</p>
      </div>`;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM, to: [toEmail],
        subject: `SAR স্বাস্থ্য রিপোর্ট — স্কোর ${score}/100`, html,
      }),
    });
    return r.ok;
  } catch { return false; }
}

// ── রিপোর্টের HTML (এটাই PDF হয়ে যায়) ──
function buildReportHTML({ name, cid, today, cat, a, m }) {
  const row = (label, val) =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">${label}</td>
         <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${val ?? '—'}</td></tr>`;
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8">
    <style>body{font-family:'Hind Siliguri',Arial,sans-serif;color:#222}</style></head>
    <body>
      <div style="text-align:center;border-bottom:3px solid #059669;padding-bottom:10px">
        <h1 style="color:#059669;margin:0">She AI Revolution (SAR)</h1>
        <p style="margin:4px 0;color:#777">দৈনিক স্বাস্থ্য ও খাদ্য বিশ্লেষণ রিপোর্ট</p>
      </div>
      <table style="width:100%;margin-top:16px;border-collapse:collapse">
        ${row('নাম', name)}
        ${row('সদস্য আইডি', cid)}
        ${row('তারিখ', today)}
        ${row('স্বাস্থ্য ক্যাটাগরি', cat)}
        ${row('খাবার স্কোর', a.score + ' / 100')}
        ${row('দৈনিক ক্যালরি লক্ষ্য', a.target + ' kcal')}
        ${row('দৈনিক প্রোটিন', a.protein + ' g')}
        ${row('BMI', m.bmi)}
        ${row('মূল ফোকাস', a.focus)}
      </table>
      <div style="margin-top:20px;padding:14px;background:#f0fdf4;border-radius:8px">
        <b style="color:#059669">আজকের পরামর্শ:</b>
        <p style="margin:6px 0 0">${a.focus || 'সুষম, তেল-চিনি-লবণমুক্ত খাবার গ্রহণ করুন।'}</p>
      </div>
      <p style="margin-top:24px;color:#999;font-size:12px;text-align:center">
        এই রিপোর্ট স্বয়ংক্রিয়ভাবে তৈরি — She AI Revolution · নারীর জন্য, নারীর দ্বারা
      </p>
    </body></html>`;
}

// ── আসল Claude AI বিশ্লেষণ (২৫০ metrics + আগের prescription + food order) ──
async function aiAnalyze(m, cat, cust, cid) {
  if (!ANTHROPIC_KEY) return null;   // key না থাকলে localScore fallback

  // সব metrics (যেগুলোর value আছে)
  const skip = ['id','customer_id','created_at','updated_at'];
  const metricsStr = Object.entries(m)
    .filter(([k,v]) => !skip.includes(k) && v!=null && v!=='' && String(v).trim()!=='')
    .map(([k,v]) => `${k}: ${v}`).join('\n') || 'নেই';

  // আগের ২টা prescription
  let prevRx = 'নেই';
  try {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/sar_notes?customer_id=eq.${cid}&note_type=eq.prescription&order=created_at.desc&limit=2&select=note_text_bn,created_at`, { headers: SB });
    const arr = pr.ok ? await pr.json() : [];
    if (arr.length) prevRx = arr.map((p,i)=>`[${i+1}] ${(p.note_text_bn||'').slice(0,400)}`).join('\n\n');
  } catch(e){}

  // আগের food order (পছন্দ বোঝাতে)
  let prevOrders = 'নেই';
  try {
    const or = await fetch(`${SUPABASE_URL}/rest/v1/orders?customer_id=eq.${cid}&order=created_at.desc&limit=3&select=items_json,created_at`, { headers: SB });
    const arr = or.ok ? await or.json() : [];
    if (arr.length) prevOrders = arr.map(o=> JSON.stringify(o.items_json||'').slice(0,200)).join('; ');
  } catch(e){}

  // আগের ২টা AI report (ধারাবাহিকতা রাখতে)
  let prevReports = 'নেই';
  try {
    const rr = await fetch(`${SUPABASE_URL}/rest/v1/ai_analysis?customer_id=eq.${cid}&order=analysis_date.desc&limit=2&select=analysis_date,health_score,health_summary_bn,focus`, { headers: SB });
    const arr = rr.ok ? await rr.json() : [];
    if (arr.length) prevReports = arr.map(p=>`[${p.analysis_date}] স্কোর ${p.health_score||'—'}, ফোকাস: ${p.focus||''} — ${(p.health_summary_bn||'').slice(0,200)}`).join('\n');
  } catch(e){}

  const prompt = `তুমি SAR (She AI Restaurant) ক্লিনিক্যাল পুষ্টি AI। নিচের নারী গ্রাহকের সম্পূর্ণ তথ্য বিশ্লেষণ করে দৈনিক স্বাস্থ্য রিপোর্ট দাও।

নাম: ${cust.full_name||'গ্রাহক'}
বিভাগ: ${cat}

স্বাস্থ্য মেট্রিক্স (২৫০-এর মধ্যে উপলব্ধ সব + আজকের দৈনিক আপডেট):
${metricsStr}

আগের প্রেসক্রিপশন (সর্বশেষ ২টি):
${prevRx}

আগের খাবার অর্ডার (পছন্দ বোঝাতে):
${prevOrders}

আগের AI রিপোর্ট (সর্বশেষ ২টি — ধারাবাহিকতা ও অগ্রগতি বিবেচনা করো):
${prevReports}

অনুরোধ: সব তথ্য বিবেচনা করে নিচের JSON structure-এ রিপোর্ট দাও। প্রতিটি অংশ সংক্ষিপ্ত। সম্পূর্ণ valid JSON, কাটা যাবে না। শুধু JSON object, markdown নয়:
{
  "health_score": <১-১০০ সংখ্যা>,
  "health_summary_bn": "সার্বিক স্বাস্থ্য মূল্যায়ন (২-৩ বাক্য বাংলায়)",
  "problems_json": ["সমস্যা ১", "সমস্যা ২"],
  "nutrition_advice_bn": "পুষ্টি পরামর্শ (অয়েল-ফ্রি, চিনি-ফ্রি, পিংক সল্ট)",
  "general_suggestions_bn": "সাধারণ পরামর্শ",
  "home_remedies_bn": "ঘরোয়া প্রতিকার",
  "ayurvedic_bn": "আয়ুর্বেদিক পরামর্শ",
  "motivational_message_bn": "অনুপ্রেরণামূলক বার্তা",
  "daily_kcal": <সংখ্যা>,
  "daily_protein": <সংখ্যা>,
  "focus": "আজকের মূল ফোকাস",
  "daily_menu_recommendation_json": ["সকাল: ...", "দুপুর: ...", "রাত: ..."]
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    let txt = (d.content && d.content[0] && d.content[0].text) || '';
    txt = txt.replace(/```json|```/g, '').trim();
    const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
    if (a>-1 && b>a) txt = txt.slice(a, b+1);
    return JSON.parse(txt);
  } catch(e) { return null; }
}

// ── ক্যাটাগরি বাছাই (sar.js এর মূল লজিকের সরল রূপ) ──
function pickCat(m) {
  if (m.pregnancy_status === true || m.pregnancy_status === 'yes') return 'PR';
  if (m.diabetes_type)      return 'DM';
  if (m.fatty_liver_grade)  return 'FL';
  if (m.ibs_type)           return 'IB';
  if (parseFloat(m.bmi) >= 30) return 'OB';
  return m.sar_category_interest || 'GEN';
}

// ── স্কোর ইঞ্জিন (sar.js এর মূল লজিকের সরল রূপ) ──
function localScore(m, cat) {
  let score = 70;
  const bmi = parseFloat(m.bmi) || 0;
  if (bmi && bmi >= 18.5 && bmi < 25) score += 12;
  if (m.stress_level === 'low')   score += 6;
  if (m.activity_level === 'high') score += 8;
  if (score > 100) score = 100;

  const target  = cat === 'PR' ? 2200 : (cat === 'OB' ? 1500 : 1800);
  const protein = cat === 'PR' ? 75 : 60;
  const focusMap = {
    DM: 'রক্তে শর্করা নিয়ন্ত্রণ — কম গ্লাইসেমিক খাবার ও আঁশ',
    OB: 'ওজন কমানো — কম ক্যালরি, বেশি প্রোটিন ও আঁশ',
    PR: 'গর্ভকালীন পুষ্টি — আয়রন, ফোলেট ও ক্যালসিয়াম',
    FL: 'লিভার সুস্থতা — তেলমুক্ত, চিনিমুক্ত খাবার',
    IB: 'পাকস্থলী আরাম — সহজপাচ্য, কম ঝাল খাবার',
    GEN:'সার্বিক সুস্থতা — সুষম, তেল-চিনি-লবণমুক্ত খাবার',
  };
  return { score, target, protein, focus: focusMap[cat] || focusMap.GEN };
}

// ═══════════════════════════════════════════════════════════════
// Netlify Scheduled Function — প্রতিদিন সকাল ৬টা (বাংলাদেশ, BST=UTC+6)
// 00:00 UTC = সকাল ৬টা বাংলাদেশ সময়। Netlify cron UTC-তে চলে।
// (১০০০+ গ্রাহক হলে সাপ্তাহিক করতে চাইলে "0 0 * * 5" = শুক্রবার ৬টা)
// ═══════════════════════════════════════════════════════════════
exports.config = {
  schedule: "0 0 * * *"
};
