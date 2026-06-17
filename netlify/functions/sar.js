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

const K = require('./kitchen-lib');

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

      // ── 2. customer_metrics (250 fields) + customers.sar_category ──
      // The disease category lives in the customers table (sar_category,
      // e.g. "DM" or "DM,OB"). We fetch both in parallel and merge that
      // category into the metrics object so meal-score.html can read it.
      case 'metrics': {
        const cid = encodeURIComponent(p.customer_id);
        const mUrl = `${SUPABASE_URL}/rest/v1/customer_metrics`
          + `?customer_id=eq.${cid}&select=*&limit=1`;
        const cUrl = `${SUPABASE_URL}/rest/v1/customers`
          + `?id=eq.${cid}&select=sar_category,full_name&limit=1`;
        const [mr, cr] = await Promise.all([
          fetch(mUrl, { headers: SB }),
          fetch(cUrl, { headers: SB }),
        ]);
        const md = await mr.json().catch(() => []);
        const cd = await cr.json().catch(() => []);
        const metrics = (Array.isArray(md) && md[0]) || {};
        const cust    = (Array.isArray(cd) && cd[0]) || {};
        // bring the customers.sar_category in. We expose it under BOTH
        // names so old and new code paths can read it without breaking.
        if (cust.sar_category != null && cust.sar_category !== '') {
          metrics.sar_category = cust.sar_category;
          if (!metrics.sar_category_interest) metrics.sar_category_interest = cust.sar_category;
        }
        return reply(200, { metrics });
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

      // ── 3b. fetch TODAY's saved analysis (saved-first render) ──
      // meal-score.html calls this on load: if the 6 AM cron already
      // produced today's row, the page renders from it instead of
      // recomputing. Matches by created_at being on/after today 00:00
      // so it works whether or not result_json carries a score_date.
      case 'todayScore': {
        const cid = encodeURIComponent(p.customer_id || '');
        const today = (p.date || new Date().toISOString().slice(0, 10));
        const since = encodeURIComponent(today + 'T00:00:00');
        const url = `${SUPABASE_URL}/rest/v1/ai_analysis`
          + `?customer_id=eq.${cid}`
          + `&analysis_type=eq.meal_score`
          + `&created_at=gte.${since}`
          + `&select=*&order=created_at.desc&limit=1`;
        const r = await fetch(url, { headers: SB });
        const d = await r.json();
        const row = (Array.isArray(d) && d[0]) || null;
        return reply(200, { found: !!row, analysis: row });
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

      // ── 4b. getOrder — kitchen.html recipe ticket ───────────
      // Reads one order and returns it with items_json exposed as
      // `items` (the shape kitchen.html expects). No token needed:
      // this is a read used by the recipe-ticket page after its own
      // simple (admin-style) login gate on the client side.
      case 'getOrder': {
        const oid = encodeURIComponent(p.order_id || '');
        if (!oid) return reply(400, { ok: false, error: 'no_order_id' });
        // match by id OR order_number so links like ?order=SAR-1042 work
        const url = `${SUPABASE_URL}/rest/v1/orders`
          + `?or=(id.eq.${oid},order_number.eq.${oid})`
          + `&select=*&limit=1`;
        const r = await fetch(url, { headers: SB });
        const d = await r.json().catch(() => []);
        const row = (Array.isArray(d) && d[0]) || null;
        if (!row) return reply(200, { ok: false, order: null });
        // expose items_json as items (+ keep meal_date/note aliases)
        const order = Object.assign({}, row, {
          items:     Array.isArray(row.items_json) ? row.items_json : (row.items || []),
          total:     row.total_amount != null ? row.total_amount : row.total,
          meal_date: row.meal_date || (row.created_at ? String(row.created_at).slice(0, 10) : null),
          note:      row.special_instructions || row.note || '',
        });
        return reply(200, { ok: true, order });
      }

      // ── 4c. getScore — kitchen.html personalization factor ──
      // Latest saved meal-score analysis for a customer (used to
      // recover the 6 AM kcal factor). Read-only, no token.
      case 'getScore': {
        const cid = encodeURIComponent(p.customer_id || '');
        if (!cid) return reply(200, { ok: false, score: null });
        const url = `${SUPABASE_URL}/rest/v1/ai_analysis`
          + `?customer_id=eq.${cid}`
          + `&analysis_type=eq.meal_score`
          + `&select=*&order=created_at.desc&limit=1`;
        const r = await fetch(url, { headers: SB });
        const d = await r.json().catch(() => []);
        const row = (Array.isArray(d) && d[0]) || null;
        return reply(200, { ok: !!row, score: row });
      }

      // ── 4d. kitchenBoard — token-free 3-column board feed ───
      // Powers the new kitchen.html kanban (queue / cooking / ready).
      // Uses the same kitchen-lib filter + ticket builder as the secure
      // kitchenQueue, but needs NO token (the page has its own simple
      // admin-style login). Returns full tickets incl. recipe courses.
      case 'kitchenBoard': {
        const url = `${SUPABASE_URL}/rest/v1/orders`
          + `?payment_status=in.(paid,pending)`
          + `&select=*&order=created_at.desc&limit=200`;
        const { data: rows } = await K.sbFetch(url, SB);
        if (!Array.isArray(rows)) return reply(200, { tickets: [], metrics: {} });

        const wanted = ['queued', 'claimed', 'preparing', 'ready', 'out_for_delivery'];
        const filtered = rows.filter(o => {
          if (!K.kitchenQueueFilter(o)) return false;
          const ks = o.kitchen_status || 'queued';
          return wanted.includes(ks);
        });

        // attach customer names
        const custIds = [...new Set(filtered.map(o => o.customer_id).filter(Boolean))];
        const custMap = {};
        if (custIds.length) {
          const cidList = custIds.map(encodeURIComponent).join(',');
          const { data: cl } = await K.sbFetch(
            `${SUPABASE_URL}/rest/v1/customers?id=in.(${cidList})&select=id,full_name,phone`, SB);
          if (Array.isArray(cl)) cl.forEach(c => { custMap[c.id] = c; });
        }

        const tickets = filtered.map(o => K.buildOrderTicket(o, custMap[o.customer_id] || {}));
        const metrics = {
          queued:    tickets.filter(t => ['queued', 'claimed'].includes(t.status)).length,
          preparing: tickets.filter(t => t.status === 'preparing').length,
          ready:     tickets.filter(t => ['ready', 'out_for_delivery'].includes(t.status)).length,
          total:     tickets.length,
        };
        return reply(200, { ok: true, tickets, metrics });
      }

      // ── 4e. kitchenAdvance — token-free status change ───────
      // Moves an order between columns (queued→preparing→ready→served)
      // or declines it. Mirrors order status via kitchen-lib so the
      // track page sees "delivered" when served. No token (simple login).
      case 'kitchenAdvance': {
        const realId = String(p.id || '').split('_')[0];
        if (!realId) return reply(400, { ok: false, error: 'no_id' });
        if (!K.KITCHEN_STATUSES.includes(p.status)) {
          return reply(400, { ok: false, error: 'invalid_status' });
        }
        const cur = await K.getOrderById(SUPABASE_URL, SB, realId);
        if (!cur) return reply(404, { ok: false, error: 'not_found' });

        const staff = { staff_name: p.staff_name || 'kitchen' };
        const built = K.buildStatusPatch(p.status, staff, {
          claimed_by:  p.staff_name || 'kitchen',
          assigned_by: p.staff_name || 'kitchen',
          eta_minutes: p.eta_minutes || cur.estimated_time_minutes || 15,
          verified:    true,             // simple board auto-verifies on ready
          require_verification: false,
        });
        if (built.error) return reply(400, { ok: false, error: built.error });

        const { ok } = await K.sbFetch(
          `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(realId)}`, SB, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(built.patch),
          });
        return reply(ok ? 200 : 400, { ok, status: p.status, order_status: built.patch.status || null });
      }


      // ═══ রান্নাঘর v2 — unified kitchen system (token-secured) ═══

      case 'kitchenQueue': {
        const session = await K.validateSession(SUPABASE_URL, SB, p.token);
        if (!session) return reply(401, { ok: false, error: 'unauthorized' });
        const wanted = Array.isArray(p.statuses) && p.statuses.length
          ? p.statuses
          : ['queued', 'claimed', 'preparing', 'ready', 'out_for_delivery'];
        const url = `${SUPABASE_URL}/rest/v1/orders`
          + `?payment_status=in.(paid,pending)`
          + `&select=*&order=created_at.desc&limit=200`;
        const { data: rows } = await K.sbFetch(url, SB);
        if (!Array.isArray(rows)) return reply(200, { tickets: [], metrics: {} });

        const filtered = rows.filter(o => {
          if (!K.kitchenQueueFilter(o)) return false;
          const ks = o.kitchen_status || 'queued';
          return wanted.includes(ks);
        });

        if (p.cook) {
          const cook = String(p.cook);
          filtered.splice(0, filtered.length,
            ...filtered.filter(o => o.claimed_by === cook));
        }
        if (p.priority_only) {
          filtered.splice(0, filtered.length,
            ...filtered.filter(o => o.is_priority || o.is_rush));
        }
        if (p.search) {
          const q = String(p.search).toLowerCase();
          filtered.splice(0, filtered.length, ...filtered.filter(o => {
            const num = String(o.order_number || '').toLowerCase();
            return num.includes(q);
          }));
        }

        const custIds = [...new Set(filtered.map(o => o.customer_id).filter(Boolean))];
        const custMap = {};
        if (custIds.length) {
          const cidList = custIds.map(encodeURIComponent).join(',');
          const { data: cl } = await K.sbFetch(
            `${SUPABASE_URL}/rest/v1/customers?id=in.(${cidList})&select=id,full_name,phone`,
            SB);
          if (Array.isArray(cl)) cl.forEach(c => { custMap[c.id] = c; });
        }

        const tickets = filtered.map(o =>
          K.buildOrderTicket(o, custMap[o.customer_id] || {}));

        const metrics = {
          queued:            tickets.filter(t => t.status === 'queued').length,
          claimed:           tickets.filter(t => t.status === 'claimed').length,
          preparing:         tickets.filter(t => t.status === 'preparing').length,
          ready:             tickets.filter(t => t.status === 'ready').length,
          out_for_delivery:  tickets.filter(t => t.status === 'out_for_delivery').length,
          total_active:      tickets.length,
          cooks_active:      [...new Set(tickets.map(t => t.claimed_by).filter(Boolean))].length,
          rush:              tickets.filter(t => t.is_rush).length,
          priority:          tickets.filter(t => t.is_priority).length,
        };

        return reply(200, { tickets, metrics });
      }

      case 'kitchenStatus': {
        const realId = String(p.id || '').split('_')[0];
        if (!realId) return reply(400, { ok: false, error: 'no_id' });
        if (!K.KITCHEN_STATUSES.includes(p.status)) {
          return reply(400, { ok: false, error: 'invalid_status' });
        }

        const session = await K.validateSession(SUPABASE_URL, SB, p.token);
        if (!session) return reply(401, { ok: false, error: 'unauthorized' });

        const cur = await K.getOrderById(SUPABASE_URL, SB, realId);
        if (!cur) return reply(404, { ok: false, error: 'not_found' });

        const fromStatus = cur.kitchen_status || 'queued';
        if (!K.canTransition(session.staff_role, fromStatus, p.status)) {
          return reply(403, { ok: false, error: 'forbidden', role: session.staff_role });
        }

        if (['claimed', 'preparing'].includes(p.status)) {
          if (cur.claimed_by && cur.claimed_by !== (p.claimed_by || session.staff_name)
              && !K.hasPermission(session.staff_role, 'reassign')) {
            return reply(200, { ok: false, locked: true, by: cur.claimed_by });
          }
        }

        if (p.status === 'served' && !cur.verification_completed
            && cur.kitchen_status !== 'out_for_delivery') {
          return reply(400, { ok: false, error: 'verification_required' });
        }

        const built = K.buildStatusPatch(p.status, session, {
          claimed_by:       p.claimed_by || session.staff_name,
          assigned_by:      p.assigned_by || session.staff_name,
          eta_minutes:      p.eta_minutes || cur.estimated_time_minutes || 15,
          verified:         !!p.verified,
          require_verification: true,
          is_priority:      p.is_priority,
          is_rush:          p.is_rush,
        });
        if (built.error) return reply(400, { ok: false, error: built.error });

        const { ok } = await K.sbFetch(
          `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(realId)}`, SB, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(built.patch),
          });

        if (ok) {
          await K.writeAudit(SUPABASE_URL, SB, {
            order_id:     realId,
            order_number: cur.order_number,
            staff_id:     session.staff_id,
            staff_name:   session.staff_name,
            staff_role:   session.staff_role,
            action:       'status_change',
            old_status:   fromStatus,
            new_status:   p.status,
            metadata:     { claimed_by: built.patch.claimed_by || cur.claimed_by },
          });
        }

        return reply(ok ? 200 : 400, { ok });
      }

      case 'kitchenAssign': {
        const realId = String(p.id || '');
        if (!realId) return reply(400, { ok: false, error: 'no_id' });
        const session = await K.validateSession(SUPABASE_URL, SB, p.token);
        if (!session) return reply(401, { ok: false, error: 'unauthorized' });
        if (!K.hasPermission(session.staff_role, 'assign')
            && !K.hasPermission(session.staff_role, 'reassign')) {
          return reply(403, { ok: false, error: 'forbidden' });
        }

        const cur = await K.getOrderById(SUPABASE_URL, SB, realId);
        if (!cur) return reply(404, { ok: false, error: 'not_found' });

        const cookName = String(p.cook_name || '').trim();
        if (!cookName) return reply(400, { ok: false, error: 'no_cook' });

        const patch = {
          claimed_by:        cookName,
          claimed_at:        new Date().toISOString(),
          assigned_by:       session.staff_name,
          kitchen_status:    cur.kitchen_status === 'queued' ? 'claimed' : (cur.kitchen_status || 'claimed'),
          expected_ready_at: K.estimateReadyAt(p.eta_minutes || 15),
          updated_at:        new Date().toISOString(),
        };
        if (patch.kitchen_status === 'claimed') {
          patch.status = K.mapKitchenToOrderStatus('claimed');
        }

        const { ok } = await K.sbFetch(
          `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(realId)}`, SB, {
            method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
          });

        if (ok) {
          await K.writeAudit(SUPABASE_URL, SB, {
            order_id: realId, order_number: cur.order_number,
            staff_id: session.staff_id, staff_name: session.staff_name,
            staff_role: session.staff_role, action: 'assign',
            old_status: cur.kitchen_status, new_status: patch.kitchen_status,
            metadata: { assigned_to: cookName },
          });
        }
        return reply(ok ? 200 : 400, { ok });
      }

      case 'kitchenUpdateFlags': {
        const realId = String(p.id || '');
        const session = await K.validateSession(SUPABASE_URL, SB, p.token);
        if (!session) return reply(401, { ok: false, error: 'unauthorized' });
        if (!K.hasPermission(session.staff_role, 'priority')) {
          return reply(403, { ok: false, error: 'forbidden' });
        }
        const patch = { updated_at: new Date().toISOString() };
        if (p.is_rush != null) patch.is_rush = !!p.is_rush;
        if (p.is_priority != null) patch.is_priority = !!p.is_priority;
        const { ok } = await K.sbFetch(
          `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(realId)}`, SB, {
            method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
          });
        return reply(ok ? 200 : 400, { ok });
      }

      case 'kitchenVerify': {
        const realId = String(p.id || '');
        const session = await K.validateSession(SUPABASE_URL, SB, p.token);
        if (!session) return reply(401, { ok: false, error: 'unauthorized' });
        if (!K.hasPermission(session.staff_role, 'verify')) {
          return reply(403, { ok: false, error: 'forbidden' });
        }
        if (!p.items_checked || !Array.isArray(p.items_checked)) {
          return reply(400, { ok: false, error: 'items_required' });
        }

        const patch = {
          verification_completed: true,
          verified_by:            session.staff_name,
          verified_at:            new Date().toISOString(),
          updated_at:             new Date().toISOString(),
        };
        const { ok } = await K.sbFetch(
          `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(realId)}`, SB, {
            method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
          });

        if (ok) {
          await K.writeAudit(SUPABASE_URL, SB, {
            order_id: realId, staff_id: session.staff_id,
            staff_name: session.staff_name, staff_role: session.staff_role,
            action: 'verify', metadata: { items: p.items_checked },
          });
        }
        return reply(ok ? 200 : 400, { ok, verified: ok });
      }

      case 'kitchenWorkload': {
        const session = await K.validateSession(SUPABASE_URL, SB, p.token);
        if (!session) return reply(401, { ok: false, error: 'unauthorized' });

        const url = `${SUPABASE_URL}/rest/v1/orders`
          + `?kitchen_status=in.(claimed,preparing)`
          + `&select=claimed_by,kitchen_status,estimated_time_minutes,expected_ready_at`
          + `&limit=500`;
        const { data: rows } = await K.sbFetch(url, SB);
        const map = {};
        (Array.isArray(rows) ? rows : []).forEach(o => {
          const name = o.claimed_by || 'অনির্ধারিত';
          if (!map[name]) map[name] = { cook: name, claimed: 0, preparing: 0, total: 0 };
          if (o.kitchen_status === 'claimed') map[name].claimed++;
          if (o.kitchen_status === 'preparing') map[name].preparing++;
          map[name].total++;
        });
        return reply(200, { workload: Object.values(map) });
      }

      case 'getRecipe': {
        const session = await K.validateSession(SUPABASE_URL, SB, p.token);
        if (!session) return reply(401, { ok: false, error: 'unauthorized' });

        const menuCode = String(p.menu_code || '').trim();
        const orderId  = String(p.order_id || '').trim();
        let recipe = null;

        if (menuCode) {
          const { data: rows } = await K.sbFetch(
            `${SUPABASE_URL}/rest/v1/recipes?menu_code=eq.${encodeURIComponent(menuCode)}`
            + `&is_active=eq.true&select=*&limit=1`, SB);
          if (Array.isArray(rows) && rows[0]) recipe = rows[0];
        }

        if (!recipe && p.menu_item_id) {
          const { data: rows } = await K.sbFetch(
            `${SUPABASE_URL}/rest/v1/recipes?menu_item_id=eq.${encodeURIComponent(p.menu_item_id)}`
            + `&is_active=eq.true&select=*&limit=1`, SB);
          if (Array.isArray(rows) && rows[0]) recipe = rows[0];
        }

        if (!recipe && orderId) {
          const order = await K.getOrderById(SUPABASE_URL, SB, orderId);
          const items = Array.isArray(order && order.items_json) ? order.items_json : [];
          const it = items.find(x => (x.code || x.menu_code) === menuCode)
            || items[p.item_index || 0];
          if (it) {
            const courses = K.parseItemCourses(it);
            recipe = {
              name_bn:           it.name_bn || it.name,
              menu_code:         it.code || it.menu_code,
              ingredients:       courses.flatMap(c => c.ingredients),
              steps:             courses.flatMap(c => c.steps),
              cook_time_minutes: 15,
              serving_method:    'তেলমুক্ত · স্টিম/এয়ার-ফ্রাই',
              allergens:         [it.has_egg ? 'ডিম' : null, it.has_chicken ? 'মুরগি' : null].filter(Boolean),
              kitchen_notes:     it.note || order.special_instructions || '',
              source:            'order_snapshot',
            };
          }
        }

        if (!recipe) {
          return reply(404, { ok: false, error: 'recipe_not_found' });
        }
        return reply(200, { ok: true, recipe });
      }

      case 'staffLogin': {
        const user = String(p.user || '').trim();
        const pass = String(p.pass || '');
        if (!user || !pass) return reply(200, { ok: false, error: 'missing' });

        const url = `${SUPABASE_URL}/rest/v1/staff`
          + `?or=(email.eq.${encodeURIComponent(user)},phone.eq.${encodeURIComponent(user)})`
          + `&select=id,name,email,phone,role,password_hash,is_active&limit=1`;
        const { data: rows } = await K.sbFetch(url, SB);
        const s = Array.isArray(rows) ? rows[0] : null;

        if (!s)                    return reply(200, { ok: false, error: 'notfound' });
        if (s.is_active === false) return reply(200, { ok: false, error: 'inactive' });
        if (!K.verifyPassword(s.password_hash, pass)) {
          return reply(200, { ok: false, error: 'wrongpass' });
        }

        const kitchenRoles = K.KITCHEN_ROLES.concat(['sar_dietitian', 'sar_nutritionist', 'cashier', 'rider']);
        const kitchenAccess = ['super_admin', 'admin', 'kitchen_manager', 'cook', 'assistant_cook',
          'quality_checker', 'delivery_manager', 'floor_manager'];
        if (!kitchenAccess.includes(s.role)) {
          return reply(200, { ok: false, error: 'noaccess', role: s.role });
        }

        const token = K.genToken();
        const expires = new Date(Date.now() + K.SESSION_HOURS * 3600000).toISOString();
        await K.sbFetch(`${SUPABASE_URL}/rest/v1/kitchen_sessions`, SB, {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            staff_id: s.id, token, staff_name: s.name,
            staff_role: s.role, expires_at: expires,
          }),
        });

        await K.sbFetch(`${SUPABASE_URL}/rest/v1/staff?id=eq.${encodeURIComponent(s.id)}`, SB, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ last_login: new Date().toISOString() }),
        }).catch(() => null);

        return reply(200, {
          ok: true,
          token,
          expires_at: expires,
          permissions: K.ROLE_PERMISSIONS[s.role] || ['view'],
          staff: {
            id: s.id, name: s.name, role: s.role, email: s.email, phone: s.phone,
            is_super: s.role === 'super_admin',
          },
        });
      }

      case 'staffSessionValidate': {
        const session = await K.validateSession(SUPABASE_URL, SB, p.token);
        if (!session) return reply(401, { ok: false, error: 'invalid_session' });
        return reply(200, {
          ok: true,
          staff: {
            id: session.staff_id, name: session.staff_name, role: session.staff_role,
          },
          permissions: K.ROLE_PERMISSIONS[session.staff_role] || ['view'],
        });
      }

      case 'staffLogout': {
        if (p.token) {
          await K.sbFetch(
            `${SUPABASE_URL}/rest/v1/kitchen_sessions?token=eq.${encodeURIComponent(p.token)}`, SB, {
              method: 'DELETE', headers: { Prefer: 'return=minimal' },
            });
        }
        return reply(200, { ok: true });
      }

      case 'staffList': {
        const session = await K.validateSession(SUPABASE_URL, SB, p.token);
        if (!session) return reply(401, { ok: false, error: 'unauthorized' });
        if (!K.hasPermission(session.staff_role, 'manage_staff')
            && !K.hasPermission(session.staff_role, 'assign')) {
          return reply(403, { ok: false, error: 'forbidden' });
        }
        const { data: rows } = await K.sbFetch(
          `${SUPABASE_URL}/rest/v1/staff?is_active=eq.true&select=id,name,role,phone,email&order=name`, SB);
        const cooks = (Array.isArray(rows) ? rows : []).filter(s =>
          ['cook', 'assistant_cook', 'kitchen_manager', 'floor_manager'].includes(s.role));
        return reply(200, { ok: true, staff: rows || [], cooks });
      }

      case 'staffUpsert': {
        const session = await K.validateSession(SUPABASE_URL, SB, p.token);
        if (!session) return reply(401, { ok: false, error: 'unauthorized' });
        if (!K.hasPermission(session.staff_role, 'manage_staff')) {
          return reply(403, { ok: false, error: 'forbidden' });
        }

        const row = {
          name:  String(p.name || '').trim(),
          phone: String(p.phone || '').trim(),
          email: String(p.email || '').trim() || null,
          role:  String(p.role || 'cook'),
          is_active: p.is_active !== false,
          updated_at: new Date().toISOString(),
        };
        if (p.password) row.password_hash = K.hashPassword(p.password);
        if (!row.name || !row.phone) return reply(400, { ok: false, error: 'missing_fields' });

        if (p.id) {
          const { ok } = await K.sbFetch(
            `${SUPABASE_URL}/rest/v1/staff?id=eq.${encodeURIComponent(p.id)}`, SB, {
              method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row),
            });
          return reply(ok ? 200 : 400, { ok });
        }

        row.created_at = new Date().toISOString();
        if (!row.password_hash) row.password_hash = K.hashPassword('sar2024');
        const { ok, data } = await K.sbFetch(`${SUPABASE_URL}/rest/v1/staff`, SB, {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(row),
        });
        return reply(ok ? 200 : 400, { ok, staff: Array.isArray(data) ? data[0] : data });
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
            model: 'claude-sonnet-4-6',
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

// ── normalize ANY category spelling → standard code ──
// Handles: codes (DM/OB/FL/IB/PR/GENERAL), English words,
// Bengali words, and comma/space strings ("DM,OB" → "DM").
// Returns '' if nothing valid is found (so callers can decide).
function normalizeCat(v) {
  if (!v) return '';
  // if a comma/space list, take the FIRST token only
  const first = String(v).split(/[,\s]+/).filter(Boolean)[0] || '';
  const s = first.trim().toUpperCase();
  if (['DM', 'OB', 'FL', 'IB', 'PR', 'GENERAL'].includes(s)) return s;
  const map = {
    'DIABETES': 'DM', 'DIABETIC': 'DM', 'ডায়াবেটিস': 'DM',
    'OBESITY': 'OB', 'OBESE': 'OB', 'স্থূলতা': 'OB', 'ওজন': 'OB',
    'FATTY': 'FL', 'FATTYLIVER': 'FL', 'LIVER': 'FL', 'ফ্যাটিলিভার': 'FL', 'ফ্যাটি': 'FL', 'লিভার': 'FL',
    'IBS': 'IB', 'GASTRIC': 'IB', 'গ্যাস্ট্রিক': 'IB', 'আইবিএস': 'IB',
    'PREGNANCY': 'PR', 'PRENATAL': 'PR', 'PREGNANT': 'PR', 'গর্ভাবস্থা': 'PR', 'গর্ভ': 'PR',
    'GEN': 'GENERAL', 'NORMAL': 'GENERAL', 'সাধারণ': 'GENERAL',
  };
  // try the uppercased token, then the raw bengali first-token
  return map[s] || map[first.trim()] || '';
}

// ── server-side category picker (mirrors the page) ──
// Order: explicit saved interest → disease flags → BMI → GENERAL.
// IMPORTANT: never silently falls back to Diabetes; if nothing
// is known the category is GENERAL so the UI can ask for metrics.
function pickCat(m) {
  const explicit = normalizeCat(m.sar_category_interest);
  if (explicit) return explicit;
  if (m.pregnancy_status && m.pregnancy_status !== 'না') return 'PR';
  if (m.diabetes_type && m.diabetes_type !== 'না') return 'DM';
  if (m.fatty_liver_grade && m.fatty_liver_grade !== 'না') return 'FL';
  if (m.ibs_type && m.ibs_type !== 'না') return 'IB';
  if (m.bmi && +m.bmi >= 25) return 'OB';
  return 'GENERAL';   // ← was 'DM'; no more silent Diabetes default
}

// ── server-side deterministic score (mirrors the page) ──
function localScore(m, cat) {
  const FOCUS = {
    DM: 'রক্তে শর্করা স্থিতিশীল · Low-GI',
    OB: 'ক্যালরি ঘাটতি · উচ্চ প্রোটিন · মেটাবলিজম',
    FL: 'লিভার ডিটক্স · ALT হ্রাস',
    IB: 'গাট হিলিং · Low-FODMAP',
    PR: 'আয়রন ও ফোলেট · ক্যালসিয়াম',
    GENERAL: 'সুষম পুষ্টি · নারীর সাধারণ সুস্থতা',
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
