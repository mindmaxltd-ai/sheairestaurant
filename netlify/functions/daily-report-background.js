// ════════════════════════════════════════════════════════════════
// netlify/functions/daily-report-background.js  v5.0 — SCALE VERSION
//
// Why "-background": Netlify's normal (synchronous) functions time out
// in 10–60 seconds depending on plan. Sending SMS+email to up to 2000
// customers one by one would blow past that easily. Any function file
// whose name ends in "-background" automatically becomes a Background
// Function on Netlify — it gets a 15-minute budget instead, and the
// caller (pg_cron, via net.http_post) doesn't need to wait for a
// response anyway, so this is a safe, free upgrade.
//
// Still read-only w.r.t. AI: no rule engine, no Claude calls here —
// that all happens earlier in analyze-batch-submit / analyze-batch-collect.
// This function ONLY reads today's already-saved ai_analysis rows and
// sends SMS + email, now for up to 2000 customers per run, sent with
// bounded concurrency (CONCURRENCY customers in flight at once) so it
// finishes in a reasonable time without hammering the SMS/email APIs.
//
// If you eventually have MORE than 2000 customers, this file will need
// the same offset/next_offset pagination pattern as analyze-batch-submit
// — ask Claude to add it when you get there.
// ════════════════════════════════════════════════════════════════

const SUPA_URL = process.env.SUPABASE_URL  || 'https://xlkrggspepnysbouatec.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND   = process.env.RESEND_KEY || process.env.RESEND_API_KEY || '';
const SITE_URL = process.env.URL              || 'https://sheairestaurant.com';

const PAGE_SIZE   = 2000; // customers per run — matches analyze-batch-submit's page size
const CONCURRENCY = 15;   // how many customers' SMS+email are sent in parallel at once

const SB = { apikey:SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}`, 'Content-Type':'application/json' };

// Only needed to turn a category code into a Bangla label for the SMS text.
const CAT_BN = { DM:'ডায়াবেটিস', OB:'স্থূলতা', FL:'ফ্যাটি লিভার', IB:'IBS/গ্যাস্ট্রিক', PR:'গর্ভাবস্থা' };

exports.handler = async (event) => {
  // Background functions: Netlify doesn't deliver this return value anywhere
  // useful (the caller already got a 202 and moved on) — we still return
  // a normal response so local testing / logs behave sensibly.
  if (!SUPA_KEY) { console.error('Missing SUPABASE_SERVICE_KEY'); return { statusCode: 500 }; }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  try {
    if (body.action === 'run' && body.customer_id) {
      const result = await processOne(body.customer_id);
      console.log('single result:', JSON.stringify(result));
      return { statusCode: 200 };
    }

    // ── স্কেল-প্রস্তুত: ভেতরেই পেজ-বাই-পেজ লুপ করে, তাই ২,০০০-এর বেশি
    //    কাস্টমার থাকলেও সবাই এক ইনভোকেশনেই কভার হয় — বাদ পড়ে না।
    const MAX_PAGES = 30; // 30×2000 = 60,000 কাস্টমার পর্যন্ত নিরাপত্তা-সীমা
    let totalSent = 0, totalSkipped = 0, totalFailed = 0, offset = 0, pages = 0;

    while (pages < MAX_PAGES) {
      const custs = await sbGet(
        `/rest/v1/customers?is_active=eq.true&admin_approved=eq.true&select=id,full_name,phone,email,sar_category&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`
      );
      if (!Array.isArray(custs)) { console.error('Cannot fetch customers'); return { statusCode: 500 }; }
      if (custs.length === 0) break;
      pages++;

      // bulk-fetch today's ai_analysis rows for everyone in this page, chunked
      const analysisMap = await fetchAnalysisForIds(custs.map(c => c.id));

      await runWithConcurrency(custs, CONCURRENCY, async (cust) => {
        try {
          const analysis = analysisMap[cust.id];
          if (!analysis) { totalSkipped++; return; }
          await sendForCustomer(cust, analysis);
          totalSent++;
        } catch (e) {
          totalFailed++;
          console.error(`failed for ${cust.id}:`, e.message);
        }
      });

      offset += custs.length;
      if (custs.length < PAGE_SIZE) break; // last (partial) page — no more customers
    }

    console.log(`daily-report done — pages:${pages} sent:${totalSent} skipped:${totalSkipped} failed:${totalFailed} date:${today()}`);
    return { statusCode: 200 };
  } catch (e) {
    console.error('daily-report fatal error:', e.message);
    return { statusCode: 500 };
  }
};

// Kept for the {"action":"run","customer_id":"..."} single-customer test path.
async function processOne(cid) {
  const cust = await sbGetOne(`/rest/v1/customers?id=eq.${cid}&select=*`);
  if (!cust) return { id:cid, status:'skip', reason:'customer not found' };
  const analysis = await sbGetOne(
    `/rest/v1/ai_analysis?customer_id=eq.${cid}&analysis_date=eq.${today()}&analysis_type=eq.daily_report&select=*`
  );
  if (!analysis) return { id:cid, status:'skip', reason:'no analysis found for today' };
  await sendForCustomer(cust, analysis);
  return { id:cid, status:'ok', score:analysis.health_score, report_id:analysis.id };
}

async function sendForCustomer(cust, analysis) {
  // report.html নিজে location.search থেকে 'customer_id' প্যারামিটার পড়ে
  // (analysis-এর নিজস্ব id না) — আগে ভুল প্যারামিটার নাম ও ভুল মান পাঠানো
  // হচ্ছিল, তাই report.html কখনো কাস্টমার খুঁজে পেত না।
  const reportUrl = `${SITE_URL}/report.html?customer_id=${cust.id}`;
  const catBn = CAT_BN[analysis.category] || analysis.category;

  const [smsOk, emailOk] = await Promise.all([
    sendSms(cust.phone, cust.full_name, analysis.health_score, catBn, reportUrl),
    sendEmail(cust.email, cust.full_name, analysis.analysis_bn, reportUrl),
  ]);

  await sbPatch(`/rest/v1/ai_analysis?id=eq.${analysis.id}`, { sms_sent: smsOk, email_sent: emailOk });
}

// ── Runs `worker` over `items` with at most `limit` running at once ───
async function runWithConcurrency(items, limit, worker) {
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}

// ── Bulk-fetch today's ai_analysis rows for many customer ids, chunked ─
async function fetchAnalysisForIds(ids) {
  const out = {};
  const CHUNK = 100;
  const dateStr = today();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const list = await sbGet(
      `/rest/v1/ai_analysis?customer_id=in.(${chunk.join(',')})&analysis_date=eq.${dateStr}&analysis_type=eq.daily_report&select=*`
    );
    if (Array.isArray(list)) for (const row of list) {
      // ইতিমধ্যে SMS+ইমেইল দুটোই পাঠানো হয়ে থাকলে বাদ — এটাই এই ফাংশনকে
      // বারবার (প্রতি ১৫ মিনিটে) নিরাপদে চালানোর যোগ্য করে, ডুপ্লিকেট
      // বার্তা পাঠানো ছাড়াই। AI ব্যাচ দেরিতে শেষ হলেও পরের রানেই ধরা পড়বে।
      if (row.sms_sent && row.email_sent) continue;
      out[row.customer_id] = row;
    }
  }
  return out;
}

async function sendSms(phone, name, score, catBn, url) {
  if (!phone) return false;
  const msg = `🌸 SAR ${today()} | ${name} | ${catBn} | স্কোর ${score}/100 | রিপোর্ট: ${url}`;
  try {
    const r = await fetch(`${SITE_URL}/.netlify/functions/send-sms`, {
      // send-sms.js expects {to, msg} — NOT {phone, message}. This field-name
      // mismatch was the actual reason SMS silently failed (send-sms.js
      // returned 400 "no recipient (to)" because it never received `to`).
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone, msg }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error(`sendSms failed for ${phone}: HTTP ${r.status} — ${text.slice(0, 300)}`);
    }
    return r.ok;
  } catch (e) { console.error(`sendSms exception for ${phone}:`, e.message); return false; }
}

async function sendEmail(email, name, html, url) {
  if (!email || !RESEND) { if (!RESEND) console.error('sendEmail: RESEND_API_KEY missing'); return false; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND}` },
      body: JSON.stringify({
        from: 'SAR Health <report@sheairestaurant.com>', to: [email],
        subject: `🌸 SAR দৈনিক রিপোর্ট — ${today()}`, html,
      }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error(`sendEmail failed for ${email}: HTTP ${r.status} — ${text.slice(0, 300)}`);
    }
    return r.ok;
  } catch (e) { console.error(`sendEmail exception for ${email}:`, e.message); return false; }
}

async function sbGet(p) { const r = await fetch(`${SUPA_URL}${p}`, { headers: SB }); return r.json(); }
async function sbGetOne(p) { const d = await sbGet(p); return Array.isArray(d) ? d[0] : null; }
async function sbPatch(p, b) { await fetch(`${SUPA_URL}${p}`, { method: 'PATCH', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(b) }); }
function today() {
  // ঢাকার তারিখ (UTC+6) — analyze-batch-submit/collect-এর সাথে সামঞ্জস্যপূর্ণ।
  const dhaka = new Date(Date.now() + 6 * 60 * 60 * 1000);
  return dhaka.toISOString().split('T')[0];
}
