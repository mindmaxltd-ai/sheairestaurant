// netlify/functions/prompts/daily-analysis.js
// ═══════════════════════════════════════════════════════════════════
// SAR — Daily Analysis Claude Prompt Builder
// Rule Engine result → compact AI prompt → Claude
// Token সংখ্যা সর্বনিম্ন রাখতে শুধু summary দেওয়া হয়।
// ═══════════════════════════════════════════════════════════════════

/**
 * buildDailyPrompt(snapshot, engineResults) → prompt string
 */
function buildDailyPrompt(snapshot, engineResults) {
  const { ruleResult, nutritionPlan, mealPlan, powderResult, chutneyResult, trendResult, riskResult } = engineResults;
  const cust = snapshot.customer;
  const tc   = snapshot.today_condition;
  const mem  = snapshot.memory;

  // বিশেষ দিন
  const dob = cust.date_of_birth ? new Date(cust.date_of_birth) : null;
  const today = new Date();
  const isBday = dob && dob.getDate() === today.getDate() && dob.getMonth() === today.getMonth();

  // Top risks only (token সাশ্রয়)
  const topRisks = (ruleResult.triggered_rules || [])
    .filter(r => r.risk === 'high' || r.risk === 'critical')
    .slice(0, 5)
    .map(r => `${r.message} (${r.metric}=${r.value})`);

  const summary = {
    নাম:           cust.name,
    বয়স:          cust.age,
    রোগ_বিভাগ:    ruleResult.cat,
    স্বাস্থ্য_স্কোর: ruleResult.health_score,
    ঝুঁকি_স্তর:   ruleResult.risk_level,
    প্রধান_সমস্যা: topRisks,
    প্রবণতা:       trendResult.trend,
    স্কোর_পরিবর্তন: trendResult.change,
    আজকের_অবস্থা: {
      জ্বর:     tc.fever,
      মাসিক:    tc.period_today,
      ঘুম:     `${tc.sleep_hours} ঘণ্টা`,
      স্ট্রেস: `${tc.stress_level}/10`,
      পানি:    `${tc.water_intake} লিটার`,
      ব্যায়াম:  tc.exercise_done,
      মুড:     tc.mood,
    },
    ক্যালরি_লক্ষ্য:  nutritionPlan.daily_calories,
    প্রোটিন_লক্ষ্য:  nutritionPlan.protein_g,
    পানি_লক্ষ্য:    nutritionPlan.water_liters,
    সুপারিশ_খাবার: {
      সকাল: mealPlan.breakfast?.name_bn,
      দুপুর: mealPlan.lunch?.name_bn,
      রাত:   mealPlan.dinner?.name_bn,
    },
    রোগ_পাউডার: (powderResult.disease_powders || []).map(p => p.name_bn),
    চাটনি:      chutneyResult.recommended?.name_bn,
    সামগ্রিক_ঝুঁকি: riskResult.overall,
    জরুরি_ঝুঁকি:   (riskResult.risks || []).filter(r => r.level === 'critical').map(r => r.type),
    আগের_স্মৃতি:   mem ? {
      গড়_স্কোর:        mem.avg_score,
      সাধারণ_লক্ষণ:    mem.common_symptoms,
      সফল_খাবার:       mem.successful_meals,
    } : null,
    জন্মদিন: isBday,
  };

  return `তুমি SAR (She AI Revolution) — বাংলাদেশি নারীদের জন্য AI+EI+Blockchain ভিত্তিক থেরাপিউটিক পুষ্টি ও স্বাস্থ্য প্ল্যাটফর্ম।
SAR-এর খাবার: তেলমুক্ত, চিনিমুক্ত, লবণমুক্ত (পিংক সল্ট), রংমুক্ত, আয়ুর্বেদিক, অর্গানিক।

নিচের স্বাস্থ্য সারসংক্ষেপ বিশ্লেষণ করে ব্যক্তিগতকৃত clinical reasoning দাও:

${JSON.stringify(summary, null, 2)}

নিচের JSON structure-এ উত্তর দাও — শুধু JSON, কোনো markdown বা ব্যাখ্যা নয়:
{
  "health_summary_bn": "২-৩ বাক্যে আজকের সামগ্রিক স্বাস্থ্য মূল্যায়ন",
  "problems_json": [{"সমস্যা":"নাম","কারণ":"কারণ","গুরুত্ব":"উচ্চ/মাঝারি/কম"}],
  "complications_risk_json": ["জটিলতার ঝুঁকি ১", "২"],
  "nutrition_advice_bn": "পুষ্টি পরামর্শ — SAR আয়ুর্বেদিক নীতি অনুযায়ী",
  "ayurvedic_bn": "আয়ুর্বেদিক পরামর্শ",
  "home_remedies_bn": "ঘরোয়া প্রতিকার",
  "general_suggestions_bn": "জীবনধারা পরামর্শ",
  "motivational_message_bn": "ব্যক্তিগতকৃত অনুপ্রেরণা${isBday ? ' (জন্মদিনের শুভেচ্ছাসহ)' : ''}",
  "doctor_note_bn": "ডাক্তারের জন্য সংক্ষিপ্ত নোট",
  "meal_focus_bn": "আজকের খাবারে বিশেষ মনোযোগ",
  "whatsapp_summary_bn": "২ লাইনে WhatsApp বার্তা"
}`;
}

module.exports = { buildDailyPrompt };
