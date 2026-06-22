// netlify/functions/payment.js
// ─────────────────────────────────────────────────────────────
// SAR — Payment Orchestrator (single secure proxy)
// সব invoice / payment / verify / receipt কল এখানে আসে।
// service_role key শুধু এখানে — কখনো ব্রাউজারে নয়।
//
// Netlify → Site settings → Environment variables:
//   SUPABASE_URL          https://xlkrggspepnysbouatec.supabase.co
//   SUPABASE_SERVICE_KEY  service_role key (SECRET, server-only)
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xlkrggspepnysbouatec.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// ── SSLCommerz config (sandbox default; production env var দিয়ে override) ──
const SSLC_STORE_ID  = process.env.SSLC_STORE_ID  || 'mindm6a3106b7b4ee1';
const SSLC_STORE_PWD = process.env.SSLC_STORE_PWD || 'mindm6a3106b7b4ee1@ssl';
const SSLC_IS_LIVE   = process.env.SSLC_IS_LIVE === 'true'; // false = sandbox
const SSLC_API = SSLC_IS_LIVE
  ? 'https://securepay.sslcommerz.com/gwprocess/v4/api.php'
  : 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php';
const SSLC_VALIDATE = SSLC_IS_LIVE
  ? 'https://securepay.sslcommerz.com/validator/api/validationserverAPI.php'
  : 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php';
const SITE_URL = process.env.SITE_URL || 'https://sheairestaurant.com';

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

// ── Supabase REST helpers ───────────────────────────────────
async function sbInsert(table, row, prefer = 'return=representation') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB, Prefer: prefer },
    body: JSON.stringify(row),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: d };
}

async function sbSelect(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: SB });
  const d = await r.json().catch(() => []);
  return Array.isArray(d) ? d : [];
}

async function sbUpdate(table, query, row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: d };
}

const enc = (v) => encodeURIComponent(v);

// ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST')    return reply(405, { error: 'POST only' });
  if (!SERVICE_KEY) return reply(500, { error: 'Missing SUPABASE_SERVICE_KEY env var' });

  let p;
  try { p = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Bad JSON' }); }

  try {
    switch (p.action) {

      // ══════════════════════════════════════════════════════
      // 1. createInvoice — DRAFT → PENDING invoice তৈরি
      //    body: { customer_id, type, package_code, package_name,
      //            amount, discount, vat, total_amount, order_id?, meta? }
      // ══════════════════════════════════════════════════════
      case 'createInvoice': {
        if (!p.customer_id) return reply(400, { error: 'customer_id required' });

        const row = {
          customer_id:  p.customer_id,
          type:         (p.type || 'SUBSCRIPTION').toUpperCase(),
          package_code: p.package_code || null,
          package_name: p.package_name || null,
          amount:       Number(p.amount || 0),
          discount:     Number(p.discount || 0),
          vat:          Number(p.vat || 0),
          total_amount: Number(p.total_amount || 0),
          order_id:     p.order_id || null,
          status:       'PENDING',
          meta_json:    p.meta || null,
        };
        const res = await sbInsert('invoices', row);
        if (!res.ok) return reply(400, { ok: false, error: res.data });
        const invoice = Array.isArray(res.data) ? res.data[0] : res.data;
        return reply(200, { ok: true, invoice });
      }

      // ══════════════════════════════════════════════════════
      // 2. getInvoice — invoice.html এই কল করে
      //    body: { invoice_id } বা { invoice_number }
      // ══════════════════════════════════════════════════════
      case 'getInvoice': {
        let q;
        if (p.invoice_id)        q = `id=eq.${enc(p.invoice_id)}`;
        else if (p.invoice_number) q = `invoice_number=eq.${enc(p.invoice_number)}`;
        else return reply(400, { error: 'invoice_id or invoice_number required' });

        const rows = await sbSelect('invoices', `${q}&select=*&limit=1`);
        if (!rows.length) return reply(404, { ok: false, error: 'Invoice not found' });
        return reply(200, { ok: true, invoice: rows[0] });
      }

      // ══════════════════════════════════════════════════════
      // 3. createPayment — gateway সেশন/রেকর্ড তৈরি (PROCESSING)
      //    body: { invoice_id, customer_id, gateway, transaction_id }
      // ══════════════════════════════════════════════════════
      case 'createPayment': {
        if (!p.invoice_id) return reply(400, { error: 'invoice_id required' });

        const inv = (await sbSelect('invoices', `id=eq.${enc(p.invoice_id)}&select=*&limit=1`))[0];
        if (!inv) return reply(404, { ok: false, error: 'Invoice not found' });

        const txnId = p.transaction_id ||
          ('TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase());

        const row = {
          customer_id:   inv.customer_id,
          invoice_id:    inv.id,
          payment_type:  (inv.type || 'meal_order').toLowerCase(),
          gateway:       p.gateway || 'manual',
          payment_method: p.gateway || 'manual',
          amount:        inv.amount,
          final_amount:  inv.total_amount,
          transaction_id: txnId,
          status:        'PROCESSING',
          verification_status: 'UNVERIFIED',
          gateway_response_json: { gateway: p.gateway, started_at: new Date().toISOString() },
        };
        const res = await sbInsert('payments', row);
        if (!res.ok) return reply(400, { ok: false, error: res.data, detail: 'payments insert failed' });
        const payment = Array.isArray(res.data) ? res.data[0] : res.data;

        await sbUpdate('invoices', `id=eq.${enc(inv.id)}`, { status: 'PROCESSING', updated_at: new Date().toISOString() });
        return reply(200, { ok: true, payment, transaction_id: txnId });
      }

      // ══════════════════════════════════════════════════════
      // 3b. createSession — SSLCommerz hosted page session তৈরি
      //     body: { invoice_id, transaction_id, customer? }
      //     returns: { ok, GatewayPageURL }
      // ══════════════════════════════════════════════════════
      case 'createSession': {
        if (!p.invoice_id || !p.transaction_id)
          return reply(400, { error: 'invoice_id ও transaction_id লাগবে' });

        const inv = (await sbSelect('invoices', `id=eq.${enc(p.invoice_id)}&select=*&limit=1`))[0];
        if (!inv) return reply(404, { ok: false, error: 'Invoice not found' });

        const cust = p.customer || {};
        const meta = inv.meta_json || {};

        // ── doctor consultation হলে আলাদা success/fail URL (doctor.html-এ ফেরত) ──
        const isDoctor = (meta.purpose === 'doctor') || (inv.type === 'CONSULTATION');
        const successUrl = isDoctor
          ? `${SITE_URL}/.netlify/functions/payment-webhook?redirect=doctor_success`
          : `${SITE_URL}/.netlify/functions/payment-webhook?redirect=success`;
        const failUrl = isDoctor
          ? `${SITE_URL}/.netlify/functions/payment-webhook?redirect=doctor_fail`
          : `${SITE_URL}/.netlify/functions/payment-webhook?redirect=fail`;

        // SSLCommerz form-encoded payload
        const form = {
          store_id:     SSLC_STORE_ID,
          store_passwd: SSLC_STORE_PWD,
          total_amount: Number(inv.total_amount).toFixed(2),
          currency:     'BDT',
          tran_id:      p.transaction_id,
          // gateway → এই URL-গুলোতে গ্রাহককে ফেরত পাঠাবে
          success_url:  successUrl,
          fail_url:     failUrl,
          cancel_url:   isDoctor ? `${SITE_URL}/dashboard.html?paid=cancel` : `${SITE_URL}/invoice.html?inv=${enc(inv.invoice_number)}`,
          ipn_url:      `${SITE_URL}/.netlify/functions/payment-webhook`,
          // গ্রাহক তথ্য
          cus_name:  cust.full_name || 'SAR গ্রাহক',
          cus_email: cust.email || 'guest@sheairestaurant.com',
          cus_phone: cust.phone || '01700000000',
          cus_add1:  meta.delivery_address || 'Dhaka',
          cus_city:  'Dhaka',
          cus_country: 'Bangladesh',
          // পণ্য তথ্য (SSLCommerz এগুলো বাধ্যতামূলক করে)
          shipping_method: meta.order_type === 'delivery' ? 'Courier' : 'NO',
          // shipping_method='Courier' হলে নিচের ship_* ফিল্ডগুলো বাধ্যতামূলক
          ship_name:     cust.full_name || 'SAR গ্রাহক',
          ship_add1:     meta.delivery_address || 'Dhaka',
          ship_city:     'Dhaka',
          ship_state:    'Dhaka',
          ship_postcode: '1200',
          ship_country:  'Bangladesh',
          product_name:    isDoctor ? 'Doctor Consultation' : 'SAR Meal Order',
          product_category: isDoctor ? 'Health' : 'Food',
          product_profile: 'general',
          num_of_item: (meta.items || []).length || 1,
          value_a: inv.invoice_number,   // আমাদের রেফারেন্স (webhook-এ ফেরত আসবে)
          value_b: inv.id,
          value_c: isDoctor ? 'doctor' : 'meal',
          value_d: meta.customer_id || cust.id || '',
        };

        // গ্রাহকের বাছাই করা মাধ্যম সরাসরি খোলে (multi_card_name)
        const GW_MAP = {
          bkash:'bkash', nagad:'nagad', rocket:'dbblmobilebanking', upay:'upay',
          visa:'visacard', mastercard:'mastercard', amex:'amexcard',
          internet_banking:'ibbl',  // উদাহরণ; খালি রাখলে সব অপশন দেখাবে
        };
        if (p.gateway && GW_MAP[p.gateway]) form.multi_card_name = GW_MAP[p.gateway];

        const body = new URLSearchParams(form).toString();
        let sslRes;
        try {
          const r = await fetch(SSLC_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
          });
          sslRes = await r.json();
        } catch (e) {
          return reply(502, { ok: false, error: 'SSLCommerz সংযোগ ব্যর্থ: ' + e.message });
        }

        if (sslRes.status === 'SUCCESS' && sslRes.GatewayPageURL) {
          // session id সংরক্ষণ (পরে validate করার জন্য)
          await sbUpdate('payments', `transaction_id=eq.${enc(p.transaction_id)}`, {
            gateway_response_json: { sessionkey: sslRes.sessionkey, gateway: 'sslcommerz', created_at: new Date().toISOString() },
          }).catch(() => {});
          return reply(200, { ok: true, GatewayPageURL: sslRes.GatewayPageURL, sessionkey: sslRes.sessionkey });
        }
        return reply(400, { ok: false, error: sslRes.failedreason || 'SSLCommerz session তৈরি হয়নি', raw: sslRes });
      }

      // ══════════════════════════════════════════════════════
      // 4. verifyPayment — চূড়ান্ত সত্য যাচাই (server-side)
      //    body: { invoice_id?, transaction_id?, customer_id?,
      //            paid_amount?, gateway_txn_id?, auto? }
      //    auto=true হলে (manual/cash বাদে) সরাসরি VERIFIED ধরা হয়।
      //    নাহলে admin যাচাই করবেন → status PROCESSING-এ থাকবে।
      // ══════════════════════════════════════════════════════
      case 'verifyPayment': {
        let q;
        if (p.transaction_id) q = `transaction_id=eq.${enc(p.transaction_id)}`;
        else if (p.invoice_id) q = `invoice_id=eq.${enc(p.invoice_id)}`;
        else return reply(400, { error: 'transaction_id or invoice_id required' });

        const pay = (await sbSelect('payments', `${q}&select=*&order=created_at.desc&limit=1`))[0];
        if (!pay) {
          // রেকর্ড নেই → admin যাচাইয়ের জন্য নোটিফিকেশন (blocking নয়)
          await sbInsert('notifications_log', {
            customer_id: p.customer_id || null,
            notification_type: 'payment_verify_request',
            trigger_event: 'manual_verify',
            message_preview: `যাচাই অনুরোধ — Txn: ${p.transaction_id || '—'} Amount: ${p.paid_amount || '—'}`,
            status: 'pending',
          }, 'return=minimal').catch(() => {});
          return reply(200, { ok: true, verified: false, pending_admin: true });
        }

        const verified = p.auto === true; // auto-gateway হলে true; manual হলে admin
        const upd = {
          paid_amount: Number(p.paid_amount || pay.final_amount),
          gateway_txn_id: p.gateway_txn_id || pay.gateway_txn_id || null,
          status: verified ? 'SUCCESS' : 'PROCESSING',
          verification_status: verified ? 'VERIFIED' : 'UNVERIFIED',
          verified_at: verified ? new Date().toISOString() : null,
          verified_by: verified ? (p.verified_by || 'system') : null,
          gateway_response_json: {
            ...(pay.gateway_response_json || {}),
            ...(p.sender_number ? { sender_number: p.sender_number } : {}),
            ...(p.gateway_txn_id ? { customer_trxid: p.gateway_txn_id } : {}),
          },
        };
        await sbUpdate('payments', `id=eq.${enc(pay.id)}`, upd);

        if (verified) {
          await sbUpdate('invoices', `id=eq.${enc(pay.invoice_id)}`,
            { status: 'SUCCESS', updated_at: new Date().toISOString() });
        }

        return reply(200, {
          ok: true,
          verified,
          pending_admin: !verified,
          payment_id: pay.id,
          invoice_id: pay.invoice_id,
          transaction_id: pay.transaction_id,
        });
      }

      // ══════════════════════════════════════════════════════
      // 5. finalize — SUCCESS+VERIFIED হলে: receipt + customer update
      //    + (MEAL_ORDER হলে) kitchen_queue + (SUBSCRIPTION হলে) subscriptions
      //    body: { invoice_id, receipt_html? }
      // ══════════════════════════════════════════════════════
      case 'finalize': {
        if (!p.invoice_id) return reply(400, { error: 'invoice_id required' });
        const inv = (await sbSelect('invoices', `id=eq.${enc(p.invoice_id)}&select=*&limit=1`))[0];
        if (!inv) return reply(404, { ok: false, error: 'Invoice not found' });
        const pay = (await sbSelect('payments',
          `invoice_id=eq.${enc(inv.id)}&select=*&order=created_at.desc&limit=1`))[0];
        const res = await finalizeInvoice(inv, pay, p.receipt_html);
        return reply(200, { ok: true, ...res });
      }

      // ══════════════════════════════════════════════════════
      // 6. getReceipt — receipt.html এই কল করে
      //    body: { transaction_id } বা { receipt_number }
      // ══════════════════════════════════════════════════════
      case 'getReceipt': {
        // txn / receipt_number / invoice_number — যেকোনো একটি দিয়ে খোঁজা যায়
        let payment = null, invoice = null, receipt = null;

        if (p.transaction_id) {
          payment = (await sbSelect('payments', `transaction_id=eq.${enc(p.transaction_id)}&select=*&order=created_at.desc&limit=1`))[0] || null;
        }
        if (!payment && p.receipt_number) {
          receipt = (await sbSelect('payment_receipts', `receipt_number=eq.${enc(p.receipt_number)}&select=*&limit=1`))[0] || null;
          if (receipt && receipt.transaction_id)
            payment = (await sbSelect('payments', `transaction_id=eq.${enc(receipt.transaction_id)}&select=*&limit=1`))[0] || null;
        }
        if (!payment && p.invoice_number) {
          invoice = (await sbSelect('invoices', `invoice_number=eq.${enc(p.invoice_number)}&select=*&limit=1`))[0] || null;
          if (invoice)
            payment = (await sbSelect('payments', `invoice_id=eq.${enc(invoice.id)}&select=*&order=created_at.desc&limit=1`))[0] || null;
        }

        // payment থেকে invoice + receipt পূরণ
        if (payment && !invoice && payment.invoice_id)
          invoice = (await sbSelect('invoices', `id=eq.${enc(payment.invoice_id)}&select=*&limit=1`))[0] || null;
        if (payment && !receipt)
          receipt = (await sbSelect('payment_receipts', `transaction_id=eq.${enc(payment.transaction_id)}&select=*&limit=1`))[0] || null;

        if (!payment && !invoice && !receipt)
          return reply(404, { ok: false, error: 'Not found' });

        return reply(200, { ok: true, payment, invoice, receipt });
      }

      // ══════════════════════════════════════════════════════
      // 7. webhook — gateway নিশ্চিত করার পর এক কলেই verify + finalize
      //    payment-webhook.js (বা SSL/bKash callback) এটি কল করে।
      //    body: { transaction_id?, invoice_id?, gateway_status,
      //            paid_amount?, gateway_txn_id? }
      //    gateway_status: 'SUCCESS' হলে receipt তৈরি হয়; নাহলে FAILED।
      // ══════════════════════════════════════════════════════
      case 'webhook': {
        let q;
        if (p.transaction_id) q = `transaction_id=eq.${enc(p.transaction_id)}`;
        else if (p.invoice_id) q = `invoice_id=eq.${enc(p.invoice_id)}`;
        else return reply(400, { error: 'transaction_id or invoice_id required' });

        const pay = (await sbSelect('payments', `${q}&select=*&order=created_at.desc&limit=1`))[0];
        if (!pay) return reply(404, { ok: false, error: 'Payment not found' });

        const ok = String(p.gateway_status || '').toUpperCase() === 'SUCCESS';

        // 7a. payment আপডেট (gateway = চূড়ান্ত সত্য)
        await sbUpdate('payments', `id=eq.${enc(pay.id)}`, {
          paid_amount: Number(p.paid_amount || pay.final_amount),
          gateway_txn_id: p.gateway_txn_id || pay.gateway_txn_id || null,
          status: ok ? 'SUCCESS' : 'FAILED',
          verification_status: ok ? 'VERIFIED' : 'REJECTED',
          verified_at: new Date().toISOString(),
          verified_by: 'gateway_webhook',
          gateway_response_json: { ...(pay.gateway_response_json || {}), webhook: p, at: new Date().toISOString() },
        });
        await sbUpdate('invoices', `id=eq.${enc(pay.invoice_id)}`,
          { status: ok ? 'SUCCESS' : 'FAILED', updated_at: new Date().toISOString() });

        if (!ok) return reply(200, { ok: true, verified: false, status: 'FAILED' });

        // 7b. finalize (receipt + customer/subscription/kitchen) — finalize কেস পুনঃব্যবহার
        const inv = (await sbSelect('invoices', `id=eq.${enc(pay.invoice_id)}&select=*&limit=1`))[0];
        const finalRes = await finalizeInvoice(inv, pay, p.receipt_html);
        return reply(200, { ok: true, verified: true, status: 'SUCCESS', ...finalRes });
      }

      default:
        return reply(400, { error: 'Unknown action: ' + p.action });
    }
  } catch (err) {
    return reply(500, { error: String((err && err.message) || err) });
  }
};

// ─────────────────────────────────────────────────────────────
// finalizeInvoice — receipt + customer/subscription/kitchen তৈরি
// (finalize ও webhook উভয়ে ব্যবহার করে; idempotent)
// ─────────────────────────────────────────────────────────────
async function finalizeInvoice(inv, pay, receiptHtml) {
  if (!inv || !pay || pay.status !== 'SUCCESS' || pay.verification_status !== 'VERIFIED') {
    return { finalized: false, reason: 'payment not verified' };
  }
  const existing = await sbSelect('payment_receipts',
    `invoice_id=eq.${enc(inv.id)}&select=receipt_number&limit=1`);
  let receiptNumber = existing[0]?.receipt_number;

  if (!receiptNumber) {
    receiptNumber = 'RCP-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' + Math.floor(1000 + Math.random() * 9000);
    await sbInsert('payment_receipts', {
      customer_id: inv.customer_id, invoice_id: inv.id, payment_id: pay.id,
      receipt_number: receiptNumber, transaction_id: pay.transaction_id,
      amount: inv.total_amount, package_name: inv.package_name,
      receipt_type: inv.type.toLowerCase(), receipt_html: receiptHtml || null,
      expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
    }, 'return=minimal').catch(() => {});
  }

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
    }, 'return=minimal').catch(() => {});
  } else if (inv.type === 'MEAL_ORDER') {
    await sbInsert('kitchen_queue', {
      order_id: inv.order_id, invoice_id: inv.id, customer_id: inv.customer_id,
      items_json: inv.meta_json?.items || null, status: 'queued',
    }, 'return=minimal').catch(() => {});
    if (inv.order_id) {
      await sbUpdate('orders', `id=eq.${enc(inv.order_id)}`,
        { payment_status: 'paid', status: 'confirmed' }).catch(() => {});
    }
  }
  return { finalized: true, receipt_number: receiptNumber };
}
