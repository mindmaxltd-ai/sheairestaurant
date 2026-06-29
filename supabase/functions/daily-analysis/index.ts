// supabase/functions/daily-analysis/index.ts
// SAR — Daily AI Analysis Edge Function
// cron-job.org থেকে প্রতিদিন সকাল ৬টায় (00:00 UTC) call হবে
// Supabase Edge Function = Deno runtime, কোনো 30s timeout নেই
//
// Deploy কমান্ড (একবারই):
//   supabase functions deploy daily-analysis --no-verify-jwt
//
// Secret set (একবারই):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase secrets set CRON_SECRET=sar-secret-2026

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('CLAUDE_API_KEY') || '';
const CRON_SECRET   = Deno.env.get('CRON_SECRET') || '';
const PUBLIC_SITE   = 'https://sheairestaurant.com';

const sb    = createClient(SUPABASE_URL, SERVICE_KEY);
const today = new Date().toISOString().slice(0, 10);

function pickCat(m: any): string {
  if (m.pregnancy_status === true || m.pregnancy_status === 'yes') return 'PR';
  if (m.diabetes_type)     return 'DM';
  if (m.fatty_liver_grade) return 'FL';
  if (m.ibs_type)          return 'IB';
  if (parseFloat(m.bmi) >= 30) return 'OB';
  return m.sar_category_interest || 'GEN';
}

function localScore(m: any, cat: string) {
  let score = 70;
  const bmi = parseFloat(m.bmi) || 0;
  if (bmi >= 18.5 && bmi < 25) score += 12;
  if (m.stress_level === 'low')    score += 6;
  if (m.activity_level === 'high') score += 8;
  if (score > 100) score = 100;
  const target  = cat === 'PR' ? 2200 : cat === 'OB' ? 1500 : 1800;
  const protein = cat === 'PR' ? 75 : 60;
  const focusMap: Record<string,string> = {
    DM:'রক্তে শর্করা নিয়ন্ত্রণ — কম গ্লাইসেমিক খাবার ও আঁশ',
    OB:'ওজন কমানো — কম ক্যালরি, বেশি প্রোটিন ও আঁশ',
    PR:'গর্ভকালীন পুষ্টি — আয়রন, ফোলেট ও ক্যালসিয়াম',
    FL:'লিভার সুস্থতা — তেলমুক্ত, চিনিমুক্ত খাবার',
    IB:'পাকস্থলী আরাম — সহজপাচ্য, কম ঝাল খাবার',
    GEN:'সার্বিক সুস্থতা — সুষম, তেল-চিনি-লবণমুক্ত খাবার',
  };
  return { score, target, protein, focus: focusMap[cat] || focusMap['GEN'] };
}

async function aiAnalyze(m: any, cat: string, cust: any): Promise<any> {
  if (!ANTHROPIC_KEY) return null;

  const skip = ['id','customer_id','created_at','updated_at'];
  const metricsStr = Object.entries(m)
    .filter(([k,v]) => !skip.includes(k) && v != null && v !== '' && String(v).trim())
    .map(([k,v]) => `${k}: ${v}`).join('\n') || 'নেই';

  // daily_health_log বিগত ৩ দিন
  let todayCond = 'বিগত ৩ দিনে কোনো দৈনিক আপডেট দেননি';
  try {
    const since = new Date(Date.now() - 3*86400000).toISOString().slice(0,10);
    const { data: dlArr } = await sb.from('daily_health_log')
      .select('*').eq('customer_id', cust.id)
      .gte('log_date', since).order('log_date',{ascending:false}).limit(3);
    if (dlArr?.length) {
      todayCond = dlArr.map((L: any) => {
        const p: string[] = [];
        if (L.fever)              p.push(`জ্বর${L.fever_temp?' ('+L.fever_temp+'°F)':''}`);
        if (L.cold_cough)         p.push('সর্দি-কাশি');
        if (L.stomach_upset)      p.push('পেট খারাপ');
        if (L.loose_motion)       p.push('পাতলা পায়খানা');
        if (L.headache)           p.push('মাথাব্যথা');
        if (L.body_pain)          p.push('শরীরব্যথা');
        if (L.period_today)       p.push('মাসিক চলছে');
        if (L.cramping)           p.push(`ক্র্যাম্প (${L.cramping_level??'—'}/১০)`);
        if (L.mood)               p.push(`মুড: ${L.mood}`);
        if (L.mental_condition)   p.push(`মানসিক: ${L.mental_condition}`);
        if (L.stress_level!=null) p.push(`স্ট্রেস: ${L.stress_level}/১০`);
        if (L.sleep_hours!=null)  p.push(`ঘুম: ${L.sleep_hours}ঘণ্টা`);
        if (L.food_eaten)         p.push(`খেয়েছেন: ${L.food_eaten}`);
        if (L.notes)              p.push(`নোট: ${L.notes}`);
        return `[${L.log_date}] ${p.length?p.join(', '):'বিশেষ লক্ষণ নেই'}`;
      }).join('\n');
    }
  } catch(_) {}

  let prevRx = 'নেই';
  try {
    const { data } = await sb.from('sar_notes').select('note_text_bn,created_at')
      .eq('customer_id',cust.id).eq('note_type','prescription')
      .order('created_at',{ascending:false}).limit(2);
    if (data?.length) prevRx = data.map((p:any,i:number)=>`[${i+1}] ${(p.note_text_bn||'').slice(0,300)}`).join('\n\n');
  } catch(_) {}

  let prevReports = 'নেই';
  try {
    const { data } = await sb.from('ai_analysis')
      .select('analysis_date,health_score,health_summary_bn,focus')
      .eq('customer_id',cust.id).order('analysis_date',{ascending:false}).limit(2);
    if (data?.length) prevReports = data.map((p:any)=>
      `[${p.analysis_date}] স্কোর ${p.health_score||'—'} — ${(p.health_summary_bn||'').slice(0,150)}`
    ).join('\n');
  } catch(_) {}

  const prompt = `তুমি SAR (She AI Revolution) ক্লিনিক্যাল পুষ্টি AI। নিচের নারী গ্রাহকের সম্পূর্ণ তথ্য বিশ্লেষণ করে দৈনিক স্বাস্থ্য রিপোর্ট দাও।

নাম: ${cust.full_name||'গ্রাহক'}
বিভাগ: ${cat}

স্বাস্থ্য মেট্রিক্স:
${metricsStr}

🔴 বিগত ৩ দিনের দৈনিক অবস্থা (সবচেয়ে গুরুত্বপূর্ণ):
${todayCond}

আগের প্রেসক্রিপশন:
${prevRx}

আগের AI রিপোর্ট:
${prevReports}

শুধু JSON দাও (markdown নয়, extra text নয়):
{"health_score":<১-১০০>,"health_summary_bn":"২-৩ বাক্য","problems_json":["সমস্যা ১","সমস্যা ২"],"nutrition_advice_bn":"পুষ্টি পরামর্শ","general_suggestions_bn":"সাধারণ পরামর্শ","home_remedies_bn":"ঘরোয়া প্রতিকার","ayurvedic_bn":"আয়ুর্বেদিক পরামর্শ","motivational_message_bn":"অনুপ্রেরণা","daily_kcal":<সংখ্যা>,"daily_protein":<সংখ্যা>,"focus":"আজকের ফোকাস","daily_menu_recommendation_json":["সকাল: ...","দুপুর: ...","রাত: ..."]}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version':'2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role:'user', content: prompt }],
      }),
    });
    if (!r.ok) { console.error('Claude error:', r.status, await r.text()); return null; }
    const d = await r.json();
    let txt = (d.content?.[0]?.text) || '';
    txt = txt.replace(/```json|```/g,'').trim();
    const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
    if (a > -1 && b > a) txt = txt.slice(a, b+1);
    return JSON.parse(txt);
  } catch(e) { console.error('AI parse error:', e); return null; }
}

Deno.serve(async (req) => {
  const url    = new URL(req.url);
  const secret = url.searchParams.get('secret') || '';
  if (CRON_SECRET && secret !== CRON_SECRET)
    return new Response(JSON.stringify({error:'Unauthorized'}), {status:401});

  const summary: any = { date:today, analyzed:0, skipped:0, errors:[] };

  try {
    const { data: people } = await sb.from('customer_metrics').select('*');
    if (!people?.length) return new Response(JSON.stringify({...summary, note:'metrics নেই'}), {status:200});

    const { data: custList } = await sb.from('customers').select('id,full_name,phone,email');
    const custMap: Record<string,any> = {};
    (custList||[]).forEach((c:any) => { custMap[c.id] = c; });

    const { data: doneRows } = await sb.from('ai_analysis')
      .select('customer_id')
      .eq('analysis_date', today)
      .eq('analysis_type', 'daily_6am')
      .not('health_summary_bn','is',null);
    const doneSet = new Set((doneRows||[]).map((r:any)=>r.customer_id));

    const pending = people.filter((m:any) => !doneSet.has(m.customer_id));
    summary.skipped = people.length - pending.length;

    for (const m of pending) {
      const cid  = m.customer_id;
      const cust = custMap[cid] || { id: cid, full_name: 'গ্রাহক' };
      try {
        const cat = pickCat(m);
        const ai  = await aiAnalyze(m, cat, cust);
        const loc = localScore(m, cat);

        const row: any = {
          customer_id:   cid,
          analysis_date: today,
          analysis_type: 'daily_6am',
          category:      cat,
          health_score:  ai?.health_score        ?? loc.score,
          meal_score:    loc.score,
          daily_kcal:    ai?.daily_kcal          ?? loc.target,
          daily_protein: ai?.daily_protein       ?? loc.protein,
          focus:         ai?.focus               ?? loc.focus,
          health_summary_bn:       ai?.health_summary_bn       ?? null,
          nutrition_advice_bn:     ai?.nutrition_advice_bn     ?? null,
          general_suggestions_bn:  ai?.general_suggestions_bn  ?? null,
          home_remedies_bn:        ai?.home_remedies_bn        ?? null,
          ayurvedic_bn:            ai?.ayurvedic_bn            ?? null,
          motivational_message_bn: ai?.motivational_message_bn ?? null,
          problems_json:           ai?.problems_json           ?? null,
          daily_menu_recommendation_json: ai?.daily_menu_recommendation_json ?? null,
          result_json: { ...(ai||loc), score_date:today, source: ai?'EdgeFunction AI':'localScore' },
        };

        // delete পুরোনো + insert নতুন
        await sb.from('ai_analysis').delete()
          .eq('customer_id',cid).eq('analysis_date',today).eq('analysis_type','daily_6am');
        await sb.from('ai_analysis').insert(row);

        // reports table
        await sb.from('reports').delete().eq('customer_id',cid).eq('report_date',today);
        await sb.from('reports').insert({
          customer_id: cid,
          report_date: today,
          pdf_url: `${PUBLIC_SITE}/report.html?customer_id=${cid}`,
          meal_score: row.health_score,
          category: cat,
        });

        summary.analyzed++;
        console.log(`✓ ${cust.full_name} score:${row.health_score} AI:${!!ai}`);
      } catch(e:any) {
        summary.errors.push(`${cust.full_name||cid}: ${e.message}`);
      }
    }
    return new Response(JSON.stringify(summary), {
      status:200, headers:{'Content-Type':'application/json'},
    });
  } catch(e:any) {
    return new Response(JSON.stringify({error:e.message, summary}), {status:500});
  }
});
