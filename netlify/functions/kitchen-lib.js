// netlify/functions/kitchen-lib.js
// Shared kitchen backend logic for sar.js

const crypto = require('crypto');

const KITCHEN_STATUSES = [
  'queued', 'claimed', 'preparing', 'ready', 'out_for_delivery', 'served', 'declined',
];

const KITCHEN_TO_ORDER_STATUS = {
  queued:            'confirmed',
  claimed:           'confirmed',
  preparing:         'preparing',
  ready:             'ready',
  out_for_delivery:  'out_for_delivery',
  served:            'delivered',
  declined:          'cancelled',
};

const KITCHEN_ROLES = [
  'super_admin', 'admin', 'kitchen_manager', 'cook', 'assistant_cook',
  'quality_checker', 'delivery_manager', 'floor_manager',
];

const ROLE_PERMISSIONS = {
  super_admin:       ['view', 'claim', 'assign', 'reassign', 'prepare', 'verify', 'ready', 'deliver', 'decline', 'recipe', 'manage_staff', 'priority'],
  admin:             ['view', 'claim', 'assign', 'reassign', 'prepare', 'verify', 'ready', 'deliver', 'decline', 'recipe', 'manage_staff', 'priority'],
  kitchen_manager:   ['view', 'claim', 'assign', 'reassign', 'prepare', 'verify', 'ready', 'deliver', 'decline', 'recipe', 'priority'],
  cook:              ['view', 'claim', 'prepare', 'recipe'],
  assistant_cook:    ['view', 'recipe'],
  quality_checker:   ['view', 'verify', 'ready', 'recipe'],
  delivery_manager:  ['view', 'deliver', 'recipe'],
  floor_manager:     ['view', 'claim', 'prepare', 'ready', 'deliver', 'recipe'],
};

const STATUS_PERMISSION = {
  claimed:          'claim',
  preparing:        'prepare',
  ready:            'ready',
  out_for_delivery: 'deliver',
  served:           'deliver',
  declined:         'decline',
};

const SESSION_HOURS = 12;

function hashPassword(pass) {
  return crypto.createHash('sha256').update(String(pass)).digest('hex');
}

function verifyPassword(stored, pass) {
  if (!stored) return false;
  const h = hashPassword(pass);
  if (stored === pass) return true;          // legacy plain text
  if (stored === h) return true;             // sha256
  return false;
}

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hasPermission(role, perm) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(perm);
}

function canTransition(role, fromStatus, toStatus) {
  const perm = STATUS_PERMISSION[toStatus];
  if (!perm) return hasPermission(role, 'view');
  return hasPermission(role, perm);
}

function mapKitchenToOrderStatus(kitchenStatus) {
  return KITCHEN_TO_ORDER_STATUS[kitchenStatus] || null;
}

function parseItemCourses(it) {
  const detail = Array.isArray(it.courseDetail) ? it.courseDetail
    : Array.isArray(it.course_detail) ? it.course_detail : [];
  return detail.map((c, i) => ({
    slot:        i + 1,
    name_bn:     c.name || c.name_bn || ('কোর্স ' + (i + 1)),
    kcal:        c.kcal || null,
    ingredients: (c.items || c.ingredients || []).map(g =>
      typeof g === 'string' ? { item: g, grams: '' } : g),
    steps:       c.steps || [],
  }));
}

function buildOrderTicket(o, cust) {
  const items = Array.isArray(o.items_json) ? o.items_json : [];
  const orderItems = items.map((it, idx) => {
    const medicinals = []
      .concat(it.diseasePowders || it.disease_powders || [])
      .concat(it.conditionPowders || it.condition_powders || [])
      .filter(Boolean);
    return {
      index:        idx,
      menu_item_id: it.menu_item_id || it.id || null,
      menu_code:    it.code || it.menu_code || '',
      name_bn:      it.name_bn || it.name || 'থেরাপিউটিক মিল',
      name_en:      it.name || '',
      meal_type:    it.meal || it.meal_bn || '',
      day:          it.day || '',
      kcal:         it.kcal || 0,
      protein:      it.protein || 0,
      course_count: it.courseCount || it.course_count || (it.courses ? it.courses.length : 0),
      courses:      parseItemCourses(it),
      medicinals,
      chutney:      it.chutney || '',
      topping:      it.topping || '',
      special_note: it.note || '',
      allergens:    [it.has_egg ? 'ডিম' : null, it.has_chicken ? 'মুরগি' : null].filter(Boolean),
    };
  });

  const totalKcal    = orderItems.reduce((s, i) => s + (i.kcal || 0), 0);
  const totalProtein = orderItems.reduce((s, i) => s + (i.protein || 0), 0);
  const totalCourses = orderItems.reduce((s, i) => s + (i.course_count || i.courses.length || 0), 0);

  const payMethod = o.payment_method || (o.order_type === 'delivery' ? 'COD' : '');
  const ks = o.kitchen_status || 'queued';

  return {
    id:                    o.id,
    order_id:              o.order_number || o.id,
    real_order_id:         o.id,
    customer_name:         cust.full_name || 'গ্রাহক',
    customer_phone:        cust.phone || '',
    order_type:            o.order_type || 'delivery',
    payment_status:        o.payment_status || 'pending',
    payment_method:        payMethod,
    items:                 orderItems,
    item_count:            orderItems.length,
    total_kcal:            totalKcal,
    total_protein:         totalProtein,
    course_count:          totalCourses,
    special_instructions:  o.special_instructions || '',
    kitchen_notes:         o.kitchen_notes || '',
    status:                ks,
    claimed_by:            o.claimed_by || null,
    claimed_at:            o.claimed_at || null,
    assigned_by:           o.assigned_by || null,
    expected_ready_at:     o.expected_ready_at || null,
    estimated_time_minutes:o.estimated_time_minutes || 15,
    verification_completed:o.verification_completed || false,
    verified_by:           o.verified_by || null,
    is_priority:           !!o.is_priority,
    is_rush:               !!o.is_rush,
    created_at:            o.created_at,
    updated_at:            o.updated_at,
  };
}

function kitchenQueueFilter(o) {
  if (['cancelled', 'delivered'].includes(o.status)) return false;
  if (['served', 'declined'].includes(o.kitchen_status)) return false;
  const pay = o.payment_status || 'pending';
  const allowedPay = ['paid', 'pending'];
  if (!allowedPay.includes(pay)) return false;
  const st = o.status || 'confirmed';
  const allowedOrder = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];
  return allowedOrder.includes(st) || !o.status;
}

function estimateReadyAt(minutes) {
  return new Date(Date.now() + (minutes || 15) * 60000).toISOString();
}

async function sbFetch(url, SB, opts) {
  const r = await fetch(url, { ...opts, headers: { ...SB, ...(opts && opts.headers) } });
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  return { ok: r.ok, status: r.status, data };
}

async function validateSession(SUPABASE_URL, SB, token) {
  if (!token) return null;
  const now = new Date().toISOString();
  const url = `${SUPABASE_URL}/rest/v1/kitchen_sessions`
    + `?token=eq.${encodeURIComponent(token)}`
    + `&expires_at=gt.${encodeURIComponent(now)}`
    + `&select=*&limit=1`;
  const { ok, data } = await sbFetch(url, SB);
  if (!ok || !Array.isArray(data) || !data[0]) return null;
  return data[0];
}

async function writeAudit(SUPABASE_URL, SB, row) {
  await sbFetch(`${SUPABASE_URL}/rest/v1/kitchen_audit_log`, SB, {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  }).catch(() => null);
}

async function getOrderById(SUPABASE_URL, SB, id) {
  const url = `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(id)}&select=*&limit=1`;
  const { data } = await sbFetch(url, SB);
  return Array.isArray(data) ? data[0] : null;
}

function buildStatusPatch(toStatus, staff, opts) {
  const patch = {
    kitchen_status: toStatus,
    updated_at:   new Date().toISOString(),
  };
  const orderStatus = mapKitchenToOrderStatus(toStatus);
  if (orderStatus) patch.status = orderStatus;

  if (toStatus === 'claimed' || toStatus === 'preparing') {
    patch.claimed_by = opts.claimed_by || staff.staff_name;
    patch.claimed_at = new Date().toISOString();
    patch.expected_ready_at = estimateReadyAt(opts.eta_minutes || 15);
  }
  if (toStatus === 'preparing' && opts.assigned_by) {
    patch.assigned_by = opts.assigned_by;
  }
  if (toStatus === 'ready' && opts.verified) {
    patch.verification_completed = true;
    patch.verified_by = staff.staff_name;
    patch.verified_at = new Date().toISOString();
  }
  if (toStatus === 'served') {
    if (!opts.verified && opts.require_verification) {
      return { error: 'verification_required' };
    }
  }
  if (opts.is_priority != null) patch.is_priority = !!opts.is_priority;
  if (opts.is_rush != null) patch.is_rush = !!opts.is_rush;

  return { patch };
}

module.exports = {
  KITCHEN_STATUSES,
  KITCHEN_TO_ORDER_STATUS,
  KITCHEN_ROLES,
  ROLE_PERMISSIONS,
  SESSION_HOURS,
  hashPassword,
  verifyPassword,
  genToken,
  hasPermission,
  canTransition,
  mapKitchenToOrderStatus,
  parseItemCourses,
  buildOrderTicket,
  kitchenQueueFilter,
  estimateReadyAt,
  sbFetch,
  validateSession,
  writeAudit,
  getOrderById,
  buildStatusPatch,
};
