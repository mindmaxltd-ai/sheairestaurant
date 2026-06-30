// ════════════════════════════════════════════════════════════════
// netlify/functions/daily-report.js  v3.0
// Uses sar_rule_engine.js — 90% Rule Engine, 10% AI text only
// ════════════════════════════════════════════════════════════════

const RE = require('./sar_rule_engine');

const SUPA_URL = process.env.SUPABASE_URL  || 'https://xlkrggspepnysbouatec.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE   = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '';
const RESEND   = process.env.RESEND_API_KEY   || '';
const SITE_URL = process.env.URL              || 'https://sheairestaurant.com';

const SB = { apikey:SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}`, 'Content-Type':'application/json' };
const cors = () => ({ 'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS' });
const ok  = b => ({ statusCode:200, headers:cors(), body:JSON.stringify(b) });
const err = m => ({ statusCode:500, headers:cors(), body:JSON.stringify({ error:m }) });

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

async function processOne(cid) {
  const [cust, metrics] = await Promise.all([
    sbGetOne(`/rest/v1/customers?id=eq.${cid}&select=*`),
    sbGetOne(`/rest/v1/customer_metrics?customer_id=eq.${cid}&select=*`),
  ]);
  if (!cust) return { status:'skip' };
  const m = metrics || {};
  const re = RE.runFullRuleEngine(cust, m);
  let aiText = null;
  if (CLAUDE) aiText = await getAiText(re.miniPrompt);
  const rpt = mergeReport(re, aiText);
  const html = buildHtml(cust, m, re, rpt);
  const saved = await saveToAnalysis(cid, re, rpt, html);
  const reportUrl = `${SITE_URL}/report.html?id=${saved?.id||cid}`;
  await Promise.all([
    sendSms(cust.phone, cust.full_name, re.score, re.cat_bn, reportUrl),
    sendEmail(cust.email, cust.full_name, html, reportUrl),
  ]);
  return { status:'ok', score:re.score, kcal:re.targetKcal, conditions:re.conditions, report_id:saved?.id };
}

async function getAiText(prompt) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'Content-Type':'application/json','x-api-key':CLAUDE,'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:800, messages:[{ role:'user', content:prompt }] }),
    });
    const d = await r.json();
    let raw = (d.content||[]).map(b=>b.text||'').join('').trim().replace(/```json|```/g,'').trim();
    const a=raw.indexOf('{'), b=raw.lastIndexOf('}');
    if (a>-1&&b>-1) return JSON.parse(raw.slice(a,b+1));
  } catch(e) { console.error('AI err:',e.message); }
  return null;
}

function mergeReport(re, ai) {
  const condBn = re.conditions.map(c=>RE.CONDITION_PROFILES[c]?.name_bn||c).join(', ')||'স্বাভাবিক';
  const dp1 = re.disease_powder_1, dp2 = re.disease_powder_2;
  const FB = {
    problems:    re.conditions.length?`আজকে ${condBn} লক্ষ্য করা গেছে। ${re.calorieReason}`:'আজকে কোনো বিশেষ সমস্যা নেই।',
    cautions:    re.conditions.includes('fever')?'প্রচুর পানি পান করুন। বিশ্রাম নিন।':'নিয়মিত পানি পান করুন।',
    home_remedy: re.conditions.includes('fever')?'তুলসি+আদা+লেবু উষ্ণ পানিতে পান করুন। ডাবের পানি খান।':'সকালে আমলকীর রস পান করুন।',
    ayurvedic:   `${dp1?.name}: ${dp1?.dose}। ${dp2?.name}: ${dp2?.dose}।`,
    islamic:     'বিসমিল্লাহ বলে খাবার শুরু করুন। রাসুল (সাঃ): "পেটের এক তৃতীয়াংশ খাবার, এক তৃতীয়াংশ পানি, এক তৃতীয়াংশ বায়ুর জন্য রাখো।" (তিরমিজি) সুরা ফাতিহা পড়ুন।',
    meditation:  '৫ মিনিট ৪-৪-৬ শ্বাস পদ্ধতি। সকালে ১০ মিনিট মেডিটেশন।',
    exercise:    (re.conditions.includes('fever')||re.conditions.includes('diarrhea')||re.conditions.includes('dysentery'))?'আজকে পূর্ণ বিশ্রাম নিন।':'হালকা হাঁটা ২০ মিনিট + যোগব্যায়াম।',
    dos:         'পর্যাপ্ত পানি পান করুন (৮ গ্লাস)। SAR থেরাপিউটিক মিল গ্রহণ করুন। সময়মতো ঘুমান।',
    donts:       'তেলযুক্ত খাবার এড়িয়ে চলুন। রাত ১০টার পর ভারী খাবার নয়। অতিরিক্ত চা-কফি পরিহার করুন।',
    general:     `স্বাস্থ্য স্কোর ${re.score}/100। ${re.cat_bn} ক্যাটাগরিতে আজকের ক্যালরি লক্ষ্য ${re.targetKcal} kcal।`,
    meal_rx:     `${re.suggestedMeal.name} — ${re.targetKcal} kcal, প্রোটিন ${re.targetProtein}g, ফাইবার ${re.targetFiber}g।`,
  };
  return Object.fromEntries(Object.keys(FB).map(k=>[k, ai?.[k]||FB[k]]));
}

function buildHtml(cust, m, re, rpt) {
  const name=cust.full_name||'SAR সদস্যা', dt=today();
  const scoreColor=re.score>=80?'#059669':re.score>=60?'#D97706':'#DC2626';
  const mealUrl=`${SITE_URL}/meal-score.html?cat=${re.cat}`;
  const condTags=re.conditions.length
    ? re.conditions.map(c=>`<span class="tag">${RE.CONDITION_PROFILES[c]?.name_bn||c}</span>`).join('')
    : '<span class="tag-ok">✅ স্বাভাবিক</span>';
  const dvRows=re.dvTargets.map(d=>`<tr><td>${d.name}</td><td>${d.today_target}${d.name.includes('ক্যালরি')?'kcal':'g'}</td><td style="color:${d.pct>100?'#059669':'#D97706'};font-weight:700">${d.pct}%</td><td style="font-size:10px">${d.note}</td></tr>`).join('');
  const nutRows=re.nutrients.map(n=>`<tr><td>${n.rank}. <b>${n.name}</b></td><td>${n.target_g?n.target_g+'g':n.target_mg?n.target_mg+'mg':n.target_mcg?n.target_mcg+'mcg':n.target_iu?n.target_iu+' IU':'✓'}</td><td style="font-size:11px">${n.benefit}</td></tr>`).join('');

  return `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAR রিপোর্ট — ${name} — ${dt}</title>
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Hind Siliguri',sans-serif;background:#FFF8F4;color:#1a1a1a;font-size:14px;line-height:1.6}.page{max-width:720px;margin:0 auto;padding:20px 14px}.hdr{background:linear-gradient(135deg,#E91E8C,#6B21A8);color:#fff;border-radius:16px;padding:20px;margin-bottom:14px;text-align:center}.hdr h1{font-size:20px;font-weight:700}.hdr p{font-size:12px;opacity:.88}.info-box{background:#fff;border-radius:12px;padding:14px;margin-bottom:12px;display:grid;grid-template-columns:1fr 1fr;gap:6px;box-shadow:0 1px 4px rgba(0,0,0,.07)}.info-row{font-size:12px;color:#555}.info-row b{color:#1a1a1a}.score-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}.score-card{background:#fff;border-radius:12px;padding:12px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.07)}.snum{font-size:26px;font-weight:700;line-height:1}.slbl{font-size:10px;color:#666;margin-top:3px}.sec{background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.06)}.sec-title{font-size:13px;font-weight:700;margin-bottom:10px}.tag{display:inline-block;background:#FCE7F3;color:#9D174D;padding:3px 10px;border-radius:50px;font-size:12px;font-weight:500;margin:2px}.tag-ok{display:inline-block;background:#D1FAE5;color:#065F46;padding:3px 10px;border-radius:50px;font-size:12px}.cal-box{background:#FFF0F7;border:1px solid #F9A8D4;border-radius:8px;padding:10px;margin:8px 0}.cal-num{font-size:22px;font-weight:700;color:#E91E8C}.cal-note{font-size:11px;color:#666}.ing-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.ing-item{background:#F0FDF4;border:1px solid #BBF7D0;border-radius:7px;padding:8px}.ing-lbl{font-size:10px;color:#065F46;font-weight:700;margin-bottom:2px}.ing-val{font-size:12px}.plate-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.plate-card{background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:10px}.plate-title{font-size:10px;font-weight:700;color:#92400E;margin-bottom:4px}.plate-name{font-size:12px;font-weight:600;margin-bottom:3px}.plate-dose{font-size:10px;color:#666;margin-bottom:3px}.plate-benefit{font-size:10px;color:#059669}table{width:100%;border-collapse:collapse;margin-bottom:6px}th{background:#F3F4F6;font-size:11px;padding:6px;text-align:left;color:#374151;font-weight:600}td{font-size:11px;padding:5px 6px;border-bottom:1px solid #F3F4F6;color:#374151}tr:last-child td{border-bottom:none}.rpt-item{padding:8px 0;border-bottom:1px solid #F3F4F6}.rpt-item:last-child{border-bottom:none}.rpt-label{font-size:12px;font-weight:700;color:#6B21A8;margin-bottom:3px}.rpt-text{font-size:13px;color:#374151;line-height:1.65}.ben-list li{font-size:12px;color:#374151;margin-bottom:5px;list-style:none}.cta{background:linear-gradient(135deg,#E91E8C,#6B21A8);color:#fff;border-radius:12px;padding:16px;text-align:center;margin-top:4px}.cta a{color:#fff;text-decoration:none;font-weight:700;font-size:15px}.cta p{font-size:12px;opacity:.85;margin-top:4px}.footer{text-align:center;font-size:11px;color:#9CA3AF;margin-top:14px;line-height:1.7}@media(max-width:500px){.score-row,.plate-grid,.ing-grid{grid-template-columns:1fr 1fr}.info-box{grid-template-columns:1fr}}@media print{body{background:#fff}.hdr,.cta{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>
</head><body><div class="page">
<div class="hdr"><h1>🌸 SAR দৈনিক স্বাস্থ্য রিপোর্ট</h1><p>${name} — ${re.cat_bn} | 📅 ${dt} | Rule Engine v3.0</p></div>
<div class="info-box">
  <div class="info-row">👤 <b>${name}</b></div><div class="info-row">📱 <b>${cust.phone||'—'}</b></div>
  <div class="info-row">🩺 রোগ: <b>${re.cat_bn}</b></div><div class="info-row">📏 BMI: <b>${re.bmi}</b></div>
  <div class="info-row">⚖️ ওজন: <b>${m.weight_kg||m.today_weight_kg||'—'} kg</b></div><div class="info-row">🆔 <b>${cust.member_id||'—'}</b></div>
</div>
<div class="score-row">
  <div class="score-card"><div class="snum" style="color:${scoreColor}">${re.score}</div><div class="slbl">স্বাস্থ্য স্কোর /100</div></div>
  <div class="score-card"><div class="snum" style="color:#E91E8C">${re.targetKcal}</div><div class="slbl">ক্যালরি kcal</div></div>
  <div class="score-card"><div class="snum" style="color:#6B21A8">${re.targetProtein}g</div><div class="slbl">প্রোটিন</div></div>
  <div class="score-card"><div class="snum" style="color:#059669">${re.targetFiber}g</div><div class="slbl">ফাইবার</div></div>
</div>
<div class="sec"><div class="sec-title">🩺 আজকের অবস্থা</div>${condTags}
${re.conditions.length?`<div class="cal-box"><div class="cal-num">${re.targetKcal} kcal</div><div class="cal-note">×${re.multiplier} | ${re.calorieReason}</div></div>`:''}
</div>
<div class="sec"><div class="sec-title">💊 ৭টি জরুরি পুষ্টি উপাদান</div>
<table><tr><th>#</th><th>পুষ্টি</th><th>লক্ষ্যমাত্রা</th><th>উপকার</th></tr>${nutRows}</table></div>
<div class="sec"><div class="sec-title">📊 দৈনিক চাহিদা % DV</div>
<table><tr><th>পুষ্টি</th><th>আজকের লক্ষ্য</th><th>% DV</th><th>নোট</th></tr>${dvRows}</table></div>
<div class="sec"><div class="sec-title">🌿 থেরাপিউটিক উপাদান</div>
<div class="ing-grid">
  <div class="ing-item"><div class="ing-lbl">🌾 শস্য</div><div class="ing-val">${re.ingredients.grain}</div></div>
  <div class="ing-item"><div class="ing-lbl">🥩 প্রোটিন</div><div class="ing-val">${re.ingredients.protein}</div></div>
  <div class="ing-item"><div class="ing-lbl">🥦 সবজি</div><div class="ing-val">${re.ingredients.veg}</div></div>
  <div class="ing-item"><div class="ing-lbl">🌱 শাকপাতা</div><div class="ing-val">${re.ingredients.leafy}</div></div>
  <div class="ing-item"><div class="ing-lbl">🌰 বীজ</div><div class="ing-val">${re.ingredients.seed}</div></div>
  ${re.ingredients.extra?`<div class="ing-item"><div class="ing-lbl">✨ বিশেষ সংযোজন</div><div class="ing-val">${re.ingredients.extra}</div></div>`:''}
</div>
${re.ingredients.removed?`<div style="margin-top:8px;font-size:11px;color:#991B1B;background:#FEE2E2;padding:6px 10px;border-radius:6px">⚠️ আজকে এড়িয়ে চলুন: ${re.ingredients.removed}</div>`:''}
</div>
<div class="sec"><div class="sec-title">🍽️ থেরাপিউটিক প্লেট</div>
<div class="plate-grid">
  <div class="plate-card"><div class="plate-title">🫙 চাটনি</div><div class="plate-name">${re.disease_chutney?.name}</div><div class="plate-benefit">✦ ${re.disease_chutney?.benefit}</div></div>
  <div class="plate-card"><div class="plate-title">✨ টপিং</div><div class="plate-name">${re.final_topping}</div><div class="plate-benefit">✦ ${re.disease_topping?.benefit}</div></div>
  <div class="plate-card"><div class="plate-title">💊 রোগ পাউডার ১</div><div class="plate-name">${re.disease_powder_1?.name}</div><div class="plate-dose">${re.disease_powder_1?.dose}</div><div class="plate-benefit">✦ ${re.disease_powder_1?.benefit}</div></div>
  <div class="plate-card"><div class="plate-title">💊 রোগ পাউডার ২</div><div class="plate-name">${re.disease_powder_2?.name}</div><div class="plate-dose">${re.disease_powder_2?.dose}</div><div class="plate-benefit">✦ ${re.disease_powder_2?.benefit}</div></div>
  ${re.condition_powder?`<div class="plate-card"><div class="plate-title">🔥 অবস্থার পাউডার</div><div class="plate-name">${re.condition_powder.name}</div><div class="plate-dose">${re.condition_powder.dose}</div><div class="plate-benefit">✦ ${re.condition_powder.benefit}</div></div>`:''}
  ${re.condition_chutney?`<div class="plate-card"><div class="plate-title">🫙 অবস্থার চাটনি</div><div class="plate-name">${re.condition_chutney.name}</div><div class="plate-benefit">✦ ${re.condition_chutney.benefit}</div></div>`:''}
</div></div>
<div class="sec"><div class="sec-title">💚 ৫টি সামগ্রিক উপকার</div>
<ul class="ben-list">
  <li>🍱 <b>মিল:</b> ${re.benefits.meal_overall}</li>
  <li>🌿 <b>উপাদান:</b> ${re.benefits.ingredients_bn}</li>
  <li>🫙 <b>চাটনি:</b> ${re.benefits.chutney_bn}</li>
  <li>💊 <b>পাউডার:</b> ${re.benefits.disease_powder_bn}</li>
  <li>✨ <b>টপিং:</b> ${re.benefits.topping_bn}</li>
</ul></div>
<div class="sec"><div class="sec-title">📋 ব্যক্তিগত পরামর্শ</div>
${[['⚠️ সমস্যা','problems'],['🚨 সতর্কতা','cautions'],['🏠 ঘরোয়া উপায়','home_remedy'],['🌿 আয়ুর্বেদিক','ayurvedic'],['🕌 ইসলামিক দোয়া','islamic'],['🧘 মেডিটেশন','meditation'],['🏃 ব্যায়াম','exercise'],['✅ করণীয়','dos'],['❌ বর্জনীয়','donts'],['💬 সাধারণ','general'],['🍱 মিল Rx','meal_rx']].map(([l,k])=>`<div class="rpt-item"><div class="rpt-label">${l}</div><div class="rpt-text">${rpt[k]}</div></div>`).join('')}
</div>
<div class="cta"><a href="${mealUrl}">🥗 আজকের মিল অর্ডার করুন →</a><p>${re.suggestedMeal.name} — ${re.targetKcal} kcal | প্রোটিন ${re.targetProtein}g</p></div>
<div class="footer">SAR She AI Revolution — শুধুমাত্র নারীদের জন্য<br>এই রিপোর্ট চিকিৎসা পরামর্শ নয়। sheairestaurant.com</div>
</div></body></html>`;
}

async function saveToAnalysis(cid, re, rpt, html) {
  const row = {
    customer_id:cid, score_date:today(), analysis_type:'daily_report', category:re.cat,
    health_score:re.score, trigger_conditions:re.conditions, calorie_multiplier:re.multiplier,
    target_kcal:re.targetKcal, target_protein_g:re.targetProtein, target_fiber_g:re.targetFiber,
    ingredients_json:re.ingredients, chutney_selected:re.final_chutney, topping_selected:re.final_topping,
    powder_selected:`${re.disease_powder_1?.name}+${re.disease_powder_2?.name}${re.condition_powder?'+'+re.condition_powder.name:''}`,
    nutrition_dv_json:re.dvTargets, meal_score:re.score,
    rule_output_json:{ nutrients:re.nutrients, dv:re.dvTargets, benefits:re.benefits,
      chutney:re.disease_chutney, topping:re.disease_topping,
      powder1:re.disease_powder_1, powder2:re.disease_powder_2, cond_powder:re.condition_powder,
      calorie_reason:re.calorieReason },
    suggested_meal_json:re.suggestedMeal, meal_url:`${SITE_URL}/meal-score.html?cat=${re.cat}`,
    report_problems_bn:rpt.problems, report_cautions_bn:rpt.cautions,
    report_home_remedy_bn:rpt.home_remedy, report_ayurvedic_bn:rpt.ayurvedic,
    report_islamic_bn:rpt.islamic, report_meditation_bn:rpt.meditation,
    report_exercise_bn:rpt.exercise, report_dos_bn:rpt.dos, report_donts_bn:rpt.donts,
    report_general_bn:rpt.general, report_meal_rx_bn:rpt.meal_rx,
    analysis_bn:html, ai_used:true, engine_version:'v3.0', created_at:new Date().toISOString(),
  };
  const ex = await sbGetOne(`/rest/v1/ai_analysis?customer_id=eq.${cid}&score_date=eq.${today()}&analysis_type=eq.daily_report`);
  if (ex) { await sbPatch(`/rest/v1/ai_analysis?id=eq.${ex.id}`, row); return ex; }
  return await sbPost('/rest/v1/ai_analysis', row);
}

async function sendSms(phone, name, score, catBn, url) {
  if (!phone) return;
  const msg=`🌸 SAR ${today()} | ${name} | ${catBn} | স্কোর ${score}/100 | রিপোর্ট: ${url}`;
  try { await fetch(`${SITE_URL}/.netlify/functions/send-sms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,message:msg})}); } catch(e){}
}

async function sendEmail(email, name, html, url) {
  if (!email||!RESEND) return;
  try {
    await fetch('https://api.resend.com/emails',{method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${RESEND}`},
      body:JSON.stringify({from:'SAR Health <report@sheairestaurant.com>',to:[email],
        subject:`🌸 SAR দৈনিক রিপোর্ট — ${today()}`,html})});
  } catch(e){}
}

async function sbGet(p){const r=await fetch(`${SUPA_URL}${p}`,{headers:SB});return r.json();}
async function sbGetOne(p){const d=await sbGet(p);return Array.isArray(d)?d[0]:null;}
async function sbPost(p,b){const r=await fetch(`${SUPA_URL}${p}`,{method:'POST',headers:{...SB,Prefer:'return=representation'},body:JSON.stringify(b)});const d=await r.json();return Array.isArray(d)?d[0]:d;}
async function sbPatch(p,b){await fetch(`${SUPA_URL}${p}`,{method:'PATCH',headers:{...SB,Prefer:'return=minimal'},body:JSON.stringify(b)});}
function today(){return new Date().toISOString().split('T')[0];}
