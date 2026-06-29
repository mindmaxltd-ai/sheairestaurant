// netlify/functions/lib/aggregator.js
// ═══════════════════════════════════════════════════════════════════
// SAR Layer 1 — Data Aggregator
// Customer-এর সব data একটা compact snapshot JSON-এ আনে।
// Claude-কে raw DB দেওয়া হয় না — শুধু এই snapshot যায়।
// ═══════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xlkrggspepnysbouatec.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const SB = {
  apikey: SERVICE_KEY,
  Authorization: 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json',
};

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB });
  const d = await r.json().catch(() => []);
  return Array.isArray(d) ? d : (d ? [d] : []);
}

// ── skip এই column গুলো (ভারী কিন্তু অপ্রয়োজনীয়) ──
const SKIP_COLS = new Set([
  'id','created_at','updated_at','registration_completed_at',
  'photo_url','password_hash','referral_code','nid_number',
]);

function compactMetrics(m) {
  if (!m) return {};
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    if (SKIP_COLS.has(k)) continue;
    if (v == null || v === '' || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/**
 * buildSnapshot(customerId) → snapshot object
 * সব source parallel-এ fetch করে একটা object তৈরি করে।
 */
async function buildSnapshot(customerId) {
  const cid = encodeURIComponent(customerId);
  const today = new Date().toISOString().slice(0, 10);

  const [custArr, metArr, logArr, ordArr, rxArr, aiArr, memArr] = await Promise.all([
    sbGet(`customers?id=eq.${cid}&select=full_name,phone,email,date_of_birth,blood_group,height_cm,weight_kg,bmi,sar_category,member_id,monthly_sub_expiry_date,membership_tier,registration_date&limit=1`),
    sbGet(`customer_metrics?customer_id=eq.${cid}&select=*&limit=1`),
    sbGet(`daily_health_log?customer_id=eq.${cid}&order=log_date.desc&limit=3`),
    sbGet(`orders?customer_id=eq.${cid}&order=created_at.desc&limit=3&select=id,created_at,total_amount,status,items_json`),
    sbGet(`sar_notes?customer_id=eq.${cid}&note_type=eq.prescription&order=created_at.desc&limit=3&select=note_text_bn,created_at,rx_status`),
    sbGet(`ai_analysis?customer_id=eq.${cid}&order=created_at.desc&limit=3&select=health_score,health_summary_bn,problems_json,focus,analysis_date,meal_score`),
    sbGet(`customer_ai_memory?customer_id=eq.${cid}&select=*&limit=1`),
  ]);

  const customer = custArr[0] || {};
  const metrics  = metArr[0]  || {};
  const logs     = logArr;
  const orders   = ordArr;
  const prescriptions = rxArr;
  const prevReports   = aiArr;
  const memory        = memArr[0] || null;

  // আজকের log (সবচেয়ে সাম্প্রতিক)
  const todayLog = logs[0] || {};

  // বয়স হিসাব
  let age = null;
  if (customer.date_of_birth) {
    age = Math.floor((Date.now() - new Date(customer.date_of_birth)) / 31557600000);
  }

  const snapshot = {
    // ── Customer Profile ──
    customer: {
      id:           customerId,
      name:         customer.full_name || 'SAR সদস্য',
      age,
      phone:        customer.phone,
      email:        customer.email,
      blood_group:  customer.blood_group,
      height_cm:    customer.height_cm,
      weight_kg:    customer.weight_kg,
      bmi:          customer.bmi || metrics.bmi,
      sar_category: customer.sar_category || 'DM',
      member_id:    customer.member_id,
      sub_expiry:   customer.monthly_sub_expiry_date,
    },

    // ── 250 Metrics (compact) ──
    metrics: compactMetrics(metrics),

    // ── আজকের অবস্থা ──
    today_condition: {
      date:          today,
      fever:         todayLog.fever || false,
      fever_temp:    todayLog.fever_temp,
      cold_cough:    todayLog.cold_cough || false,
      stomach_upset: todayLog.stomach_upset || false,
      loose_motion:  todayLog.loose_motion || false,
      headache:      todayLog.headache || false,
      body_pain:     todayLog.body_pain || false,
      period_today:  todayLog.period_today || false,
      cramping:      todayLog.cramping || false,
      cramping_level:todayLog.cramping_level,
      mood:          todayLog.mood || metrics.mood || null,
      stress_level:  todayLog.stress_level || metrics.stress_level || 5,
      sleep_hours:   todayLog.sleep_hours || metrics.sleep_hours_daily || 7,
      sleep_quality: todayLog.sleep_quality,
      water_intake:  todayLog.water_intake || metrics.water_intake_liters || 2,
      exercise_done: todayLog.exercise_done || false,
      exercise_type: todayLog.exercise_type,
      food_eaten:    todayLog.food_eaten,
      avoid_foods:   todayLog.avoid_foods,
      notes:         todayLog.notes,
    },

    // ── গত ৩ দিনের log (trend-এর জন্য) ──
    recent_logs: logs.slice(1, 3).map(l => ({
      date:         l.log_date,
      stress_level: l.stress_level,
      sleep_hours:  l.sleep_hours,
      water_intake: l.water_intake,
      exercise_done:l.exercise_done,
      mood:         l.mood,
    })),

    // ── সর্বশেষ ৩টি অর্ডার ──
    recent_orders: orders.map(o => ({
      date:   (o.created_at || '').slice(0, 10),
      amount: o.total_amount,
      status: o.status,
      items:  Array.isArray(o.items_json)
        ? o.items_json.slice(0, 3).map(i => i.name_bn || i.name || '').filter(Boolean)
        : [],
    })),

    // ── সর্বশেষ ৩টি প্রেসক্রিপশন ──
    recent_prescriptions: prescriptions.map(p => ({
      date:   (p.created_at || '').slice(0, 10),
      note:   (p.note_text_bn || '').slice(0, 300),
      status: p.rx_status,
    })),

    // ── সর্বশেষ ৩টি AI রিপোর্ট ──
    recent_reports: prevReports.map(r => ({
      date:        r.analysis_date,
      score:       r.health_score,
      meal_score:  r.meal_score,
      focus:       r.focus,
      summary:     (r.health_summary_bn || '').slice(0, 200),
      problems:    Array.isArray(r.problems_json) ? r.problems_json.slice(0, 3) : [],
    })),

    // ── AI Memory ──
    memory: memory ? {
      avg_score:        memory.average_health_score,
      last_priority:    memory.last_priority,
      last_warning:     memory.last_warning,
      common_symptoms:  memory.common_symptoms,
      successful_meals: memory.successful_meals,
      favorite_powders: memory.favorite_powders,
      summary:          memory.memory_summary,
    } : null,

    generated_at: new Date().toISOString(),
  };

  return snapshot;
}

/**
 * saveSnapshot(customerId, snapshot) → Supabase-এ upsert
 */
async function saveSnapshot(customerId, snapshot) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/customer_ai_snapshot`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      customer_id:   customerId,
      snapshot_date: today,
      snapshot_json: snapshot,
      updated_at:    new Date().toISOString(),
    }),
  });
  return r.ok;
}

module.exports = { buildSnapshot, saveSnapshot };
