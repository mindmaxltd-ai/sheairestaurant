// netlify/functions/lib/nutrition-engine.js
// ═══════════════════════════════════════════════════════════════════
// SAR Layer 3 — Nutrition + Meal + Powder + Chutney Engine
// nutrition_reference, menu_items, medicinal_powders, medicinal_chutneys
// টেবিল থেকে ব্যক্তিগতকৃত recommendation তৈরি করে।
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
  return Array.isArray(d) ? d : [];
}

// ═══════════════════════════════════════════
// NUTRITION ENGINE
// ═══════════════════════════════════════════
async function runNutritionEngine(snapshot, ruleResult) {
  const cat = ruleResult.cat;
  const bmi = ruleResult.bmi;
  const m   = snapshot.metrics || {};
  const tc  = snapshot.today_condition || {};

  // nutrition_reference থেকে base plan
  const refRows = await sbGet(
    `nutrition_reference?category=eq.${encodeURIComponent(cat)}&select=*&limit=1`
  );
  const ref = refRows[0] || defaultNutrition(cat);

  // activity multiplier
  const actStr = (m.activity_level || '').toLowerCase();
  const actMult = /high|active/.test(actStr) ? 1.15 : /low|sedentary/.test(actStr) ? 0.9 : 1.0;

  // pregnancy +300 kcal
  const preg = cat === 'PR' ? 300 : 0;

  const calories = Math.round((ref.daily_calories + preg) * actMult / 10) * 10;

  // fever/loose motion হলে কমাও
  const sickAdj = (tc.fever || tc.loose_motion) ? 0.85 : 1.0;

  return {
    daily_calories:  Math.round(calories * sickAdj),
    protein_g:       ref.protein_g,
    carbohydrate_g:  ref.carbohydrate_g,
    fat_g:           ref.fat_g,
    fiber_g:         ref.fiber_g,
    water_liters:    tc.fever ? Math.max(ref.water_liters + 0.5, 3.0) : ref.water_liters,
    iron_mg:         ref.iron_mg,
    calcium_mg:      ref.calcium_mg,
    vitamin_d_iu:    ref.vitamin_d_iu,
    vitamin_b12_mcg: ref.vitamin_b12_mcg,
    folate_mcg:      ref.folate_mcg,
    omega3_g:        ref.omega3_g,
    glycemic_load:   ref.glycemic_load,
    focus:           nutritionFocus(cat, tc, m),
    notes:           ref.notes_bn || '',
  };
}

function nutritionFocus(cat, tc, m) {
  if (tc.fever) return 'জ্বরে হালকা খাবার — ভাত মাড়, সুপ, ডাবের পানি';
  if (tc.loose_motion) return 'ডায়রিয়া — BRAT diet, ORS, পানি';
  if (tc.period_today) return 'মাসিকে আয়রন — কলিজা, পালং শাক, ডালিম';
  const MAP = {
    DM: 'রক্তশর্করা নিয়ন্ত্রণ — Low-GI, বেশি ফাইবার, কম মিষ্টি',
    OB: 'ওজন কমানো — উচ্চ প্রোটিন, কম ক্যালরি, বেশি সবজি',
    FL: 'লিভার সুস্থতা — তেলমুক্ত, চিনিমুক্ত, হলুদ ও মেথি',
    IB: 'গাট হিলিং — Low-FODMAP, আদা, প্রোবায়োটিক',
    PR: 'গর্ভকালীন — আয়রন, ফোলেট, ক্যালসিয়াম, DHA',
    GENERAL: 'সুষম পুষ্টি — তেলমুক্ত, চিনিমুক্ত, পিংক সল্ট',
  };
  return MAP[cat] || MAP.GENERAL;
}

function defaultNutrition(cat) {
  const BASE = { daily_calories:1650, protein_g:60, carbohydrate_g:200, fat_g:45, fiber_g:25,
    water_liters:2.5, iron_mg:18, calcium_mg:1000, vitamin_d_iu:600,
    vitamin_b12_mcg:2.4, folate_mcg:400, omega3_g:1.1, glycemic_load:100 };
  if (cat==='PR') return {...BASE, daily_calories:2000, protein_g:75, iron_mg:27, folate_mcg:600};
  if (cat==='OB') return {...BASE, daily_calories:1400, protein_g:80};
  return BASE;
}

// ═══════════════════════════════════════════
// MEAL ENGINE
// ═══════════════════════════════════════════
async function runMealEngine(snapshot, ruleResult, nutritionPlan) {
  const cat = ruleResult.cat;
  const tc  = snapshot.today_condition || {};

  // menu_items থেকে এই category-র meals আনো
  const meals = await sbGet(
    `menu_items?disease_category=eq.${encodeURIComponent(cat)}&is_available=eq.true&select=menu_code,name_bn,meal_type,day,course_1_bn,course_2_bn,course_3_bn,chutney_name,calories,protein_g,benefits&order=menu_code`
  );

  if (!meals.length) {
    return buildFallbackMeals(cat, tc, nutritionPlan);
  }

  const byType = { breakfast: [], lunch: [], dinner: [] };
  for (const m of meals) {
    const t = (m.meal_type || '').toLowerCase();
    if (byType[t]) byType[t].push(m);
  }

  // আজকের weekday দিয়ে rotate
  const dayIdx = new Date().getDay(); // 0-6

  const pick = (arr) => arr.length ? arr[dayIdx % arr.length] : null;

  const breakfast = pick(byType.breakfast);
  const lunch     = pick(byType.lunch);
  const dinner    = pick(byType.dinner);

  return {
    breakfast: breakfast ? formatMeal(breakfast) : null,
    lunch:     lunch     ? formatMeal(lunch)     : null,
    dinner:    dinner    ? formatMeal(dinner)    : null,
    total_meals: [breakfast, lunch, dinner].filter(Boolean).length,
    category: cat,
    is_fever_adjusted: !!tc.fever,
    is_period_adjusted: !!tc.period_today,
  };
}

function formatMeal(m) {
  return {
    name_bn:     m.name_bn,
    menu_code:   m.menu_code,
    courses:     [m.course_1_bn, m.course_2_bn, m.course_3_bn].filter(Boolean),
    chutney:     m.chutney_name,
    calories:    m.calories,
    protein:     m.protein_g,
    benefits:    m.benefits,
  };
}

function buildFallbackMeals(cat, tc, np) {
  const MEALS = {
    DM: {
      breakfast: 'করলা-মেথি ডালিয়া + দারুচিনি চা',
      lunch:     'লাল চাল ভাত + ঢ্যাঁড়স ভাজি + মসুর ডাল',
      dinner:    'রুটি + পালং পনির + টমেটো সুপ',
    },
    OB: {
      breakfast: 'ওটস পোরিজ + চিয়া সিড + বেরি',
      lunch:     'গ্রিল মুরগি + সবজি সালাদ + ব্রাউন রাইস',
      dinner:    'ডাল সুপ + সবজি স্টিম + রুটি',
    },
    FL: {
      breakfast: 'হলুদ দুধ (ওটমিল) + আমলকি রস',
      lunch:     'ভাত + সবজি তরকারি + নিমপাতা চাটনি',
      dinner:    'বার্লি সুপ + গাজর স্টিম + রুটি',
    },
    PR: {
      breakfast: 'দুধ ওটস + খেজুর + কলা',
      lunch:     'ভাত + পালং শাক + মাছ + ডাল',
      dinner:    'রুটি + ডিম ভুনা + সবজি',
    },
    IB: {
      breakfast: 'সাদা ভাত মাড় + আদা চা',
      lunch:     'সাদা ভাত + মুরগি সুপ + কুমড়া',
      dinner:    'রুটি + ডিম সেদ্ধ + গাজর',
    },
  };
  const m = MEALS[cat] || MEALS.DM;
  return {
    breakfast: { name_bn: m.breakfast, calories: Math.round(np.daily_calories * 0.3) },
    lunch:     { name_bn: m.lunch,     calories: Math.round(np.daily_calories * 0.4) },
    dinner:    { name_bn: m.dinner,    calories: Math.round(np.daily_calories * 0.3) },
    is_fallback: true,
    category:  cat,
  };
}

// ═══════════════════════════════════════════
// POWDER ENGINE
// ═══════════════════════════════════════════
async function runPowderEngine(snapshot, ruleResult) {
  const cat = ruleResult.cat;
  const tc  = snapshot.today_condition || {};
  const isPregnant = cat === 'PR';
  const isIBS      = cat === 'IB';

  const powders = await sbGet(
    `medicinal_powders?is_active=eq.true&select=*&order=powder_code`
  );

  const suitable = powders.filter(p => {
    if (!p.disease_codes || !p.disease_codes.includes(cat)) return false;
    if (isPregnant && !p.pregnancy_safe) return false;
    if (isIBS && !p.ibs_safe) return false;
    return true;
  });

  // today condition-এ বিশেষ চাহিদা
  const condition = [];
  if (tc.fever)        condition.push({ name_bn: 'তুলসি-আদা পাউডার', dosage: '১ চা চামচ গরম পানিতে', timing: 'দিনে ৩ বার', reason: 'জ্বর কমাতে' });
  if (tc.stomach_upset) condition.push({ name_bn: 'জিরা-মৌরি পাউডার', dosage: '১ চা চামচ', timing: 'খাবার পরে', reason: 'পেটের আরামে' });
  if (tc.period_today)  condition.push({ name_bn: 'অশোক ছাল পাউডার', dosage: '১ চা চামচ', timing: 'সকালে খালি পেটে', reason: 'মাসিক ব্যথায়' });

  return {
    disease_powders:   suitable.slice(0, 3).map(p => ({
      name_bn: p.name_bn,
      dosage:  p.dosage || '১ চা চামচ',
      timing:  p.timing || 'সকালে',
      reason:  Array.isArray(p.benefits_json) ? p.benefits_json[0] || '' : '',
    })),
    condition_powders: condition.slice(0, 2),
    total: suitable.length,
  };
}

// ═══════════════════════════════════════════
// CHUTNEY ENGINE
// ═══════════════════════════════════════════
async function runChutneyEngine(snapshot, ruleResult) {
  const cat = ruleResult.cat;
  const tc  = snapshot.today_condition || {};
  const isPregnant = cat === 'PR';
  const isIBS      = cat === 'IB';
  const month = new Date().getMonth(); // 0-11
  const season = month >= 3 && month <= 9 ? 'summer' : 'winter';

  const chutneys = await sbGet(
    `medicinal_chutneys?is_active=eq.true&select=*&order=chutney_code`
  );

  const suitable = chutneys.filter(c => {
    if (!c.disease_codes || !c.disease_codes.includes(cat)) return false;
    if (isPregnant && !c.pregnancy_safe) return false;
    if (isIBS && !c.ibs_safe) return false;
    if (c.season && c.season !== 'all' && c.season !== season) return false;
    return true;
  });

  const pick = suitable[0] || fallbackChutney(cat, tc);

  return {
    recommended: {
      name_bn:      pick.name_bn,
      ingredients:  Array.isArray(pick.ingredients_json) ? pick.ingredients_json : [],
      benefits:     Array.isArray(pick.benefits_json) ? pick.benefits_json[0] || '' : '',
      serving_size: '২ চা চামচ প্রতি বেলায়',
      reason:       `${cat} রোগীদের জন্য বিশেষ উপকারী`,
    },
    total_suitable: suitable.length,
  };
}

function fallbackChutney(cat, tc) {
  if (tc.fever) return { name_bn: 'আদা-লেবু চাটনি', ingredients_json: ['আদা', 'লেবু', 'পুদিনা'], benefits_json: ['জ্বর কমায়'] };
  const MAP = {
    DM: { name_bn: 'করলা-আমলকি চাটনি', ingredients_json: ['করলা', 'আমলকি', 'জিরা'], benefits_json: ['রক্তশর্করা কমায়'] },
    OB: { name_bn: 'সবুজ ধনিয়া চাটনি', ingredients_json: ['ধনিয়া পাতা', 'পুদিনা', 'আদা'], benefits_json: ['হজম ভালো করে'] },
    FL: { name_bn: 'নিম-হলুদ চাটনি', ingredients_json: ['নিম পাতা', 'হলুদ', 'আদা'], benefits_json: ['লিভার পরিষ্কার করে'] },
    IB: { name_bn: 'জিরা-মৌরি চাটনি', ingredients_json: ['জিরা', 'মৌরি', 'আদা'], benefits_json: ['গ্যাস কমায়'] },
    PR: { name_bn: 'খেজুর-আমলকি চাটনি', ingredients_json: ['খেজুর', 'আমলকি', 'এলাচ'], benefits_json: ['আয়রন বাড়ায়'] },
  };
  return MAP[cat] || MAP.DM;
}

// ═══════════════════════════════════════════
// TREND ENGINE
// ═══════════════════════════════════════════
function runTrendEngine(snapshot, currentScore) {
  const reports = snapshot.recent_reports || [];
  const logs    = snapshot.recent_logs || [];

  if (!reports.length) return { trend: 'প্রথম রিপোর্ট', direction: 'neutral', change: 0 };

  const scores = reports.map(r => r.score || 65).slice(0, 3);
  const avgPrev = scores.reduce((a, b) => a + b, 0) / scores.length;
  const change  = Math.round(currentScore - avgPrev);

  const trend = change > 5  ? 'উন্নতি হচ্ছে 📈' :
                change < -5 ? 'অবনতি হচ্ছে 📉' : 'স্থিতিশীল ↔';

  // sleep trend
  const sleepVals  = logs.map(l => parseFloat(l.sleep_hours || 7));
  const stressVals = logs.map(l => parseInt(l.stress_level || 5));
  const avgSleep  = sleepVals.length ? sleepVals.reduce((a,b)=>a+b,0)/sleepVals.length : 7;
  const avgStress = stressVals.length ? stressVals.reduce((a,b)=>a+b,0)/stressVals.length : 5;

  return {
    trend,
    direction: change > 5 ? 'up' : change < -5 ? 'down' : 'stable',
    change,
    avg_prev_score: Math.round(avgPrev),
    days_tracked:   reports.length,
    avg_sleep_3d:   Math.round(avgSleep * 10) / 10,
    avg_stress_3d:  Math.round(avgStress * 10) / 10,
    improving_sleep:  avgSleep > 6.5,
    improving_stress: avgStress < 6,
  };
}

// ═══════════════════════════════════════════
// RISK ENGINE
// ═══════════════════════════════════════════
function runRiskEngine(snapshot, ruleResult) {
  const m   = snapshot.metrics || {};
  const cat = ruleResult.cat;
  const risks = [];

  // Diabetes complications risk
  const hba1c = parseFloat(m.hba1c || 0);
  if (cat === 'DM' && hba1c >= 9) risks.push({ type: 'ডায়াবেটিক কেটোঅ্যাসিডোসিস', level: 'critical', action: 'ডাক্তার দেখান আজই' });
  if (cat === 'DM' && hba1c >= 7.5) risks.push({ type: 'দীর্ঘমেয়াদী ডায়াবেটিস জটিলতা', level: 'high', action: 'মিষ্টি ও ভাত কমান' });

  // Cardiovascular risk
  const sys = parseFloat(m.bp_systolic || 0);
  const ldl = parseFloat(m.cholesterol_ldl || 0);
  if (sys >= 160 || ldl >= 160) risks.push({ type: 'হৃদরোগের ঝুঁকি', level: 'high', action: 'তেলমুক্ত খাবার ও হাঁটুন' });

  // Kidney risk
  const creatinine = parseFloat(m.creatinine || 0);
  if (creatinine > 1.2) risks.push({ type: 'কিডনি ক্ষতির সম্ভাবনা', level: 'medium', action: 'বেশি পানি পান করুন, লবণ কমান' });

  // Anemia risk
  const hb = parseFloat(m.hemoglobin || 0);
  if (hb > 0 && hb < 10) risks.push({ type: 'গুরুতর রক্তস্বল্পতা', level: 'high', action: 'আয়রন সমৃদ্ধ খাবার ও ডাক্তার' });

  // Vitamin D risk
  const vitD = parseFloat(m.vitamin_d || 0);
  if (vitD > 0 && vitD < 20) risks.push({ type: 'ভিটামিন D অভাব', level: 'medium', action: 'রোদ এবং ভিটামিন D সমৃদ্ধ খাবার' });

  // Pregnancy risk
  if (cat === 'PR') {
    const folate = parseFloat(m.folate || 0);
    if (folate > 0 && folate < 4) risks.push({ type: 'ফোলেট অভাব — নিউরাল টিউব ত্রুটির ঝুঁকি', level: 'critical', action: 'ফলিক এসিড সাপ্লিমেন্ট এখনই' });
  }

  // Mental health risk
  const stress = parseInt(m.stress_level || 0);
  if (stress >= 9) risks.push({ type: 'গুরুতর মানসিক চাপ', level: 'high', action: 'ধ্যান, হাঁটা ও পরিবারের সাথে কথা বলুন' });

  const overallRisk = risks.some(r => r.level === 'critical') ? 'critical' :
                      risks.some(r => r.level === 'high')     ? 'high'     :
                      risks.some(r => r.level === 'medium')   ? 'medium'   : 'low';

  return { overall: overallRisk, risks: risks.slice(0, 5), count: risks.length };
}

module.exports = {
  runNutritionEngine,
  runMealEngine,
  runPowderEngine,
  runChutneyEngine,
  runTrendEngine,
  runRiskEngine,
};
