// netlify/functions/sar.js
// ─────────────────────────────────────────────────────────────
// Single secure proxy for the SAR Meal Score page.
// ALL Supabase + OpenAI calls go through here → NO key in browser.
//
// Netlify → Site settings → Environment variables:
//   SUPABASE_URL          https://xlkrggspepnysbouatec.supabase.co
//   SUPABASE_SERVICE_KEY  service_role key (SECRET, server-only)
//   CLAUDE_API_KEY        Anthropic key (optional; else local engine)
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xlkrggspepnysbouatec.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_API_KEY || '';

const SB = {
  apikey: SERVICE_KEY,
  Authorization: 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json',
};

const reply = (status, body) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST')    return reply(405, { error: 'POST only' });
  if (!SERVICE_KEY) return reply(500, { error: 'Missing SUPABASE_SERVICE_KEY env var' });

  let p;
  try { p = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Bad JSON' }); }

  try {
    switch (p.action) {

      // ── 0. CRON: daily 6AM auto-analysis for ALL customers ──
      // cron-job.org hits this once a day. No Edge Function needed.
      case 'cron': {
        // fetch all customers' metrics (id + a few fields)
        const mr = await fetch(
          `${SUPABASE_URL}/rest/v1/customer_metrics`
          + `?select=customer_id,bmi,stress_level,activity_level,pregnancy_status,`
          + `diabetes_type,fatty_liver_grade,ibs_type,sar_category_interest`,
          { headers: SB });
        const people = await mr.json();
        if (!Array.isArray(people)) return reply(200, { ran: 0, note: 'no customers' });

        const today = new Date().toISOString().slice(0, 10);
        let done = 0;
        for (const m of people) {
          const cat = pickCat(m);
          const a = localScore(m, cat);   // server-side deterministic engine
          const row = {
            customer_id:   m.customer_id,
            analysis_type: 'meal_score',
            category:      cat,
            meal_score:    a.score,
            daily_kcal:    a.target,
            daily_protein: a.protein,
            focus:         a.focus,
            result_json:   { ...a, score_date: today, source: 'cron 6AM' },
          };
          const ins = await fetch(`${SUPABASE_URL}/rest/v1/ai_analysis`, {
            method: 'POST', headers: { ...SB, Prefer: 'return=minimal' },
            body: JSON.stringify(row),
          }).catch(() => null);
          if (ins && ins.ok) done++;
        }
        return reply(200, { ran: done, total: people.length, date: today });
      }

      // ── 1. menu_items for ONE disease category ──────────────
      case 'menu': {
        const cat = encodeURIComponent(p.cat || 'DM');
        const url = `${SUPABASE_URL}/rest/v1/menu_items`
          + `?is_available=eq.true&disease_category=eq.${cat}`
          + `&select=id,menu_code,disease_category,meal_type,day,name_bn,`
          + `course_1_bn,course_2_bn,course_3_bn,chutney_name,calories,`
          + `protein_g,fiber_g,benefits&order=menu_code`;
        const r = await fetch(url, { headers: SB });
        const d = await r.json();
        return reply(200, { items: Array.isArray(d) ? d : [] });
      }

      // ── 2. customer_metrics (250 fields) ────────────────────
      case 'metrics': {
        const cid = encodeURIComponent(p.customer_id);
        const url = `${SUPABASE_URL}/rest/v1/customer_metrics`
          + `?customer_id=eq.${cid}&select=*&limit=1`;
        const r = await fetch(url, { headers: SB });
        const d = await r.json();
        return reply(200, { metrics: (Array.isArray(d) && d[0]) || {} });
      }

      // ── 3. save meal score → ai_analysis table ──────────────
      case 'saveScore': {
        const row = {
          customer_id:   p.customer_id,
          analysis_type: 'meal_score',
          category:      p.category,
          meal_score:    p.meal_score,
          daily_kcal:    p.daily_kcal,
          daily_protein: p.daily_protein,
          focus:         p.focus,
          result_json:   p.analysis,   // jsonb
        };
        const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_analysis`, {
          method: 'POST',
          headers: { ...SB, Prefer: 'return=representation' },
          body: JSON.stringify(row),
        });
        const d = await r.json();
        return reply(r.ok ? 200 : 400, { saved: r.ok, data: d });
      }

      // ── 4. place order → orders (+ order_items) ─────────────
      case 'placeOrder': {
        // 4a. header row into orders
        const orderRow = {
          customer_id:   p.customer_id,
          order_type:    'delivery',
          status:        'pending',
          items_json:    p.items,        // JSONB NOT NULL — full meal+course detail
          subtotal:      p.subtotal,
          tax:           p.vat,          // 5% VAT lands in tax column
          total_amount:  p.total,
          payment_status:'pending',
          special_instructions: p.note || null,
        };
        const r = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
          method: 'POST',
          headers: { ...SB, Prefer: 'return=representation' },
          body: JSON.stringify(orderRow),
        });
        const od = await r.json();
        if (!r.ok) return reply(400, { ok: false, error: od });
        const order = Array.isArray(od) ? od[0] : od;

        // 4b. one order_items row per meal
        if (order && order.id && Array.isArray(p.items)) {
          const lines = p.items.map(it => ({
            order_id:      order.id,
            menu_item_id:  it.menu_item_id || null,
            menu_name_bn:  it.name,
            quantity:      1,
            unit_price:    it.price,           // courses × ৳85
            special_note:  (it.courses || []).join(' · '),
            nutrition_json:{ kcal: it.kcal, protein: it.protein,
                             courses: it.courseCount, meal: it.meal, day: it.day },
          }));
          await fetch(`${SUPABASE_URL}/rest/v1/order_items`, {
            method: 'POST', headers: { ...SB, Prefer: 'return=minimal' },
            body: JSON.stringify(lines),
          }).catch(() => {});
        }
        return reply(200, { ok: true, order });
      }


      // ═══ রান্নাঘর + স্টাফ লগইন (যোগ করা) ═══
      case 'kitchenQueue': {
        const wanted = Array.isArray(p.statuses) && p.statuses.length
          ? p.statuses : ['queued', 'preparing', 'ready'];
        const inList = wanted.map(encodeURIComponent).join(',');
        const url = `${SUPABASE_URL}/rest/v1/orders`
          + `?payment_status=eq.paid`
          + `&kitchen_status=in.(${inList})`
          + `&select=*&order=created_at.asc`;
        const r = await fetch(url, { headers: SB });
        const rows = await r.json();
        if (!Array.isArray(rows)) return reply(200, { tickets: [] });

        // সব গ্রাহকের নাম এক ডাকে আনা (অর্ডারে customer_id থাকে)
        const custIds = [...new Set(rows.map(o => o.customer_id).filter(Boolean))];
        const custMap = {};
        if (custIds.length) {
          const cidList = custIds.map(encodeURIComponent).join(',');
          const cr = await fetch(
            `${SUPABASE_URL}/rest/v1/customers?id=in.(${cidList})&select=id,full_name,phone`,
            { headers: SB });
          const cl = await cr.json();
          if (Array.isArray(cl)) cl.forEach(c => { custMap[c.id] = c; });
        }

        const tickets = [];
        for (const o of rows) {
          const items = Array.isArray(o.items_json) ? o.items_json : [];
          const cust = custMap[o.customer_id] || {};
          items.forEach((it, idx) => {
            // কোর্সের বিস্তারিত (নাম + উপকরণ)
            const detail = Array.isArray(it.courseDetail) ? it.courseDetail : [];
            const selected_courses = detail.map((c, i) => ({
              slot:       i + 1,
              name_bn:    c.name || ('কোর্স ' + (i + 1)),
              kcal:       c.kcal || null,
              ingredients:(c.items || []).map(g =>
                            typeof g === 'string' ? { item: g, grams: '' } : g),
              steps:      c.steps || [],
            }));
            // মেডিসিনাল পাউডার ও চাটনি (meal-score থেকে)
            const medicinals = []
              .concat(it.diseasePowders || [])
              .concat(it.conditionPowders || [])
              .filter(Boolean);
            tickets.push({
              id:               `${o.id}_${idx}`,
              order_id:         o.order_number || o.id,
              real_order_id:    o.id,
              customer_name:    cust.full_name || 'গ্রাহক',
              customer_phone:   cust.phone || '',
              payment_status:   o.payment_status || 'pending',
              payment_method:   o.payment_method || (o.order_type === 'delivery' ? 'COD' : ''),
              menu_name:        it.name_bn || it.name || 'থেরাপিউটিক মিল',
              menu_code:        it.code || it.menu_code || '',
              meal_type:        it.meal || '',
              day:              it.day || '',
              total_kcal:       it.kcal || 0,
              total_protein:    it.protein || 0,
              course_count:     it.courseCount || (it.courses ? it.courses.length : detail.length),
              medicinals:       medicinals,
              chutney:          it.chutney || '',
              topping:          it.topping || '',
              selected_courses,
              status:           o.kitchen_status || 'queued',
              claimed_by:       o.claimed_by || null,
              created_at:       o.created_at,
            });
          });
        }
        return reply(200, { tickets });
      }

      // ── রান্নাঘরের স্ট্যাটাস বদলানো (+ বোতাম লক) ───────────────
      // kitchen.html "রান্না শুরু/প্রস্তুত/ডেলিভারি/বাতিল" চাপলে এটা ডাকে।
      case 'kitchenStatus': {
        // id আসে "orderid_index" আকারে — আসল order id বের করি
        const realId = String(p.id || '').split('_')[0];
        if (!realId) return reply(400, { ok: false, error: 'no id' });

        const patch = { kitchen_status: p.status };
        // রান্না ধরলে কে ধরল রেকর্ড করি (বোতাম লক)
        if (p.status === 'preparing' && p.claimed_by) {
          patch.claimed_by = p.claimed_by;
          patch.claimed_at = new Date().toISOString();
        }

        // লক যাচাই: অন্য কেউ আগে ধরে ফেললে আটকে দাও
        if (p.status === 'preparing' && p.claimed_by) {
          const chk = await fetch(
            `${SUPABASE_URL}/rest/v1/orders?id=eq.${realId}&select=claimed_by,kitchen_status`,
            { headers: SB });
          const cur = (await chk.json())[0];
          if (cur && cur.claimed_by && cur.claimed_by !== p.claimed_by) {
            return reply(200, { ok: false, locked: true, by: cur.claimed_by });
          }
        }

        const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${realId}`, {
          method: 'PATCH',
          headers: { ...SB, Prefer: 'return=minimal' },
          body: JSON.stringify(patch),
        });
        return reply(r.ok ? 200 : 400, { ok: r.ok });
      }


      case 'staffLogin': {
        const user = String(p.user || '').trim();
        const pass = String(p.pass || '');
        if (!user || !pass) return reply(200, { ok: false, error: 'missing' });

        // staff টেবিলে ইউজার খোঁজা (email বা phone বা name যেকোনোটা দিয়ে)
        // আপনার staff টেবিলে লগইন আইডি হিসেবে কোন কলাম, সেটা নিচে মেলান।
        // ধরা হচ্ছে: email কে ইউজার আইডি হিসেবে ব্যবহার করা হয়।
        const url = `${SUPABASE_URL}/rest/v1/staff`
          + `?or=(email.eq.${encodeURIComponent(user)},phone.eq.${encodeURIComponent(user)})`
          + `&select=id,name,email,phone,role,password_hash,is_active&limit=1`;
        const r = await fetch(url, { headers: SB });
        const rows = await r.json();
        const s = Array.isArray(rows) ? rows[0] : null;

        if (!s)                       return reply(200, { ok: false, error: 'notfound' });
        if (s.is_active === false)    return reply(200, { ok: false, error: 'inactive' });
        if (s.password_hash !== pass)      return reply(200, { ok: false, error: 'wrongpass' });

        // কোন role রান্নাঘরে ঢুকতে পারবে
        const kitchenRoles = ['kitchen_manager', 'super_admin', 'admin', 'floor_manager'];
        if (!kitchenRoles.includes(s.role)) {
          return reply(200, { ok: false, error: 'noaccess', role: s.role });
        }

        // সফল — পাসওয়ার্ড ছাড়া তথ্য ফেরত
        return reply(200, {
          ok: true,
          staff: { id: s.id, name: s.name, role: s.role,
                   is_super: s.role === 'super_admin' },
        });
      }


      // ── 5. Claude personalization (optional) ────────────────
      case 'analyze': {
        if (!CLAUDE_KEY) return reply(200, { ai: null });   // client falls back to local engine
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': CLAUDE_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            system: 'তুমি শুধুমাত্র বৈধ JSON অবজেক্ট ফেরত দেবে — কোনো markdown, ব্যাখ্যা বা ```-fence ছাড়া।',
            messages: [{ role: 'user', content: p.prompt }],
          }),
        });
        const d = await r.json();
        let text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
        // strip any stray code fences and isolate the JSON object
        text = text.replace(/```json|```/g, '').trim();
        const a = text.indexOf('{'), b = text.lastIndexOf('}');
        if (a > -1 && b > -1) text = text.slice(a, b + 1);
        return reply(200, { ai: text || null });
      }

      default:
        return reply(400, { error: 'Unknown action: ' + p.action });
    }
  } catch (err) {
    return reply(500, { error: String((err && err.message) || err) });
  }
};

// ── server-side category picker (mirrors the page) ──
function pickCat(m) {
  if (m.sar_category_interest) return m.sar_category_interest;
  if (m.pregnancy_status && m.pregnancy_status !== 'না') return 'PR';
  if (m.diabetes_type && m.diabetes_type !== 'না') return 'DM';
  if (m.fatty_liver_grade && m.fatty_liver_grade !== 'না') return 'FL';
  if (m.ibs_type && m.ibs_type !== 'না') return 'IB';
  if (m.bmi && +m.bmi >= 25) return 'OB';
  return 'DM';
}

// ── server-side deterministic score (mirrors the page) ──
function localScore(m, cat) {
  const FOCUS = {
    DM: 'রক্তে শর্করা স্থিতিশীল · Low-GI',
    OB: 'ক্যালরি ঘাটতি · উচ্চ প্রোটিন · মেটাবলিজম',
    FL: 'লিভার ডিটক্স · ALT হ্রাস',
    IB: 'গাট হিলিং · Low-FODMAP',
    PR: 'আয়রন ও ফোলেট · ক্যালসিয়াম',
  };
  const bmi = +m.bmi || 23;
  const mood = (m.stress_level != null) ? (10 - +m.stress_level) : 7;
  const act = (m.activity_level || '').toString();
  const actF = /high|active|বেশি/i.test(act) ? 1.12 : /low|কম|sedentary/i.test(act) ? 0.9 : 1.0;
  let target = 1650;
  if (bmi >= 30) target = 1350; else if (bmi >= 25) target = 1450; else if (bmi < 18.5) target = 1750;
  target = Math.round(target * actF / 10) * 10;
  let protein = 60;
  if (cat === 'PR') protein = 75; else if (cat === 'OB') protein = 80; else if (cat === 'FL') protein = 65;
  let score = 72;
  if (bmi >= 18.5 && bmi < 25) score += 10;
  score += Math.round((mood - 5) * 1.5);
  score += actF > 1 ? 6 : (actF < 1 ? -4 : 0);
  score = Math.max(55, Math.min(98, score));
  return { cat, score, target, protein, focus: FOCUS[cat] || 'সুষম পুষ্টি' };
}
