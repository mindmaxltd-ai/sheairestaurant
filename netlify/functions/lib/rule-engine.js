// netlify/functions/lib/rule-engine.js
// ═══════════════════════════════════════════════════════════════════
// SAR Layer 2 — Rule Engine
// AI ছাড়াই deterministic health score + risk + trend calculation।
// disease_rules টেবিল থেকে rules load করে।
// ═══════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xlkrggspepnysbouatec.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const SB = {
  apikey: SERVICE_KEY,
  Authorization: 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json',
};

// rules cache (process lifetime)
let _rulesCache = null;
let _rulesCacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 মিনিট

async function loadRules() {
  if (_rulesCache && Date.now() - _rulesCacheTime < CACHE_TTL) return _rulesCache;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/disease_rules?is_active=eq.true&select=*&order=priority`,
      { headers: SB }
    );
    const d = await r.json().catch(() => []);
    _rulesCache = Array.isArray(d) ? d : [];
    _rulesCacheTime = Date.now();
  } catch { _rulesCache = []; }
  return _rulesCache;
}

/**
 * evaluate(operator, value, threshold, threshold2)
 */
function evaluate(op, val, t1, t2) {
  const v = parseFloat(val);
  if (isNaN(v)) return false;
  switch (op) {
    case 'gte':     return v >= parseFloat(t1);
    case 'lte':     return v <= parseFloat(t1);
    case 'gt':      return v > parseFloat(t1);
    case 'lt':      return v < parseFloat(t1);
    case 'eq':      return v === parseFloat(t1);
    case 'ne':      return v !== parseFloat(t1);
    case 'between': return v >= parseFloat(t1) && v <= parseFloat(t2);
    default:        return false;
  }
}

/**
 * runRuleEngine(snapshot) → result object
 */
async function runRuleEngine(snapshot) {
  const rules  = await loadRules();
  const m      = snapshot.metrics || {};
  const tc     = snapshot.today_condition || {};
  const cat    = (snapshot.customer?.sar_category || 'DM').toUpperCase();

  let score = 65;
  const triggered = [];
  const alerts = [];

  // ── DB rules চালাও ──
  for (const rule of rules) {
    if (rule.disease_code !== 'ALL' && rule.disease_code !== cat) continue;

    // metric value: metrics বা today_condition থেকে
    let rawVal = m[rule.metric_name];
    if (rawVal == null) rawVal = tc[rule.metric_name];
    if (rawVal == null) continue;

    if (evaluate(rule.operator, rawVal, rule.threshold, rule.threshold2)) {
      score += (rule.score_delta || 0);
      triggered.push({
        metric:    rule.metric_name,
        value:     rawVal,
        risk:      rule.risk_level,
        message:   rule.message_bn,
        action:    rule.action,
      });
      if (rule.risk_level === 'critical' || rule.risk_level === 'high') {
        alerts.push(rule.message_bn);
      }
    }
  }

  // ── Bonus rules (hardcoded — DB-independent) ──
  const bmi = parseFloat(m.bmi || snapshot.customer?.bmi || 0);
  if (bmi >= 18.5 && bmi < 25) score += 8;

  const hb = parseFloat(m.cholesterol_hdl || 0);
  if (hb >= 60) score += 3;

  if (tc.exercise_done) score += 5;

  const sleep = parseFloat(tc.sleep_hours || 7);
  if (sleep >= 7 && sleep <= 9) score += 3;

  const water = parseFloat(tc.water_intake || 2);
  if (water >= 2.5) score += 2;

  if (tc.fever)       score -= 5;
  if (tc.loose_motion) score -= 4;
  if (tc.stomach_upset) score -= 2;
  if (tc.period_today) { /* neutral */ }

  // ── Trend ──
  const prevReports = snapshot.recent_reports || [];
  let trend = 'স্থিতিশীল ↔';
  if (prevReports.length >= 2) {
    const prev1 = prevReports[0]?.score || 0;
    const prev2 = prevReports[1]?.score || 0;
    const avg = (prev1 + prev2) / 2;
    if (score > avg + 5)      trend = 'উন্নতি হচ্ছে 📈';
    else if (score < avg - 5) trend = 'অবনতি হচ্ছে 📉';
  }

  score = Math.max(20, Math.min(98, Math.round(score)));

  // ── Risk Level ──
  const riskLevel = score >= 75 ? 'low' : score >= 55 ? 'medium' : score >= 35 ? 'high' : 'critical';

  // ── Sub-scores ──
  const diseaseScore    = calcDiseaseScore(m, cat);
  const lifestyleScore  = calcLifestyleScore(tc, m);
  const recoveryScore   = calcRecoveryScore(tc, prevReports);

  return {
    health_score:    score,
    disease_score:   diseaseScore,
    lifestyle_score: lifestyleScore,
    recovery_score:  recoveryScore,
    risk_level:      riskLevel,
    trend,
    alerts,
    triggered_rules: triggered,
    cat,
    bmi,
  };
}

function calcDiseaseScore(m, cat) {
  let s = 70;
  if (cat === 'DM') {
    const hba1c = parseFloat(m.hba1c || 0);
    if (hba1c > 0 && hba1c < 6.5) s += 15;
    else if (hba1c < 7.5) s += 5;
    else if (hba1c >= 8) s -= 15;
  }
  if (cat === 'OB') {
    const bmi = parseFloat(m.bmi || 25);
    if (bmi < 25) s += 15;
    else if (bmi < 30) s += 0;
    else s -= 10;
  }
  const alt = parseFloat(m.alt_sgpt || 0);
  if (alt > 0 && alt < 40) s += 5;
  else if (alt >= 56) s -= 8;
  return Math.max(20, Math.min(100, s));
}

function calcLifestyleScore(tc, m) {
  let s = 65;
  const sleep = parseFloat(tc.sleep_hours || m.sleep_hours_daily || 7);
  const water = parseFloat(tc.water_intake || m.water_intake_liters || 2);
  const stress = parseInt(tc.stress_level || m.stress_level || 5);
  if (sleep >= 7) s += 10; else if (sleep < 5) s -= 10;
  if (water >= 2.5) s += 8; else if (water < 1.5) s -= 8;
  if (stress <= 3) s += 10; else if (stress >= 8) s -= 10;
  if (tc.exercise_done) s += 8;
  return Math.max(20, Math.min(100, s));
}

function calcRecoveryScore(tc, prevReports) {
  if (!prevReports.length) return 65;
  const recent = prevReports.slice(0, 3).map(r => r.score || 65);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const bonus = tc.exercise_done ? 5 : 0;
  const penalty = (tc.fever || tc.loose_motion) ? -10 : 0;
  return Math.max(20, Math.min(100, Math.round(avg + bonus + penalty)));
}

module.exports = { runRuleEngine, loadRules };
