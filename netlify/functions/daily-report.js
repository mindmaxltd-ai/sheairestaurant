// ════════════════════════════════════════════════════════════════
// netlify/functions/daily-report.js  v4.0
// READ-ONLY sender. All rule-engine + Claude AI work now happens in
// the Supabase Edge Function `analyze-customer` (runs earlier via
// pg_cron). This function just reads today's already-saved row from
// `ai_analysis` and sends SMS + email. No AI calls, no rule engine.
// ════════════════════════════════════════════════════════════════

const SUPA_URL = process.env.SUPABASE_URL  || 'https://xlkrggspepnysbouatec.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND   = process.env.RESEND_API_KEY   || '';
const SITE_URL = process.env.URL              || 'https://sheairestaurant.com';

const SB = { apikey:SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}`, 'Content-Type':'application/json' };
const cors = () => ({ 'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS' });
const ok  = b => ({ statusCode:200, headers:cors(), body:JSON.stringify(b) });
const err = m => ({ statusCode:500, headers:cors(), body:JSON.stringify({ error:m }) });

// Only needed to turn a category code into a Bangla label for the SMS text.
const CAT_BN = { DM:'ডায়াবেটিস', OB:'স্থূলতা', FL:'ফ্যাটি লিভার', IB:'IBS/গ্যাস্ট্রিক', PR:'গর্ভাবস্থা' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (!SUPA_KEY) return err('Missing SUPABASE_SERVICE_KEY');
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  if (body.action === 'run' && body.customer_id) {
    return ok(await processOne(body.customer_id));
  }
  const custs = await sbGet(`/rest/v1/customers?is_active=eq.true&admin_approved=eq.true&select=id,full_name,phone,email,sar_category`);
  if (!Array.isArray(custs)) return err('Cannot fetch customers');
  const results = [];
  for (const c of custs) {
    try { results.push(await processOne(c.id)); }
    catch(e) { results.push({ id:c.id, error:e.message }); }
  }
  return ok({ processed:results.length, date:today(), results });
};

// Reads today's row that analyze-customer already saved, then sends it.
async function processOne(cid) {
  const cust = await sbGetOne(`/rest/v1/customers?id=eq.${cid}&select=*`);
  if (!cust) return { id:cid, status:'skip', reason:'customer not found' };

  const analysis = await sbGetOne(
    `/rest/v1/ai_analysis?customer_id=eq.${cid}&analysis_date=eq.${today()}&analysis_type=eq.daily_report&select=*`
  );
  if (!analysis) {
    // analyze-customer hasn't run yet (or failed) for this customer today — nothing to send
    return { id:cid, status:'skip', reason:'no analysis found for today' };
  }

  const reportUrl = `${SITE_URL}/report.html?id=${analysis.id}`;
  const catBn = CAT_BN[analysis.category] || analysis.category;

  const [smsOk, emailOk] = await Promise.all([
    sendSms(cust.phone, cust.full_name, analysis.health_score, catBn, reportUrl),
    sendEmail(cust.email, cust.full_name, analysis.analysis_bn, reportUrl),
  ]);

  // record whether SMS/email actually went out, so this doesn't get resent by mistake
  await sbPatch(`/rest/v1/ai_analysis?id=eq.${analysis.id}`, { sms_sent: smsOk, email_sent: emailOk });

  return {
    id:cid, status:'ok', score:analysis.health_score, kcal:analysis.target_kcal,
    conditions:analysis.trigger_conditions, report_id:analysis.id,
    sms_sent:smsOk, email_sent:emailOk,
  };
}

async function sendSms(phone, name, score, catBn, url) {
  if (!phone) return false;
  const msg=`🌸 SAR ${today()} | ${name} | ${catBn} | স্কোর ${score}/100 | রিপোর্ট: ${url}`;
  try {
    const r = await fetch(`${SITE_URL}/.netlify/functions/send-sms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,message:msg})});
    return r.ok;
  } catch(e){ return false; }
}

async function sendEmail(email, name, html, url) {
  if (!email||!RESEND) return false;
  try {
    const r = await fetch('https://api.resend.com/emails',{method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${RESEND}`},
      body:JSON.stringify({from:'SAR Health <report@sheairestaurant.com>',to:[email],
        subject:`🌸 SAR দৈনিক রিপোর্ট — ${today()}`,html})});
    return r.ok;
  } catch(e){ return false; }
}

async function sbGet(p){const r=await fetch(`${SUPA_URL}${p}`,{headers:SB});return r.json();}
async function sbGetOne(p){const d=await sbGet(p);return Array.isArray(d)?d[0]:null;}
async function sbPatch(p,b){await fetch(`${SUPA_URL}${p}`,{method:'PATCH',headers:{...SB,Prefer:'return=minimal'},body:JSON.stringify(b)});}
function today(){return new Date().toISOString().split('T')[0];}
