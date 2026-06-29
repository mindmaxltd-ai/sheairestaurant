// netlify/functions/analyze.js
// ═══════════════════════════════════════════════════════════════════
// SAR v3.0 — Main Analysis Function
//
// এই একটা function দিয়ে একজন customer-এর সম্পূর্ণ analysis হয়:
//   Layer 1: Data Aggregation (aggregator.js)
//   Layer 2: Rule Engine (rule-engine.js)
//   Layer 3: Nutrition/Meal/Powder/Chutney/Trend/Risk Engine
//   Layer 4: Claude AI Reasoning
//   Layer 5: Save to ai_analysis + log
//
// Mode 1 — { action: "analyzeOne", customer_id: "UUID" }
//           একজন customer-এর সম্পূর্ণ analysis
//
// Mode 2 — { prompt: "raw prompt" }   (dashboard backward compat)
//           পুরনো dashboard call — raw prompt → Claude → return
//
// Mode 3 — { customer, metrics, daily_log }  (n8n backward compat)
//           পুরনো n8n call — structured data → prompt → Claude
//
// Netlify env: SUPABASE_URL, SUPABASE_SERVICE_KEY,
//              ANTHROPIC_API_KEY, OPENWEATHER_API_KEY (ঐচ্ছিক)
// ═══════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xlkrggspepnysbouatec.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.ANTHROPIC_API_KEY ||
                     process.env.CLAUDE_API_KEY    ||
                     process.env.CLAUDE_KEY         || '';

const SB = {
  apikey: SERVICE_KEY,
  Authorization: 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json',
};

const h = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
};
const ok  = body => ({ statusCode: 200, headers: h, body: JSON.stringify(body) });
const err = (code, msg) => ({ statusCode: code, headers: h, body: JSON.stringify({ error: msg }) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: h, body: '' };

  // GET: status check
  if (event.httpMethod === 'GET') {
    return ok({ ok: true, function: 'analyze v3', claude_key: CLAUDE_KEY ? 'set' : 'MISSING',
      supabase: SERVICE_KEY ? 'set' : 'MISSING' });
  }

  if (event.httpMethod !== 'POST') return err(405, 'POST only');

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Bad JSON'); }

  try {

    // ════════════════════════════════════════════════════════
    // MODE 1: Full Pipeline — analyzeOne
    // ════════════════════════════════════════════════════════
    if (body.action === 'analyzeOne' && body.customer_id) {
      const result = await runFullPipeline(body.customer_id);
      return ok(result);
    }

    // ════════════════════════════════════════════════════════
    // MODE 2: Raw Prompt (dashboard backward compat)
    // ════════════════════════════════════════════════════════
    if (body.prompt) {
      const aiResult = await callClaude(body.prompt, 2000);
      return ok({ text: aiResult.raw, parsed: aiResult.parsed, ...aiResult.parsed });
    }

    // ════════════════════════════════════════════════════════
    // MODE 3: Structured Data → Build Prompt (n8n backward compat)
    // ════════════════════════════════════════════════════════
    if (body.customer || body.metrics) {
      const prompt = buildLegacyPrompt(body.customer || {}, body.metrics || {}, body.daily_log);
      const aiResult = await callClaude(prompt, 2500);
      return ok({ text: aiResult.raw, parsed: aiResult.parsed, ...aiResult.parsed });
    }

    return err(400, 'body-তে action:"analyzeOne"+customer_id, অথবা prompt, অথবা customer+metrics দিন');

  } catch (e) {
    console.error('analyze.js error:', e);
    return err(500, e.message || String(e));
  }
};

// ═══════════════════════════════════════════════════════════════════
// FULL PIPELINE
// ═══════════════════════════════════════════════════════════════════
async function runFullPipeline(customerId) {
  const startMs = Date.now();
  const today   = new Date().toISOString().slice(0, 10);
  let aiStatus  = 'fallback';

  // ── Layer 1: Snapshot ──
  const snapshot = await buildSnapshot(customerId);
  if (!snapshot.customer.name || snapshot.customer.name === 'SAR সদস্য') {
    throw new Error('customer_not_found: ' + customerId);
  }

  // ── Layer 2: Rule Engine ──
  const ruleResult = await runRuleEngine(snapshot);

  // ── Layer 3: Engines ──
  const [nutritionPlan, mealPlan, powderResult, chutneyResult] = await Promise.all([
    runNutritionEngine(snapshot, ruleResult),
    runMealEngine(snapshot, ruleResult),
    runPowderEngine(snapshot, ruleResult),
    runChutneyEngine(snapshot, ruleResult),
  ]);
  const trendResult = runTrendEngine(snapshot, ruleResult.health_score);
  const riskResult  = runRiskEngine(snapshot, ruleResult);

  const engineResults = { ruleResult, nutritionPlan, mealPlan, powderResult, chutneyResult, trendResult, riskResult };

  // ── Layer 4: Claude AI ──
  let aiResult = null;
  let promptTokens = 0, completionTokens = 0;
  if (CLAUDE_KEY) {
    try {
      const prompt = buildDailyPrompt(snapshot, engineResults);
      const claudeOut = await callClaude(prompt, 1500);
      aiResult = claudeOut.parsed;
      aiStatus = 'success';
      promptTokens     = claudeOut.usage?.input_tokens  || 0;
      completionTokens = claudeOut.usage?.output_tokens || 0;
    } catch (e) {
      console.error('Claude failed:', e.message);
      aiStatus = 'failed';
    }
  }

  // ── Layer 5a: ai_analysis save ──
  const analysisRow = {
    customer_id:    customerId,
    analysis_date:  today,
    analysis_type:  'daily_v3',
    category:       ruleResult.cat,
    health_score:   ruleResult.health_score,
    meal_score:     ruleResult.health_score,
    daily_kcal:     nutritionPlan.daily_calories,
    daily_protein:  nutritionPlan.protein_g,
    focus:          aiResult?.meal_focus_bn || nutritionPlan.focus,
    health_summary_bn:       aiResult?.health_summary_bn || buildFallbackSummary(ruleResult),
    problems_json:           aiResult?.problems_json || ruleResult.triggered_rules?.slice(0,5).map(r=>({সমস্যা:r.message})) || [],
    complications_risk_json: aiResult?.complications_risk_json || riskResult.risks.map(r=>r.type),
    nutrition_advice_bn:     aiResult?.nutrition_advice_bn || nutritionPlan.focus,
    ayurvedic_bn:            aiResult?.ayurvedic_bn || '',
    home_remedies_bn:        aiResult?.home_remedies_bn || '',
    general_suggestions_bn:  aiResult?.general_suggestions_bn || '',
    motivational_message_bn: aiResult?.motivational_message_bn || 'সুস্বাস্থ্যের পথে আপনি সঠিক আছেন।',
    daily_menu_recommendation_json: {
      breakfast: mealPlan.breakfast,
      lunch:     mealPlan.lunch,
      dinner:    mealPlan.dinner,
    },
    result_json: {
      rule_result:    ruleResult,
      nutrition_plan: nutritionPlan,
      powder_result:  powderResult,
      chutney_result: chutneyResult,
      trend_result:   trendResult,
      risk_result:    riskResult,
      ai_status:      aiStatus,
      ai_doctor_note: aiResult?.doctor_note_bn || null,
      whatsapp_msg:   aiResult?.whatsapp_summary_bn || null,
      source:         'analyze-v3',
    },
  };

  const saveR = await fetch(`${SUPABASE_URL}/rest/v1/ai_analysis`, {
    method:  'POST',
    headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=representation' },
    body:    JSON.stringify(analysisRow),
  });
  const savedArr = await saveR.json().catch(() => []);
  const saved    = Array.isArray(savedArr) ? savedArr[0] : savedArr;

  // ── Layer 5b: reports table ──
  await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
    method:  'POST',
    headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      customer_id: customerId,
      report_date: today,
      pdf_url:     `/report.html?customer_id=${customerId}`,
      meal_score:  ruleResult.health_score,
      category:    ruleResult.cat,
    }),
  }).catch(() => {});

  // ── ai_job_log ──
  await fetch(`${SUPABASE_URL}/rest/v1/ai_job_log`, {
    method:  'POST',
    headers: { ...SB, Prefer: 'return=minimal' },
    body: JSON.stringify({
      customer_id:       customerId,
      analysis_id:       saved?.id || null,
      model:             'claude-sonnet-4-6',
      prompt_tokens:     promptTokens,
      completion_tokens: completionTokens,
      duration_ms:       Date.now() - startMs,
      status:            aiStatus === 'success' ? 'success' : (aiStatus === 'fallback' ? 'fallback' : 'failed'),
    }),
  }).catch(() => {});

  // ── email_queue + sms_queue ──
  const customer = snapshot.customer;
  const reportUrl = `https://sheairestaurant.com/report.html?customer_id=${customerId}`;
  const smsMsg = `প্রিয় ${customer.name}, আজকের SAR স্বাস্থ্য স্কোর: ${ruleResult.health_score}/100। রিপোর্ট: ${reportUrl}`;
  const emailHtml = buildEmailHtml(customer.name, ruleResult.health_score, reportUrl, aiResult?.health_summary_bn || '');

  if (customer.phone) {
    await fetch(`${SUPABASE_URL}/rest/v1/sms_queue`, {
      method:  'POST',
      headers: { ...SB, Prefer: 'return=minimal' },
      body: JSON.stringify({ customer_id: customerId, phone: customer.phone, message: smsMsg }),
    }).catch(() => {});
  }
  if (customer.email) {
    await fetch(`${SUPABASE_URL}/rest/v1/email_queue`, {
      method:  'POST',
      headers: { ...SB, Prefer: 'return=minimal' },
      body: JSON.stringify({
        customer_id: customerId,
        email:       customer.email,
        subject:     `SAR — আজকের স্বাস্থ্য রিপোর্ট (স্কোর: ${ruleResult.health_score}/100)`,
        html_body:   emailHtml,
      }),
    }).catch(() => {});
  }

  return {
    ok:             true,
    customer_id:    customerId,
    customer_name:  customer.name,
    health_score:   ruleResult.health_score,
    risk_level:     ruleResult.risk_level,
    trend:          trendResult.trend,
    ai_used:        aiStatus === 'success',
    analysis_id:    saved?.id || null,
    category:       ruleResult.cat,
    daily_kcal:     nutritionPlan.daily_calories,
    duration_ms:    Date.now() - startMs,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Claude API call
// ═══════════════════════════════════════════════════════════════════
async function callClaude(prompt, maxTokens = 1500) {
  if (!CLAUDE_KEY) return { raw: '', parsed: null, usage: null };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',   // ✅ সঠিক model name
      max_tokens: maxTokens,
      system:     'শুধুমাত্র valid JSON দাও — কোনো markdown, backtick বা ব্যাখ্যা ছাড়া।',
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Claude API ${r.status}: ${detail.slice(0, 200)}`);
  }

  const d    = await r.json();
  const raw  = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const usage = d.usage || null;

  // JSON parse
  let parsed = null;
  try {
    let clean = raw.replace(/```json|```/g, '').trim();
    const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
    if (a > -1 && b > a) clean = clean.slice(a, b + 1);
    parsed = JSON.parse(clean);
  } catch (e) {
    // truncated JSON recovery
    parsed = recoverJson(raw);
  }

  return { raw, parsed, usage };
}

function recoverJson(text) {
  const grab = (key) => {
    const m = text.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
    return m ? m[1] : null;
  };
  const grabNum = (key) => {
    const m = text.match(new RegExp('"' + key + '"\\s*:\\s*(\\d+)'));
    return m ? parseInt(m[1]) : null;
  };
  return {
    health_summary_bn:      grab('health_summary_bn') || 'বিশ্লেষণ সম্পন্ন।',
    nutrition_advice_bn:    grab('nutrition_advice_bn') || '',
    ayurvedic_bn:           grab('ayurvedic_bn') || '',
    motivational_message_bn:grab('motivational_message_bn') || 'সুস্থ থাকুন।',
    meal_focus_bn:          grab('meal_focus_bn') || '',
    _recovered: true,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ENGINES (inline — lib/ ফাইল থেকে copy করা হলে এগুলো বাদ দিন)
// ═══════════════════════════════════════════════════════════════════
async function buildSnapshot(customerId) {
  const cid = encodeURIComponent(customerId);
  const [custArr, metArr, logArr, ordArr, rxArr, aiArr, memArr] = await Promise.all([
    sbGet(`customers?id=eq.${cid}&select=full_name,phone,email,date_of_birth,blood_group,height_cm,weight_kg,bmi,sar_category,member_id,monthly_sub_expiry_date&limit=1`),
    sbGet(`customer_metrics?customer_id=eq.${cid}&select=*&limit=1`),
    sbGet(`daily_health_log?customer_id=eq.${cid}&order=log_date.desc&limit=3`),
    sbGet(`orders?customer_id=eq.${cid}&order=created_at.desc&limit=3&select=id,created_at,total_amount,status,items_json`),
    sbGet(`sar_notes?customer_id=eq.${cid}&note_type=eq.prescription&order=created_at.desc&limit=3&select=note_text_bn,created_at`),
    sbGet(`ai_analysis?customer_id=eq.${cid}&order=created_at.desc&limit=3&select=health_score,health_summary_bn,problems_json,focus,analysis_date,meal_score`),
    sbGet(`customer_ai_memory?customer_id=eq.${cid}&select=*&limit=1`),
  ]);
  const customer = custArr[0] || {};
  const metrics  = metArr[0]  || {};
  const logs     = logArr;
  const todayLog = logs[0] || {};
  const memory   = memArr[0] || null;
  let age = null;
  if (customer.date_of_birth) age = Math.floor((Date.now() - new Date(customer.date_of_birth)) / 31557600000);
  return {
    customer: { id: customerId, name: customer.full_name || '', age, phone: customer.phone, email: customer.email,
      blood_group: customer.blood_group, bmi: customer.bmi || metrics.bmi, sar_category: customer.sar_category || 'DM',
      date_of_birth: customer.date_of_birth },
    metrics: compactMetrics(metrics),
    today_condition: {
      fever: todayLog.fever||false, fever_temp: todayLog.fever_temp,
      cold_cough: todayLog.cold_cough||false, stomach_upset: todayLog.stomach_upset||false,
      loose_motion: todayLog.loose_motion||false, headache: todayLog.headache||false,
      body_pain: todayLog.body_pain||false, period_today: todayLog.period_today||false,
      cramping: todayLog.cramping||false, cramping_level: todayLog.cramping_level,
      mood: todayLog.mood||metrics.mood||null, stress_level: todayLog.stress_level||metrics.stress_level||5,
      sleep_hours: todayLog.sleep_hours||metrics.sleep_hours_daily||7, sleep_quality: todayLog.sleep_quality,
      water_intake: todayLog.water_intake||metrics.water_intake_liters||2, exercise_done: todayLog.exercise_done||false,
      exercise_type: todayLog.exercise_type, food_eaten: todayLog.food_eaten, notes: todayLog.notes,
    },
    recent_logs: logs.slice(1,3).map(l=>({date:l.log_date, stress_level:l.stress_level, sleep_hours:l.sleep_hours, mood:l.mood})),
    recent_orders: (Array.isArray(ordArr)?ordArr:[]).map(o=>({date:(o.created_at||'').slice(0,10), amount:o.total_amount, status:o.status})),
    recent_prescriptions: (Array.isArray(rxArr)?rxArr:[]).map(p=>({date:(p.created_at||'').slice(0,10), note:(p.note_text_bn||'').slice(0,200)})),
    recent_reports: (Array.isArray(aiArr)?aiArr:[]).map(r=>({date:r.analysis_date, score:r.health_score, meal_score:r.meal_score, focus:r.focus, summary:(r.health_summary_bn||'').slice(0,150), problems:Array.isArray(r.problems_json)?r.problems_json.slice(0,3):[]})),
    memory: memory ? { avg_score:memory.average_health_score, last_priority:memory.last_priority, common_symptoms:memory.common_symptoms, successful_meals:memory.successful_meals, favorite_powders:memory.favorite_powders, summary:memory.memory_summary } : null,
  };
}

async function runRuleEngine(snapshot) {
  const m = snapshot.metrics || {};
  const tc = snapshot.today_condition || {};
  const cat = normCat(snapshot.customer?.sar_category);
  let score = 65;
  const triggered = [];
  // core rules
  const rules = [
    { metric:'hba1c', op:'gte', t:8.0, delta:-10, risk:'high', msg:'HbA1c গুরুতর উচ্চ' },
    { metric:'hba1c', op:'between', t:6.5, t2:7.9, delta:-5, risk:'medium', msg:'HbA1c নিয়ন্ত্রণ প্রয়োজন' },
    { metric:'bmi',   op:'gte', t:30, delta:-8, risk:'high', msg:'গুরুতর স্থূলতা' },
    { metric:'bmi',   op:'between', t:25, t2:29.9, delta:-4, risk:'medium', msg:'অতিরিক্ত ওজন' },
    { metric:'bp_systolic', op:'gte', t:160, delta:-10, risk:'critical', msg:'উচ্চ রক্তচাপ জরুরি' },
    { metric:'bp_systolic', op:'between', t:140, t2:159, delta:-5, risk:'high', msg:'রক্তচাপ বেশি' },
    { metric:'hemoglobin', op:'lt', t:11, delta:-6, risk:'high', msg:'রক্তস্বল্পতা' },
    { metric:'alt_sgpt', op:'gte', t:56, delta:-5, risk:'medium', msg:'লিভার এনজাইম বেশি' },
    { metric:'tsh', op:'gte', t:4.5, delta:-4, risk:'medium', msg:'থাইরয়েড সমস্যা' },
    { metric:'cholesterol_ldl', op:'gte', t:160, delta:-5, risk:'high', msg:'LDL উচ্চ' },
  ];
  const allMetrics = { ...m, ...tc };
  for (const rule of rules) {
    const val = parseFloat(allMetrics[rule.metric] || 0);
    if (isNaN(val) || val === 0) continue;
    let hit = false;
    if (rule.op==='gte') hit = val >= rule.t;
    else if (rule.op==='lt') hit = val < rule.t;
    else if (rule.op==='between') hit = val >= rule.t && val <= rule.t2;
    if (hit) { score += rule.delta; triggered.push({ metric: rule.metric, value: val, risk: rule.risk, message: rule.msg }); }
  }
  // daily condition bonuses/penalties
  const sleep = parseFloat(tc.sleep_hours||7);
  const stress = parseInt(tc.stress_level||5);
  const water = parseFloat(tc.water_intake||2);
  if (sleep >= 7) score += 3; else if (sleep < 5) score -= 5;
  if (stress >= 8) score -= 5; else if (stress <= 3) score += 4;
  if (water >= 2.5) score += 2; else if (water < 1.5) score -= 3;
  if (tc.exercise_done) score += 5;
  if (tc.fever) score -= 5;
  if (tc.loose_motion) score -= 4;
  const bmi = parseFloat(m.bmi || snapshot.customer?.bmi || 0);
  if (bmi >= 18.5 && bmi < 25) score += 6;
  // trend
  const prev = snapshot.recent_reports || [];
  let trend = 'স্থিতিশীল ↔';
  if (prev.length >= 2) {
    const avg = ((prev[0]?.score||0) + (prev[1]?.score||0)) / 2;
    if (score > avg + 5) trend = 'উন্নতি হচ্ছে 📈';
    else if (score < avg - 5) trend = 'অবনতি হচ্ছে 📉';
  }
  score = Math.max(20, Math.min(98, Math.round(score)));
  const riskLevel = score >= 75 ? 'low' : score >= 55 ? 'medium' : score >= 35 ? 'high' : 'critical';
  return { health_score:score, risk_level:riskLevel, trend, triggered_rules:triggered, cat, bmi };
}

async function runNutritionEngine(snapshot, ruleResult) {
  const cat = ruleResult.cat;
  const tc  = snapshot.today_condition || {};
  const m   = snapshot.metrics || {};
  const PLANS = {
    DM:{ cal:1650, prot:65, carb:180, fat:45, fiber:30, water:2.5, focus:'রক্তশর্করা নিয়ন্ত্রণ · Low-GI' },
    OB:{ cal:1400, prot:80, carb:150, fat:40, fiber:35, water:2.0, focus:'ওজন কমানো · উচ্চ প্রোটিন' },
    FL:{ cal:1600, prot:65, carb:190, fat:35, fiber:30, water:2.5, focus:'লিভার ডিটক্স · তেলমুক্ত' },
    IB:{ cal:1600, prot:60, carb:200, fat:45, fiber:25, water:2.5, focus:'গাট হিলিং · Low-FODMAP' },
    PR:{ cal:2000, prot:75, carb:250, fat:55, fiber:28, water:3.0, focus:'আয়রন ও ফোলেট · ক্যালসিয়াম' },
    GENERAL:{ cal:1700, prot:60, carb:210, fat:47, fiber:25, water:2.5, focus:'সুষম পুষ্টি' },
  };
  const base = PLANS[cat] || PLANS.GENERAL;
  const sickAdj = (tc.fever || tc.loose_motion) ? 0.85 : 1.0;
  return {
    daily_calories: Math.round(base.cal * sickAdj),
    protein_g:      base.prot,
    carbohydrate_g: base.carb,
    fat_g:          base.fat,
    fiber_g:        base.fiber,
    water_liters:   tc.fever ? base.water + 0.5 : base.water,
    focus:          tc.fever ? 'জ্বরে হালকা খাবার — সুপ, মাড়, ডাবের পানি' :
                    tc.period_today ? 'মাসিকে আয়রন — পালং শাক, কলিজা, ডালিম' :
                    base.focus,
  };
}

async function runMealEngine(snapshot, ruleResult) {
  const cat = ruleResult.cat;
  const dayIdx = new Date().getDay();
  const meals = await sbGet(`menu_items?disease_category=eq.${encodeURIComponent(cat)}&is_available=eq.true&select=menu_code,name_bn,meal_type,course_1_bn,course_2_bn,course_3_bn,chutney_name,calories,protein_g,benefits&order=menu_code`);
  const byType = { breakfast:[], lunch:[], dinner:[] };
  for (const m of meals) { const t=(m.meal_type||'').toLowerCase(); if(byType[t]) byType[t].push(m); }
  const pick = (arr) => arr.length ? arr[dayIdx % arr.length] : null;
  const fmt  = (m) => m ? { name_bn:m.name_bn, menu_code:m.menu_code, courses:[m.course_1_bn,m.course_2_bn,m.course_3_bn].filter(Boolean), chutney:m.chutney_name, calories:m.calories, protein:m.protein_g, benefits:m.benefits } : null;
  return { breakfast:fmt(pick(byType.breakfast)), lunch:fmt(pick(byType.lunch)), dinner:fmt(pick(byType.dinner)), category:cat };
}

async function runPowderEngine(snapshot, ruleResult) {
  const cat = ruleResult.cat;
  const tc  = snapshot.today_condition || {};
  const powders = await sbGet(`medicinal_powders?is_active=eq.true&select=powder_code,name_bn,dosage,timing,benefits_json,disease_codes`);
  const suitable = powders.filter(p => Array.isArray(p.disease_codes) && p.disease_codes.includes(cat));
  const condition = [];
  if (tc.fever) condition.push({ name_bn:'তুলসি-আদা পাউডার', dosage:'১ চা চামচ গরম পানিতে', timing:'দিনে ৩ বার' });
  if (tc.period_today) condition.push({ name_bn:'অশোক ছাল পাউডার', dosage:'১ চা চামচ', timing:'সকালে খালি পেটে' });
  return {
    disease_powders:  suitable.slice(0,3).map(p=>({ name_bn:p.name_bn, dosage:p.dosage||'১ চা চামচ', timing:p.timing||'সকালে' })),
    condition_powders:condition.slice(0,2),
  };
}

async function runChutneyEngine(snapshot, ruleResult) {
  const cat = ruleResult.cat;
  const DEFAULT = { DM:'করলা-আমলকি চাটনি', OB:'সবুজ ধনিয়া চাটনি', FL:'নিম-হলুদ চাটনি', IB:'জিরা-মৌরি চাটনি', PR:'খেজুর-আমলকি চাটনি', GENERAL:'আদা-লেবু চাটনি' };
  const chutneys = await sbGet(`medicinal_chutneys?is_active=eq.true&select=chutney_code,name_bn,ingredients_json,benefits_json,disease_codes`);
  const suitable = chutneys.filter(c => Array.isArray(c.disease_codes) && c.disease_codes.includes(cat));
  const pick = suitable[0];
  return { recommended: { name_bn: pick?.name_bn || DEFAULT[cat] || DEFAULT.GENERAL, serving_size:'২ চা চামচ প্রতি বেলায়' } };
}

function runTrendEngine(snapshot, currentScore) {
  const reports = snapshot.recent_reports || [];
  if (!reports.length) return { trend:'প্রথম রিপোর্ট', direction:'neutral', change:0, days_tracked:0 };
  const scores = reports.map(r => r.score || 65);
  const avg = scores.reduce((a,b)=>a+b,0) / scores.length;
  const change = Math.round(currentScore - avg);
  return {
    trend: change > 5 ? 'উন্নতি হচ্ছে 📈' : change < -5 ? 'অবনতি হচ্ছে 📉' : 'স্থিতিশীল ↔',
    direction: change > 5 ? 'up' : change < -5 ? 'down' : 'stable',
    change, avg_prev_score: Math.round(avg), days_tracked: reports.length,
  };
}

function runRiskEngine(snapshot, ruleResult) {
  const m = snapshot.metrics || {};
  const cat = ruleResult.cat;
  const risks = [];
  if (parseFloat(m.hba1c||0) >= 9) risks.push({ type:'ডায়াবেটিক কেটোঅ্যাসিডোসিস ঝুঁকি', level:'critical', action:'ডাক্তার আজই' });
  if (parseFloat(m.bp_systolic||0) >= 160) risks.push({ type:'স্ট্রোকের ঝুঁকি', level:'critical', action:'এখনই বিশ্রাম' });
  if (parseFloat(m.hemoglobin||0) > 0 && parseFloat(m.hemoglobin||0) < 10) risks.push({ type:'গুরুতর রক্তস্বল্পতা', level:'high', action:'আয়রন সমৃদ্ধ খাবার' });
  if (cat==='PR' && parseFloat(m.folate||0) > 0 && parseFloat(m.folate||0) < 4) risks.push({ type:'ফোলেট অভাব', level:'critical', action:'ফলিক এসিড এখনই' });
  const overall = risks.some(r=>r.level==='critical') ? 'critical' : risks.some(r=>r.level==='high') ? 'high' : risks.length ? 'medium' : 'low';
  return { overall, risks:risks.slice(0,5), count:risks.length };
}

function buildDailyPrompt(snapshot, engineResults) {
  const { ruleResult, nutritionPlan, mealPlan, powderResult, trendResult, riskResult } = engineResults;
  const cust = snapshot.customer;
  const tc   = snapshot.today_condition;
  const mem  = snapshot.memory;
  const dob  = cust.date_of_birth ? new Date(cust.date_of_birth) : null;
  const isBday = dob && dob.getDate()===new Date().getDate() && dob.getMonth()===new Date().getMonth();
  const summary = {
    নাম: cust.name, বয়স: cust.age, রোগ_বিভাগ: ruleResult.cat,
    স্বাস্থ্য_স্কোর: ruleResult.health_score, ঝুঁকি_স্তর: ruleResult.risk_level,
    প্রধান_সমস্যা: (ruleResult.triggered_rules||[]).filter(r=>r.risk==='high'||r.risk==='critical').slice(0,5).map(r=>r.message),
    প্রবণতা: trendResult.trend, স্কোর_পরিবর্তন: trendResult.change,
    আজকের_অবস্থা: { জ্বর:tc.fever, মাসিক:tc.period_today, ঘুম:`${tc.sleep_hours}ঘ`, স্ট্রেস:`${tc.stress_level}/10`, পানি:`${tc.water_intake}লি`, ব্যায়াম:tc.exercise_done, মুড:tc.mood },
    ক্যালরি: nutritionPlan.daily_calories, প্রোটিন: nutritionPlan.protein_g,
    সকালের_খাবার: mealPlan.breakfast?.name_bn, দুপুরের_খাবার: mealPlan.lunch?.name_bn, রাতের_খাবার: mealPlan.dinner?.name_bn,
    রোগ_পাউডার: (powderResult.disease_powders||[]).map(p=>p.name_bn),
    সামগ্রিক_ঝুঁকি: riskResult.overall,
    জরুরি_ঝুঁকি: riskResult.risks.filter(r=>r.level==='critical').map(r=>r.type),
    স্মৃতি: mem ? { গড়_স্কোর:mem.avg_score, লক্ষণ:mem.common_symptoms } : null,
    জন্মদিন: isBday,
  };
  return `তুমি SAR (She AI Revolution) নারী স্বাস্থ্য AI। পরামর্শ বৈজ্ঞানিক ও আয়ুর্বেদিক। SAR খাবার: তেলমুক্ত, চিনিমুক্ত, পিংক সল্ট, রংমুক্ত, আয়ুর্বেদিক, অর্গানিক।\n\n${JSON.stringify(summary, null, 2)}\n\nশুধু JSON:\n{"health_summary_bn":"...","problems_json":[{"সমস্যা":"...","কারণ":"...","গুরুত্ব":"..."}],"complications_risk_json":["..."],"nutrition_advice_bn":"...","ayurvedic_bn":"...","home_remedies_bn":"...","general_suggestions_bn":"...","motivational_message_bn":"...","doctor_note_bn":"...","meal_focus_bn":"...","whatsapp_summary_bn":"..."}`;
}

// ═══════════════════════════════════════════════════════════════════
// LEGACY prompt builder (Mode 3)
// ═══════════════════════════════════════════════════════════════════
function buildLegacyPrompt(customer, metrics, daily_log) {
  const catMap = { DM:'ডায়াবেটিস', OB:'স্থূলতা', FL:'ফ্যাটি লিভার', IB:'IBS/গ্যাস্ট্রিক', PR:'গর্ভাবস্থা' };
  const skip   = new Set(['id','customer_id','created_at','updated_at']);
  const mStr   = Object.entries(metrics).filter(([k,v])=>v!=null&&v!==''&&!skip.has(k)).map(([k,v])=>`${k}: ${v}`).join('\n') || 'নেই';
  const log    = daily_log || {};
  const lStr   = daily_log ? `জ্বর:${log.fever?'হ্যাঁ':'না'} স্ট্রেস:${log.stress_level||5}/10 ঘুম:${log.sleep_hours||7}ঘ পানি:${log.water_intake||2}লি ব্যায়াম:${log.exercise_done?'হ্যাঁ':'না'} মাসিক:${log.period_today?'হ্যাঁ':'না'}` : 'আপডেট নেই';
  return `তুমি SAR নারী স্বাস্থ্য AI।\nগ্রাহক: ${customer.full_name||'SAR সদস্য'}\nরোগ: ${catMap[customer.sar_category]||'DM'}\nমেট্রিক্স:\n${mStr}\nআজকের অবস্থা: ${lStr}\nশুধু JSON:\n{"health_score":70,"analysis_bn":"...","problems":["..."],"solutions":["..."],"ayurvedic":["..."],"home_remedy":["..."],"recommendations":"...","daily_menu":{"breakfast":{"name":"...","calories":280},"lunch":{"name":"...","calories":420},"dinner":{"name":"...","calories":350}},"whatsapp_summary":"..."}`;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════
async function sbGet(path) {
  if (!SERVICE_KEY) return [];
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB });
  const d = await r.json().catch(() => []);
  return Array.isArray(d) ? d : [];
}

function compactMetrics(m) {
  const skip = new Set(['id','customer_id','created_at','updated_at','registration_completed_at','photo_url','password_hash']);
  const out = {};
  for (const [k, v] of Object.entries(m || {})) {
    if (skip.has(k)) continue;
    if (v == null || v === '' || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

function normCat(v) {
  if (!v) return 'DM';
  const s = String(v).split(/[,\s]+/)[0].trim().toUpperCase();
  return ['DM','OB','FL','IB','PR','GENERAL'].includes(s) ? s : 'DM';
}

function buildFallbackSummary(ruleResult) {
  return `আজকের স্বাস্থ্য স্কোর ${ruleResult.health_score}/100। ${ruleResult.trend}। ${(ruleResult.triggered_rules||[]).slice(0,2).map(r=>r.message).join(', ')}`;
}

function buildEmailHtml(name, score, reportUrl, summary) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:1rem">
    <div style="text-align:center;background:linear-gradient(135deg,#E91E8C,#F4631E);padding:1.5rem;border-radius:12px;margin-bottom:1.5rem">
      <h1 style="color:#fff;margin:0;font-size:1.4rem">🌸 SAR — আজকের স্বাস্থ্য রিপোর্ট</h1>
    </div>
    <p>প্রিয় ${name},</p>
    <div style="background:#f0fdf4;border-left:4px solid #059669;padding:1rem;border-radius:8px;margin:1rem 0">
      <strong>আজকের স্বাস্থ্য স্কোর: ${score}/100</strong>
      <p style="margin:.5rem 0 0;color:#555">${summary}</p>
    </div>
    <a href="${reportUrl}" style="display:block;text-align:center;background:#059669;color:#fff;padding:.8rem;border-radius:8px;text-decoration:none;margin:1rem 0">📄 পূর্ণ রিপোর্ট দেখুন</a>
    <p style="color:#999;font-size:.75rem;text-align:center;margin-top:1.5rem">SAR — women-led · women-run · women-only · AI + EI + Blockchain</p>
  </div>`;
}
