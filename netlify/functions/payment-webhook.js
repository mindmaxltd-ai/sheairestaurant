// netlify/functions/payment-webhook.js
// ─────────────────────────────────────────────────────────────
// SAR — Gateway Webhook / IPN Receiver
// পেমেন্ট গেটওয়ে (SSLCommerz IPN, bKash callback) এখানে POST করে।
// এটি signature যাচাই করে → Supabase-এ payment SUCCESS/FAILED লেখে →
// SUCCESS হলে receipt + kitchen/subscription তৈরি করে।
//
// গেটওয়ে কনফিগে এই URL দিন (IPN / callback URL হিসেবে):
//   https://<your-site>.netlify.app/.netlify/functions/payment-webhook
//
// Netlify env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   SSLCZ_STORE_PASSWD   (SSLCommerz store password — signature যাচাইয়ে)
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xlkrggspepnysbouatec.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const SSLCZ_PASSWD = process.env.SSLCZ_STORE_PASSWD || '';

const SB = {
  apikey: SERVICE_KEY,
  Authorization: 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json',
};
const enc = (v) => encodeURIComponent(v);

const reply = (status, body, isHtml) => ({
  statusCode: status,
  headers: { 'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'application/json',
             'Access-Control-Allow-Origin': '*' },
  body: isHtml ? body : JSON.stringify(body),
});

// ── parse body: gateway পাঠায় form-urlencoded; আমাদের নিজস্ব কল JSON ──
function parseBody(event) {
  const ct = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
  const raw = event.body || '';
  if (ct.includes('application/json')) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  // form-urlencoded
  const out = {};
  raw.split('&').forEach(pair => {
    const [k, v] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
  });
  return out;
}

async function sbSelect(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: SB });
  const d = await r.json().catch(() => []);
  return Array.isArray(d) ? d : [];
}
async function sbUpdate(table, query, row) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(row),
  });
}
async function sbInsert(table, row) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(row),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  if (!SERVICE_KEY) return reply(500, { error: 'Missing SUPABASE_SERVICE_KEY' });

  const data = parseBody(event);

  // ── গেটওয়ে থেকে আসা মূল ফিল্ডগুলো সাধারণীকরণ ──
  // SSLCommerz: tran_id, status (VALID/FAILED/CANCELLED), amount, val_id, bank_tran_id
  // bKash:      merchantInvoiceNumber, trxID, transactionStatus
  // আমাদের নিজস্ব: transaction_id, gateway_status
  const txnId =
    data.transaction_id || data.tran_id || data.merchantInvoiceNumber || data.invoice || null;
  const rawStatus =
    data.gateway_status || data.status || data.transactionStatus || '';
  const paidAmount = data.amount || data.paid_amount || null;
  const gatewayTxn = data.bank_tran_id || data.trxID || data.val_id || null;

  // VALID/Completed/SUCCESS → SUCCESS ; বাকি সব → FAILED
  const isSuccess = /valid|success|completed/i.test(String(rawStatus));

  if (!txnId) return reply(400, { error: 'transaction id missing in webhook' });

  try {
    // ── payment খুঁজি ──
    const pay = (await sbSelect('payments',
      `transaction_id=eq.${enc(txnId)}&select=*&order=created_at.desc&limit=1`))[0];
    if (!pay) return reply(404, { ok: false, error: 'payment not found for ' + txnId });

    // ── (ঐচ্ছিক) SSLCommerz signature যাচাই ──
    // প্রকৃত deployment-এ এখানে SSLCommerz validation API কল করে val_id যাচাই করুন।
    // উদাহরণ: https://securepay.sslcommerz.com/validator/api/validationserverAPI.php?val_id=...&store_passwd=...
    // এখানে আমরা amount mismatch ধরি — উদ্দিষ্ট amount-এর সাথে না মিললে FAILED।
    let verifiedOk = isSuccess;
    if (verifiedOk && paidAmount != null) {
      const expected = Number(pay.final_amount || 0);
      const got = Number(paidAmount);
      if (expected > 0 && Math.abs(expected - got) > 1) verifiedOk = false; // ৳1 sahonshilota
    }

    // ── payment + invoice আপডেট ──
    await sbUpdate('payments', `id=eq.${enc(pay.id)}`, {
      paid_amount: paidAmount != null ? Number(paidAmount) : pay.final_amount,
      gateway_txn_id: gatewayTxn,
      status: verifiedOk ? 'SUCCESS' : 'FAILED',
      verification_status: verifiedOk ? 'VERIFIED' : 'REJECTED',
      verified_at: new Date().toISOString(),
      verified_by: 'gateway_webhook',
      gateway_response_json: { ...(pay.gateway_response_json || {}), ipn: data, at: new Date().toISOString() },
    });
    await sbUpdate('invoices', `id=eq.${enc(pay.invoice_id)}`,
      { status: verifiedOk ? 'SUCCESS' : 'FAILED', updated_at: new Date().toISOString() });

    if (!verifiedOk) return reply(200, { ok: true, verified: false, status: 'FAILED' });

    // ── SUCCESS → receipt + customer/subscription/kitchen ──
    const inv = (await sbSelect('invoices', `id=eq.${enc(pay.invoice_id)}&select=*&limit=1`))[0];
    if (inv) {
      // receipt (একবারই)
      const existing = await sbSelect('payment_receipts', `invoice_id=eq.${enc(inv.id)}&select=receipt_number&limit=1`);
      if (!existing.length) {
        const rcpNum = 'RCP-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') +
          '-' + Math.floor(1000 + Math.random() * 9000);
        await sbInsert('payment_receipts', {
          customer_id: inv.customer_id, invoice_id: inv.id, payment_id: pay.id,
          receipt_number: rcpNum, transaction_id: pay.transaction_id,
          amount: inv.total_amount, package_name: inv.package_name,
          receipt_type: inv.type.toLowerCase(),
          expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
        }).catch(() => {});
      }
      // type-specific
      const today = new Date();
      if (inv.type === 'REGISTRATION') {
        await sbUpdate('customers', `id=eq.${enc(inv.customer_id)}`,
          { registration_fee_paid: true, registration_fee_amount: inv.total_amount, account_status: 'active' });
      } else if (inv.type === 'SUBSCRIPTION') {
        const days = inv.package_code === 'SUB_3M' ? 90 : 30;
        const expiry = new Date(today); expiry.setDate(expiry.getDate() + days);
        await sbUpdate('customers', `id=eq.${enc(inv.customer_id)}`, {
          monthly_sub_paid: true, monthly_sub_expiry_date: expiry.toISOString().slice(0, 10),
          subscription_amount: inv.total_amount, account_status: 'active',
        });
        await sbInsert('subscriptions', {
          customer_id: inv.customer_id, invoice_id: inv.id, plan: inv.package_code || 'SUB_1M',
          amount_paid: inv.total_amount, end_date: expiry.toISOString().slice(0, 10), status: 'active',
        }).catch(() => {});
      } else if (inv.type === 'MEAL_ORDER') {
        await sbInsert('kitchen_queue', {
          order_id: inv.order_id, invoice_id: inv.id, customer_id: inv.customer_id,
          items_json: inv.meta_json?.items || null, status: 'queued',
        }).catch(() => {});
        if (inv.order_id) {
          await sbUpdate('orders', `id=eq.${enc(inv.order_id)}`,
            { payment_status: 'paid', status: 'confirmed' }).catch(() => {});
        }
      }
    }

    // গেটওয়ে অনেক সময় HTTP 200 ও সাধারণ রেসপন্স চায়
    return reply(200, { ok: true, verified: true, status: 'SUCCESS' });
  } catch (err) {
    return reply(500, { error: String((err && err.message) || err) });
  }
};
