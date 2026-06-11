// ════════════════════════════════════════════════════════════════
// SAR — add these action handlers to netlify/functions/sar.js
// They support meal-score.html (placeOrder, saveScore) and
// kitchen.html (getOrder, getScore). Uses the SERVICE ROLE client
// you already create for the existing actions (here called `sb`).
//
// Drop each `case` into your existing switch(action){ ... } block.
// ════════════════════════════════════════════════════════════════

// ── placeOrder ── (meal-score.html → goCheckout)
// body: { customer_id, items, subtotal, vat, total, meal_date, note }
case 'placeOrder': {
  const { customer_id, items, subtotal, vat, total, meal_date, note } = body;
  const { data, error } = await sb
    .from('orders')
    .insert({ customer_id, items, subtotal, vat, total, meal_date, note })
    .select()
    .single();
  if (error) return json({ ok: false, error: error.message });
  return json({ ok: true, order: data });
}

// ── getOrder ── (kitchen.html → loadTicket)
// body: { order_id }   → returns the full order incl. items[] (recipe inside)
case 'getOrder': {
  const { order_id } = body;
  const { data, error } = await sb
    .from('orders')
    .select('*')
    .eq('id', order_id)
    .single();
  if (error) return json({ ok: false, error: error.message });
  return json({ ok: true, order: data });
}

// ── saveScore ── (meal-score.html → runAnalysis)
// body: { customer_id, category, meal_score, daily_kcal, daily_protein, focus, analysis }
case 'saveScore': {
  const { customer_id, category, meal_score, daily_kcal, daily_protein, focus, analysis } = body;
  const { data, error } = await sb
    .from('meal_scores')
    .insert({ customer_id, category, meal_score, daily_kcal, daily_protein, focus, analysis })
    .select()
    .single();
  if (error) return json({ ok: false, error: error.message });
  return json({ ok: true, score: data });
}

// ── getScore ── (kitchen.html → recover the 6AM personalization factor)
// body: { customer_id }  → latest meal_scores row for that customer
case 'getScore': {
  const { customer_id } = body;
  const { data, error } = await sb
    .from('meal_scores')
    .select('*')
    .eq('customer_id', customer_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return json({ ok: false, error: error.message });
  return json({ ok: true, score: data || null });
}

// Note: `json(obj)` is your existing helper returning
// { statusCode: 200, headers: {...cors}, body: JSON.stringify(obj) }.
// `sb` is your service-role Supabase client. `body` is the parsed request.
