// netlify/functions/cleanup.js
// ═══════════════════════════════════════════════════════════════════
// SAR — Notification Worker (Email + SMS Queue Processor)
//
// কাজ:
//   • email_queue থেকে pending email পাঠায় (Resend)
//   • sms_queue থেকে pending SMS পাঠায় (sms.net.bd)
//   • failed jobs retry করে (max 3 বার)
//
// cron-job.org সেটআপ (প্রতি ঘণ্টায়):
//   URL:  https://sheairestaurant.com/.netlify/functions/cleanup?secret=SECRET&action=notify
//   Time: 0 * * * * (hourly)
//
// Netlify env: SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET
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

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB });
  return r.json().catch(() => []);
}
async function sbPatch(table, id, row) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method:  'PATCH',
    headers: { ...SB, Prefer: 'return=minimal' },
    body:    JSON.stringify(row),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});

  const qs = event.queryStringParameters || {};
  if (CRON_SECRET && qs.secret !== CRON_SECRET) return reply(401, { error: 'Unauthorized' });
  if (!SERVICE_KEY) return reply(500, { error: 'Missing SUPABASE_SERVICE_KEY' });

  const action = qs.action || (event.httpMethod === 'GET' ? 'status' : 'notify');

  // ── GET status ──
  if (action === 'status') {
    return reply(200, {
      ok: true,
      function: 'cleanup/notify-worker',
      note: 'GET ?action=notify&secret=... to process queues',
    });
  }

  // ── notify: email + SMS queue process ──
  if (action === 'notify') {
    const results = { email_sent:0, email_failed:0, sms_sent:0, sms_failed:0 };

    // ── Email Queue ──────────────────────────────
    const emails = await sbGet(
      `email_queue?status=eq.pending&retry_count=lt.3&select=*&order=created_at.asc&limit=20`
    );
    for (const eq of (Array.isArray(emails) ? emails : [])) {
      try {
        const r = await fetch(`${PUBLIC_SITE}/.netlify/functions/send-email`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to:eq.email, subject:eq.subject, html:eq.html_body }),
        });
        const d = await r.json().catch(() => ({}));
        if (d.sent || d.id) {
          await sbPatch('email_queue', eq.id, { status:'sent', sent_at:new Date().toISOString(), provider_response:d });
          results.email_sent++;
        } else {
          await sbPatch('email_queue', eq.id, { retry_count:(eq.retry_count||0)+1, status:(eq.retry_count||0)>=2?'failed':'pending', provider_response:d });
          results.email_failed++;
        }
      } catch (e) {
        await sbPatch('email_queue', eq.id, { retry_count:(eq.retry_count||0)+1, status:(eq.retry_count||0)>=2?'failed':'pending' });
        results.email_failed++;
      }
      await new Promise(r => setTimeout(r, 200));
    }

    // ── SMS Queue ──────────────────────────────
    const smsList = await sbGet(
      `sms_queue?status=eq.pending&retry_count=lt.3&select=*&order=created_at.asc&limit=20`
    );
    for (const sq of (Array.isArray(smsList) ? smsList : [])) {
      try {
        const r = await fetch(`${PUBLIC_SITE}/.netlify/functions/send-sms`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to:sq.phone, msg:sq.message }),
        });
        const d = await r.json().catch(() => ({}));
        if (d.sent) {
          await sbPatch('sms_queue', sq.id, { status:'sent', sent_at:new Date().toISOString(), provider_response:d });
          results.sms_sent++;
        } else {
          await sbPatch('sms_queue', sq.id, { retry_count:(sq.retry_count||0)+1, status:(sq.retry_count||0)>=2?'failed':'pending', provider_response:d });
          results.sms_failed++;
        }
      } catch (e) {
        await sbPatch('sms_queue', sq.id, { retry_count:(sq.retry_count||0)+1, status:(sq.retry_count||0)>=2?'failed':'pending' });
        results.sms_failed++;
      }
      await new Promise(r => setTimeout(r, 150));
    }

    return reply(200, { ok:true, ...results, processed_at:new Date().toISOString() });
  }

  // ── purge: পুরনো completed jobs মুছো ──────────
  if (action === 'purge') {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/analysis_queue?analysis_date=lt.${cutoff}&status=eq.COMPLETED`, { method:'DELETE', headers:{...SB,Prefer:'return=minimal'} }),
      fetch(`${SUPABASE_URL}/rest/v1/email_queue?created_at=lt.${cutoff + 'T00:00:00'}&status=eq.sent`, { method:'DELETE', headers:{...SB,Prefer:'return=minimal'} }),
      fetch(`${SUPABASE_URL}/rest/v1/sms_queue?created_at=lt.${cutoff + 'T00:00:00'}&status=eq.sent`, { method:'DELETE', headers:{...SB,Prefer:'return=minimal'} }),
      fetch(`${SUPABASE_URL}/rest/v1/ai_job_log?created_at=lt.${cutoff + 'T00:00:00'}`, { method:'DELETE', headers:{...SB,Prefer:'return=minimal'} }),
    ]).catch(() => {});
    return reply(200, { ok:true, purged_before:cutoff });
  }

  return reply(400, { error: 'action=notify|purge|status' });
};
