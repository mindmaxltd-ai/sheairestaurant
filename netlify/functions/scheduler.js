// netlify/functions/scheduler.js  v3.0
// ═══════════════════════════════════════════════════════════════════
// SAR — Daily Scheduler
// প্রতিদিন ভোর ৬টায় (UTC 00:00) সব active customer-এর জন্য
// analysis_queue-এ job তৈরি করে। priority নির্ধারণ করে।
//
// cron-job.org সেটআপ:
//   URL:    https://sheairestaurant.com/.netlify/functions/scheduler?secret=YOUR_SECRET
//   Method: GET
//   Time:   00:00 UTC daily
// ═══════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xlkrggspepnysbouatec.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET || '';
const PUBLIC_SITE  = process.env.PUBLIC_SITE || 'https://sheairestaurant.com';

const SB = {
  apikey: SERVICE_KEY,
  Authorization: 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json',
};

const reply = (s, b) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(b),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});

  const qs = event.queryStringParameters || {};
  if (CRON_SECRET && qs.secret !== CRON_SECRET) return reply(401, { error: 'Unauthorized' });
  if (!SERVICE_KEY) return reply(500, { error: 'Missing SUPABASE_SERVICE_KEY' });

  const today = new Date().toISOString().slice(0, 10);

  try {
    // ── আজকে ইতিমধ্যে আছে কিনা ──
    const chk = await fetch(`${SUPABASE_URL}/rest/v1/analysis_queue?analysis_date=eq.${today}&select=id&limit=1`, { headers: SB });
    const ex  = await chk.json().catch(() => []);
    if (Array.isArray(ex) && ex.length > 0) {
      return reply(200, { note: 'আজকের queue আছে', date: today, existing: ex.length });
    }

    // ── active customers ──
    const cr = await fetch(
      `${SUPABASE_URL}/rest/v1/customers?is_active=eq.true&select=id,full_name,monthly_sub_expiry_date,sar_category&order=created_at.asc`,
      { headers: SB }
    );
    const customers = await cr.json().catch(() => []);
    if (!Array.isArray(customers) || !customers.length) {
      return reply(200, { queued: 0, note: 'কোনো active customer নেই' });
    }

    // ── priority নির্ধারণ ──
    // subscription expire-এর কাছাকাছি → priority 1
    // PR (গর্ভাবস্থা) → priority 2
    // বাকি → priority 5
    const jobs = customers.map(c => {
      const expiry = c.monthly_sub_expiry_date ? new Date(c.monthly_sub_expiry_date) : null;
      const daysLeft = expiry ? Math.ceil((expiry - Date.now()) / 86400000) : 999;
      let priority = 5;
      if (c.sar_category === 'PR') priority = 2;
      if (daysLeft <= 7) priority = 1;
      return {
        customer_id:   c.id,
        analysis_date: today,
        priority,
        status:        'PENDING',
        created_at:    new Date().toISOString(),
      };
    });

    // ── batch insert 500 করে ──
    let queued = 0;
    for (let i = 0; i < jobs.length; i += 500) {
      const batch = jobs.slice(i, i + 500);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/analysis_queue`, {
        method:  'POST',
        headers: { ...SB, Prefer: 'return=minimal' },
        body:    JSON.stringify(batch),
      });
      if (r.ok) queued += batch.length;
    }

    // ── queue-worker fire ──
    fetch(`${PUBLIC_SITE}/.netlify/functions/queue-worker`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ secret: CRON_SECRET, date: today, batch: 5 }),
    }).catch(() => {});

    return reply(200, { ok: true, date: today, total: customers.length, queued });

  } catch (e) {
    return reply(500, { error: String(e.message || e) });
  }
};

exports.config = { schedule: '0 0 * * *' };
