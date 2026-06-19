// netlify/functions/daily-report.js
// ───────────────────────────────────────────────────────────────────────────
// SAR — প্রতিদিন/শুক্রবার ভোর ৬টার অটোমেশন (PDF ছাড়া হালকা সংস্করণ)
//
// যা করে (cron থেকে ডাকা হলে):
//   1. সব আপার (customer) metrics আনে
//   2. প্রত্যেকের জন্য localScore() দিয়ে analysis → meal_score
//   3. ৩ টেবিলে সেভ করে:
//        • ai_analysis   (receipt.html ও meal-score.html পড়ে)
//        • reports       (dashboard.html পড়ে)
//        • meal_scores   (meal-score.html / sar.js todayScore পড়ে)
//   4. send-sms ও send-email (Netlify functions) দিয়ে আপাকে জানায়
//
// PDF/puppeteer বাদ — ওটা crash করাচ্ছিল, পুরো chain আটকে যাচ্ছিল।
// PDF পরে browser-print দিয়ে যোগ করা যাবে।
//
// Netlify env:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY  (আবশ্যক)
//   CRON_SECRET                         (ঐচ্ছিক — থাকলে ?secret= লাগবে)
//   PUBLIC_SITE                         (লিংক বানাতে, default sheairestaurant.com)
// SMS/Email এর key send-sms.js / send-email.js নিজেরা পড়ে।
// ───────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY ||
                     process.env.SUPABASE_SERVICE_ROLE_KEY ||
                     process.env.SUPABASE_KEY || '';
const CRON_SECRET  = process.env.CRON_SECRET || '';
const PUBLIC_SITE  = process.env.PUBLIC_SITE ||
                     process.env.URL ||
                     'https://sheairestaurant.com';

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

exports.handler = async (event) => {
  // নিরাপত্তা: CRON_SECRET সেট থাকলে ?secret=... মিলতে হবে
  const givenSecret = (event.queryStringParameters || {}).secret || '';
  if (CRON_SECRET && givenSecret !== CRON_SECRET) {
    return reply(401, { error: 'Unauthorized — wrong or missing secret' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return reply(500, { error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const summary = { date: today, analyzed: 0, reports: 0, scores: 0, sms: 0, email: 0, errors: [] };

  try {
    // ── 1. সব metrics আনা ──
    const mr = await fetch(`${SUPABASE_URL}/rest/v1/customer_metrics?select=*`, { headers: SB });
    const people = await mr.json();
    if (!Array.isArray(people) || people.length === 0) {
      return reply(200, { ...summary, note: 'কোনো আপার metrics নেই' });
    }

    // ── customer যোগাযোগের তথ্য ──
    const cr = await fetch(
      `${SUPABASE_URL}/rest/v1/customers?select=id,full_name,phone,email`, { headers: SB });
    const custList = await cr.json();
    const custMap = {};
    if (Array.isArray(custList)) custList.forEach(c => { custMap[c.id] = c; });

    // ── প্রত্যেক আপার জন্য লুপ ──
    for (const m of people) {
      const cid  = m.customer_id;
      const cust = custMap[cid] || {};
      const name = cust.full_name || 'আপা';

      try {
        const cat = pickCat(m);
        const a   = localScore(m, cat);
        const resultJson = { ...a, score_date: today, source: 'daily 6AM' };

        // ── 2. ai_analysis এ সেভ (receipt + meal-score পড়ে) ──
        const aiRes = await fetch(`${SUPABASE_URL}/rest/v1/ai_analysis`, {
          method: 'POST', headers: { ...SB, Prefer: 'return=minimal' },
          body: JSON.stringify({
            customer_id:   cid,
            analysis_type: 'meal_score',
            category:      cat,
            meal_score:    a.score,
            daily_kcal:    a.target,
            daily_protein: a.protein,
            focus:         a.focus,
            result_json:   resultJson,
          }),
        });
        if (aiRes.ok) summary.analyzed++;
        else summary.errors.push(`ai_analysis fail (${name}): ${aiRes.status}`);

        // ── 3. reports এ সেভ, PDF link ছাড়া (dashboard পড়ে) ──
        const repRes = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
          method: 'POST',
          headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            customer_id: cid,
            report_date: today,
            meal_score:  a.score,
            category:    cat,
            pdf_url:     null,                 // PDF পরে যোগ হবে
            summary:     a.focus,
            result_json: resultJson,
          }),
        });
        if (repRes.ok) summary.reports++;
        else summary.errors.push(`reports fail (${name}): ${repRes.status}`);

        // ── 4. meal_scores এ সেভ (meal-score.html / todayScore পড়ে) ──
        const msRes = await fetch(`${SUPABASE_URL}/rest/v1/meal_scores`, {
          method: 'POST', headers: { ...SB, Prefer: 'return=minimal' },
          body: JSON.stringify({
            customer_id:   cid,
            category:      cat,
            meal_score:    a.score,
            daily_kcal:    a.target,
            daily_protein: a.protein,
            focus:         a.focus,
            analysis:      resultJson,
          }),
        });
        if (msRes.ok) summary.scores++;
        // meal_scores fail হলে chain থামবে না (ঐচ্ছিক টেবিল)

        // ── 5. SMS + Email (আপনার নতুন Netlify functions) ──
        const mealUrl = `${PUBLIC_SITE}/meal-score.html?customer_id=${cid}`;
        const shortMsg =
          `SAR: প্রিয় ${name}, আজকের স্বাস্থ্য রিপোর্ট তৈরি! খাবার স্কোর ${a.score}/100। মেনু দেখুন: ${mealUrl}`;

        if (cust.phone) {
          try {
            const r = await fetch(`${PUBLIC_SITE}/.netlify/functions/send-sms`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: cust.phone, msg: shortMsg }),
            });
            const d = await r.json().catch(() => ({}));
            if (d && d.sent) summary.sms++;
            else summary.errors.push(`SMS fail (${name}): ${(d && d.error) || '?'}`);
          } catch (e) { summary.errors.push(`SMS err (${name})`); }
        }

        if (cust.email) {
          try {
            const html = buildReportHTML({ name, cid, today, cat, a, m });
            const r = await fetch(`${PUBLIC_SITE}/.netlify/functions/send-email`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: cust.email,
                subject: `SAR স্বাস্থ্য রিপোর্ট — ${today}`,
                html,
              }),
            });
            const d = await r.json().catch(() => ({}));
            if (d && d.sent) summary.email++;
            else summary.errors.push(`Email fail (${name}): ${(d && d.error) || '?'}`);
          } catch (e) { summary.errors.push(`Email err (${name})`); }
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
// সাহায্যকারী ফাংশন (আসল daily-report.js থেকে হুবহু — শুধু PDF/Twilio বাদ)
// ═══════════════════════════════════════════════════════════════════════════

function buildReportHTML({ name, cid, today, cat, a, m }) {
  const row = (label, val) =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">${label}</td>
         <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${val ?? '—'}</td></tr>`;
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8">
  <style>body{font-family:Arial,sans-serif;color:#222;max-width:600px;margin:0 auto;padding:1rem}
  h1{color:#E91E8C} table{width:100%;border-collapse:collapse;margin-top:.5rem}</style></head>
  <body>
    <h1>🌸 SAR স্বাস্থ্য রিপোর্ট</h1>
    <p><strong>${name}</strong> · ${today}</p>
    <table>
      ${row('রোগ বিভাগ', cat)}
      ${row('খাবার স্কোর', a.score + '/100')}
      ${row('দৈনিক ক্যালরি লক্ষ্য', a.target + ' kcal')}
      ${row('প্রোটিন লক্ষ্য', a.protein + ' g')}
      ${row('আজকের ফোকাস', a.focus)}
    </table>
    <p style="margin-top:1rem"><a href="${PUBLIC_SITE}/meal-score.html?customer_id=${cid}">আজকের মেনু দেখুন →</a></p>
    <p style="color:#999;font-size:.78rem;margin-top:1.5rem">She AI Restaurant · women-only · women-run · women-led</p>
  </body></html>`;
}

function pickCat(m) {
  if (m.pregnancy_status === true || m.pregnancy_status === 'yes') return 'PR';
  if (m.diabetes_type)      return 'DM';
  if (m.fatty_liver_grade)  return 'FL';
  if (m.ibs_type)           return 'IB';
  if (parseFloat(m.bmi) >= 30) return 'OB';
  return m.sar_category_interest || 'GEN';
}

// ── স্কোর ইঞ্জিন (sar.js এর মূল লজিকের সরল রূপ — হুবহু রাখা) ──
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
