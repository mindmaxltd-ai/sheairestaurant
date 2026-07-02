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
const RESEND   = process.env.RESEND_API_KEY   || '';
const SITE_URL = process.env.URL              || 'https://sheairestaurant.com';

const PAGE_SIZE   = 2000; // customers per run — matches analyze-batch-submit's page size
const CONCURRENCY = 15;   // how many customers' SMS+email are sent in parallel at once

const SB = { apikey:SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}`, 'Content-Type':'application/json' };

// Only needed to turn a category code into a Bangla label for the SMS text.
const CAT_BN = { DM:'ডায়াবেটিস', OB:'স্থূলতা', FL:'ফ্যাটি লিভার', IB:'IBS/গ্যাস্ট্রিক', PR:'গর্ভাবস্থা' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  // Background functions: Netlify doesn't deliver this return value anywhere
  // useful (the caller already got a 202 and moved on) — we still return
  // a normal response so local testing / logs behave sensibly.
  if (!SUPA_KEY) { console.error('Missing SUPABASE_SERVICE_KEY'); return { statusCode: 500, headers: CORS }; }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  try {
    if (body.action === 'run' && body.customer_id) {
      const result = await processOne(body.customer_id);
      console.log('single result:', JSON.stringify(result));
      return { statusCode: 200, headers: CORS };
    }

    const custs = await sbGet(
      `/rest/v1/customers?is_active=eq.true&admin_approved=eq.true&select=id,full_name,phone,email,sar_category&order=id.asc&limit=${PAGE_SIZE}`
    );
    if (!Array.isArray(custs)) { console.error('Cannot fetch customers'); return { statusCode: 500, headers: CORS }; }

    // bulk-fetch today's ai_analysis rows for everyone in this page, chunked
    const analysisMap = await fetchAnalysisForIds(custs.map(c => c.id));

    let sent = 0, skipped = 0, failed = 0;
    await runWithConcurrency(custs, CONCURRENCY, async (cust) => {
      try {
        const analysis = analysisMap[cust.id];
        if (!analysis) { skipped++; return; }
        await sendForCustomer(cust, analysis);
        sent++;
      } catch (e) {
        failed++;
        console.error(`failed for ${cust.id}:`, e.message);
      }
    });

    console.log(`daily-report done — total:${custs.length} sent:${sent} skipped:${skipped} failed:${failed} date:${today()}`);
    return { statusCode: 200, headers: CORS };
  } catch (e) {
    console.error('daily-report fatal error:', e.message);
    return { statusCode: 500, headers: CORS };
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
  const reportUrl = `${SITE_URL}/report.html?id=${analysis.id}`;
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
    if (Array.isArray(list)) for (const row of list) out[row.customer_id] = row;
  }
  return out;
}

async function sendSms(phone, name, score, catBn, url) {
  if (!phone) return false;
  const msg = `🌸 SAR ${today()} | ${name} | ${catBn} | স্কোর ${score}/100 | রিপোর্ট: ${url}`;
  try {
    // send-sms.js expects {to, msg} — NOT {phone, message}. It also always
    // replies HTTP 200 even on logical failure, so we must check body.sent,
    // not just r.ok.
    const r = await fetch(`${SITE_URL}/.netlify/functions/send-sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone, msg }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.sent !== true) {
      console.error('SMS not actually sent:', JSON.stringify(data));
      return false;
    }
    return true;
  } catch (e) { console.error('SMS request failed:', e.message); return false; }
}

async function sendEmail(email, name, html, url) {
  if (!email) return false;
  try {
    // Route through send-email.js (already configured with the right
    // RESEND_KEY/RESEND_API_KEY + FROM address) instead of calling Resend directly.
    const r = await fetch(`${SITE_URL}/.netlify/functions/send-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: email, subject: `🌸 SAR দৈনিক রিপোর্ট — ${today()}`, html }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.sent !== true) {
      console.error('Email not actually sent:', JSON.stringify(data));
      return false;
    }
    return true;
  } catch (e) { console.error('Email request failed:', e.message); return false; }
}

async function sbGet(p) { const r = await fetch(`${SUPA_URL}${p}`, { headers: SB }); return r.json(); }
async function sbGetOne(p) { const d = await sbGet(p); return Array.isArray(d) ? d[0] : null; }
async function sbPatch(p, b) { await fetch(`${SUPA_URL}${p}`, { method: 'PATCH', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(b) }); }
function today() { return new Date().toISOString().split('T')[0]; }
