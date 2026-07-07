
const SUPA_URL = 'https://xlkrggspepnysbouatec.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhsa3JnZ3NwZXBueXNib3VhdGVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MTU0OTEsImV4cCI6MjA5NTA5MTQ5MX0.dCAkAXL1EDNsxTBn8mcHcUHlXJ1xDBirwBdTgIq927U';
const H = {'apikey':SUPA_KEY,'Authorization':'Bearer '+SUPA_KEY,'Content-Type':'application/json'};

// Load patient from session (set by dashboard openDoctorPortal)
let patient = {};
let currentRxData = null;

// ═══ DOCTOR PAYMENT GATE (ধাপ ১) ═══
const SUPER_ADMIN_PHONE = '01767626653';   // super admin — payment ছাড়াই ঢোকে

// gate পাস করেছে কিনা — super admin, বা আজকের paid session
function doctorAccessAllowed(){
  const sc = JSON.parse(localStorage.getItem('sar_customer')||'{}');
  // 1) super admin bypass
  if(sc.phone === SUPER_ADMIN_PHONE) return true;
  // 2) আজকের জন্য paid session (localStorage — ধাপ ৩-এ Supabase verify যোগ হবে)
  try{
    const ds = JSON.parse(localStorage.getItem('sar_doctor_session')||'{}');
    const today = new Date().toISOString().slice(0,10);
    if(ds.paid && ds.date === today) return true;
  }catch(e){}
  // 3) SSLCommerz থেকে ?paid=ok নিয়ে ফিরলে (ধাপ ৩-এ verify হবে)
  const q = new URLSearchParams(location.search);
  if(q.get('paid') === 'ok'){
    const today = new Date().toISOString().slice(0,10);
    localStorage.setItem('sar_doctor_session', JSON.stringify({paid:true, date:today, tran:q.get('tran')||''}));
    return true;
  }
  return false;
}

function showPayGate(){
  document.getElementById('payGate').style.display = 'block';
}

// ধাপ ২: আসল SSLCommerz payment — createInvoice → createSession → gateway
async function startDoctorPayment(){
  const btn = document.getElementById('payGateBtn');
  const msg = document.getElementById('payGateMsg');
  const sc = JSON.parse(localStorage.getItem('sar_customer')||'{}');
  if(!sc.id){
    msg.textContent = '⚠️ আগে লগইন করুন (গ্রাহক তথ্য পাওয়া যায়নি)।';
    return;
  }
  btn.disabled = true; btn.textContent = 'পেমেন্ট পেজ তৈরি হচ্ছে...';
  msg.textContent = '';
  const PAY = '/.netlify/functions/payment';
  try{
    // 1) invoice তৈরি (৭৫০৳ consultation)
    const invRes = await fetch(PAY, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        action:'createInvoice',
        customer_id: sc.id,
        type:'CONSULTATION',
        package_name:'Doctor Consultation',
        amount:750, total_amount:750,
        meta:{ purpose:'doctor', customer_id:sc.id }
      })
    });
    const invD = await invRes.json();
    if(!invD.ok || !invD.invoice){ throw new Error(invD.error||'invoice তৈরি ব্যর্থ'); }

    // 2) transaction id + payment session
    const txnId = 'DOC-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
    // createPayment (PROCESSING রেকর্ড) — payment.js এই ধাপ চায়
    await fetch(PAY, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        action:'createPayment',
        invoice_id: invD.invoice.id, customer_id: sc.id,
        gateway:'sslcommerz', transaction_id: txnId
      })
    }).catch(()=>{});

    // 3) SSLCommerz session → GatewayPageURL
    const sesRes = await fetch(PAY, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        action:'createSession',
        invoice_id: invD.invoice.id, transaction_id: txnId,
        customer:{ id:sc.id, full_name:sc.full_name, email:sc.email, phone:sc.phone }
      })
    });
    const sesD = await sesRes.json();
    if(sesD.ok && sesD.GatewayPageURL){
      msg.textContent = '✓ নিরাপদ পেমেন্ট পেজে নিয়ে যাওয়া হচ্ছে...';
      window.location.href = sesD.GatewayPageURL;   // SSLCommerz hosted page
    } else {
      throw new Error(sesD.error||'পেমেন্ট সেশন তৈরি হয়নি');
    }
  }catch(e){
    btn.disabled = false; btn.textContent = '৳৭৫০ দিয়ে পরামর্শ শুরু করুন →';
    msg.textContent = '❌ '+e.message;
  }
}

async function init(){
  // ── PAYMENT GATE: অনুমতি না থাকলে gate দেখিয়ে থামি ──
  if(!doctorAccessAllowed()){
    showPayGate();
    return;
  }

  // Try sessionStorage first (from dashboard)
  const stored = sessionStorage.getItem('doctor_patient');
  if(stored){
    patient = JSON.parse(stored);
  } else {
    // Fallback: use logged-in customer
    const sc = JSON.parse(localStorage.getItem('sar_customer')||'{}');
    patient = { id:sc.id, name:sc.full_name, member_id:sc.member_id,
      category:sc.sar_category, bmi:sc.bmi, age:'', metrics:{}, complaint:'' };
  }
  renderPatientCard();
  loadApprovedRx();

  // Load metrics from Supabase
  if(patient.id){
    try{
      const r = await fetch(`${SUPA_URL}/rest/v1/customer_metrics?customer_id=eq.${patient.id}&order=updated_at.desc&limit=1&select=*`,{headers:H});
      const d = await r.json();
      if(d?.[0]) patient.metrics = d[0];
    } catch(e){}
    renderMetrics();
  } else {
    renderMetricsFallback();
  }
}

function renderPatientCard(){
  document.getElementById('patName').textContent = patient.name || 'SAR গ্রাহক';
  document.getElementById('patMid').textContent  = patient.member_id || '—';
  const cat = patient.category || 'DM';
  const catNames = {DM:'ডায়াবেটিস',OB:'স্থূলতা',FL:'ফ্যাটি লিভার',IB:'IBS',PR:'গর্ভাবস্থা'};
  const ageStr = patient.age ? `বয়স: ${patient.age} বছর · ` : '';
  const bmiStr = patient.bmi ? `BMI: ${parseFloat(patient.bmi).toFixed(1)} · ` : '';
  document.getElementById('patMeta').innerHTML = `${ageStr}${bmiStr}<span class="cat-badge cat-${cat}">${catNames[cat]||cat}</span>`;
}

function renderMetrics(){
  const m = patient.metrics || {};
  const KEY_METRICS = [
    {k:'bmi',               l:'BMI',             ok:[18.5,24.9], warn:[25,29.9]},
    {k:'fbg_mmol',          l:'FBG (mmol/L)',     ok:[3.9,5.9],   warn:[6,6.9]},
    {k:'hba1c_percent',     l:'HbA1c (%)',        ok:[0,5.6],     warn:[5.7,6.4]},
    {k:'systolic_bp',       l:'সিস্টোলিক BP',    ok:[90,120],    warn:[121,139]},
    {k:'diastolic_bp',      l:'ডায়াস্টোলিক BP', ok:[60,80],     warn:[81,89]},
    {k:'total_cholesterol', l:'কোলেস্টেরল',      ok:[0,199],     warn:[200,239]},
    {k:'hemoglobin_g_dl',   l:'হিমোগ্লোবিন',     ok:[11,16],     warn:[10,10.9]},
    {k:'alt_u_l',           l:'ALT',              ok:[0,40],      warn:[41,60]},
    {k:'creatinine_mg_dl',  l:'ক্রিয়েটিনিন',    ok:[0.6,1.1],   warn:[1.2,1.5]},
    {k:'triglycerides',     l:'ট্রাইগ্লিসেরাইড', ok:[0,149],     warn:[150,199]},
    {k:'weight_kg',         l:'ওজন (কেজি)',       ok:[null,null], warn:[null,null]},
    {k:'height_cm',         l:'উচ্চতা (সেমি)',    ok:[null,null], warn:[null,null]},
  ];

  const el = document.getElementById('metricsList');
  const rows = KEY_METRICS.map(km => {
    const val = m[km.k] || patient[km.k] || null;
    if(!val) return '';
    const n = parseFloat(val);
    let cls = 'normal';
    if(km.ok[0]!==null){
      if(n >= km.ok[0] && n <= km.ok[1]) cls = 'ok';
      else if(n >= km.warn[0] && n <= km.warn[1]) cls = 'warn';
      else cls = 'bad';
    }
    return `<div class="metric-row">
      <span class="metric-key">${km.l}</span>
      <span class="metric-val ${cls}">${val}</span>
    </div>`;
  }).filter(Boolean);

  if(!rows.length){
    el.innerHTML = '<div style="color:#9A7A8A;font-size:.78rem;text-align:center;padding:.75rem">মেট্রিক্স পাওয়া যায়নি। metrics.html থেকে আপডেট করুন।</div>';
    return;
  }
  el.innerHTML = rows.join('') +
    `<a href="metrics.html" target="_blank" style="display:block;text-align:center;margin-top:.5rem;font-size:.72rem;color:var(--teal2);text-decoration:none;padding:.3rem">📊 সম্পূর্ণ ২৫০ মেট্রিক্স দেখুন →</a>`;
}

function renderMetricsFallback(){
  document.getElementById('metricsList').innerHTML =
    '<div style="color:#9A7A8A;font-size:.78rem;text-align:center;padding:.75rem">Dashboard থেকে এই পোর্টাল খুলুন অথবা <a href="metrics.html" target="_blank" style="color:var(--teal2)">মেট্রিক্স</a> আপডেট করুন।</div>';
}

// ── AI ANALYSIS via Anthropic API ──
// ── এক ফি = এক prescription; super admin (01767626653) এর কোনো limit নেই ──
function checkAnalysisLimit(){
  // super admin — unlimited, fee ছাড়াই যত খুশি
  const myPhone = (patient && patient.phone) || JSON.parse(localStorage.getItem('sar_customer')||'{}').phone || '';
  if(myPhone === SUPER_ADMIN_PHONE) return true;

  const cid = (patient && patient.id) || 'guest';
  const key = 'sar_analysis_count_' + cid;
  let rec = {};
  try{ rec = JSON.parse(localStorage.getItem(key) || '{}'); }catch(e){}
  const now = Date.now();
  if(!rec.start || (now - rec.start) > 3600000){ rec = { start: now, count: 0 }; }
  if(rec.count >= 1){
    showToast('⚠️ এই পরামর্শে একবারই বিশ্লেষণ করা যায়। নতুন পরামর্শের জন্য আবার ফি দিন।');
    return false;
  }
  rec.count++;
  localStorage.setItem(key, JSON.stringify(rec));
  return true;
}

// ── prescription কে pending হিসেবে consultation-এ পাঠায় (ডাক্তার-sign ছাড়া) ──
async function sendForApproval(){
  const rows = document.querySelectorAll('#rxRows .rx-grid');
  const editedRx = [...rows].map(row => {
    const inputs = row.querySelectorAll('.rx-input');
    return { cat:inputs[0]?.value, generic:inputs[1]?.value, note:inputs[2]?.value };
  }).filter(r=>r.generic);
  const complaint    = document.getElementById('complaint').value || '';
  const aiAssess     = document.getElementById('aiAssessText').textContent || '';
  const general      = (document.getElementById('rxGeneral')||{}).value || '';
  const home         = (document.getElementById('rxHome')||{}).value || '';
  const ayurvedic    = (document.getElementById('rxAyurvedic')||{}).value || '';
  const unani        = (document.getElementById('rxUnani')||{}).value || '';
  const homeopathic  = (document.getElementById('rxHomeopathic')||{}).value || '';
  const islamic      = (document.getElementById('rxIslamic')||{}).value || '';
  const dangers      = (document.getElementById('rxDangers')||{}).value || '';
  if(!editedRx.length && !aiAssess){ showSignMsg('আগে AI বিশ্লেষণ চালান।', false); return; }
  const noteText =
    `অভিযোগ: ${complaint}\n\nAI মূল্যায়ন: ${aiAssess}\n\n`
    + `ঔষধ:\n${editedRx.map((r,i)=>`${i+1}. ${r.generic} — ${r.note}`).join('\n')}\n\n`
    + `সাধারণ নির্দেশনা: ${general}\n\nঘরোয়া প্রতিকার: ${home}\n\n`
    + `আয়ুর্বেদিক পরামর্শ: ${ayurvedic}\n\nইউনানি পরামর্শ: ${unani}\n\nহোমিওপ্যাথিক পরামর্শ: ${homeopathic}\n\n`
    + `ইসলামিক/আধ্যাত্মিক সহায়তা: ${islamic}\n\nবিপদ সংকেত: ${dangers}`;
  try{
    const r = await fetch(`${SUPA_URL}/rest/v1/sar_notes`,{
      method:'POST', headers:{...H,'Prefer':'return=minimal'},
      body:JSON.stringify({
        customer_id: patient.id, note_type: 'prescription',
        rx_status: 'pending', is_resolved: false, note_text_bn: noteText,
      })
    });
    if(r.ok){
      showSignMsg('✅ প্রেসক্রিপশন অনুমোদনের জন্য পাঠানো হয়েছে। ডাক্তার অনুমোদন দিলে SMS পাবেন ও এখানে PDF লিংক আসবে।', true);
      showToast('📤 অনুমোদনের জন্য পাঠানো হয়েছে');
    }else{
      const t = await r.text().catch(()=>''); showSignMsg('❌ পাঠানো যায়নি: '+t, false);
    }
  }catch(e){ showSignMsg('❌ পাঠানো ব্যর্থ: '+e.message, false); }
}

// ── approved prescription PDF link দেখানো ──
// প্রেসক্রিপশন panel collapsible
function toggleRxPanel(){
  const box = document.getElementById('myRxBox');
  const arrow = document.getElementById('rxPanelArrow');
  if(!box) return;
  const hidden = box.style.display === 'none';
  box.style.display = hidden ? 'block' : 'none';
  if(arrow) arrow.style.transform = hidden ? 'rotate(0deg)' : 'rotate(-90deg)';
}

// ── AI ব্যর্থ হলে admin debugging-এর জন্য technical detail টগল ──
function toggleAiDebug(){
  const box = document.getElementById('aiDebugBox');
  if(!box) return;
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function loadApprovedRx(){
  const card = document.getElementById('myRxCard');
  const box = document.getElementById('myRxBox');
  if(!box || !patient || !patient.id) return;
  if(card) card.style.display = 'block';   // সবসময় দেখাই
  box.innerHTML = '<div style="font-size:.8rem;color:#8A6C7C">লোড হচ্ছে...</div>';
  try{
    const r = await fetch(`${SUPA_URL}/rest/v1/sar_notes?customer_id=eq.${patient.id}&note_type=eq.prescription&order=created_at.desc&limit=5&select=*`, {headers:H});
    const list = r.ok ? await r.json() : [];
    if(!Array.isArray(list) || !list.length){
      box.innerHTML = '<div style="font-size:.82rem;color:#8A6C7C">এখনো কোনো প্রেসক্রিপশন নেই। উপরে অভিযোগ লিখে AI বিশ্লেষণ করুন।</div>';
      return;
    }
    box.innerHTML = list.map(n=>{
      const status = n.rx_status || (n.is_resolved ? 'approved' : 'pending');
      const date = (n.approved_at||n.created_at||'').split('T')[0];
      if(status === 'approved'){
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.7rem 1rem;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.3);border-radius:14px;margin-bottom:.55rem">
          <div><div style="font-size:.85rem;color:#00793D;font-weight:700">✓ অনুমোদিত</div>
          <div style="font-size:.72rem;color:#7A6B78">${date} · ${n.approved_by||''}</div></div>
          ${n.pdf_url ? `<a href="${n.pdf_url}" target="_blank" style="background:#00A651;color:#fff;padding:.5rem 1.1rem;border-radius:50px;text-decoration:none;font-size:.82rem;font-weight:700">📄 প্রেসক্রিপশন দেখুন</a>` : '<span style="font-size:.72rem;color:#8A6C7C">অপেক্ষমাণ</span>'}
        </div>`;
      } else {
        return `<div style="padding:.7rem 1rem;background:rgba(245,166,35,.08);border:1px solid rgba(245,166,35,.3);border-radius:14px;margin-bottom:.55rem">
          <div style="font-size:.82rem;color:#B8722B;font-weight:700;margin-bottom:.35rem">⏳ ডাক্তার অনুমোদনের অপেক্ষায় (${date})</div>
          <div style="font-size:.78rem;color:#4A3F49;white-space:pre-wrap;max-height:120px;overflow:auto">${(n.note_text_bn||'').slice(0,300)}${(n.note_text_bn||'').length>300?'...':''}</div>
          <div style="font-size:.7rem;color:#8A6C7C;margin-top:.35rem">অনুমোদনের পর PDF ডাউনলোড করা যাবে।</div>
        </div>`;
      }
    }).join('');
  }catch(e){
    box.innerHTML = '<div style="font-size:.8rem;color:#DC2626">লোড করা যায়নি।</div>';
  }
}

// ── AI উত্তর robust parse: সম্পূর্ণ বা অসম্পূর্ণ/কাটা JSON দুটোই সামলায় ──
function robustParseAI(text){
  if(!text) return { assessment:'—' };
  let clean = text.replace(/```json|```/g,'').trim();
  const a = clean.indexOf('{');
  if(a > -1) clean = clean.slice(a);
  // ১) সম্পূর্ণ JSON চেষ্টা
  try{
    const b = clean.lastIndexOf('}');
    if(b > 0) return JSON.parse(clean.slice(0, b+1));
  }catch(e){}
  // ২) কাটা JSON — field গুলো regex দিয়ে উদ্ধার
  const grab = (key)=>{
    const m = clean.match(new RegExp('"'+key+'"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
    return m ? m[1].replace(/\\"/g,'"').replace(/\\n/g,'\n') : '';
  };
  // rx array আলাদা করে
  let rx = [];
  const rxBlock = clean.match(/"rx"\s*:\s*\[([\s\S]*?)(\]|$)/);
  if(rxBlock){
    const items = rxBlock[1].match(/\{[^{}]*\}/g) || [];
    items.forEach(it=>{
      try{ const o = JSON.parse(it); if(o.generic) rx.push(o); }
      catch(e){
        const g = it.match(/"generic"\s*:\s*"([^"]*)"/);
        const nt = it.match(/"note"\s*:\s*"([^"]*)"/);
        const ct = it.match(/"cat"\s*:\s*"([^"]*)"/);
        if(g) rx.push({ cat:ct?ct[1]:'', generic:g[1], note:nt?nt[1]:'' });
      }
    });
  }
  return {
    assessment: grab('assessment') || text.slice(0,300),
    rx,
    general: grab('general'),
    home: grab('home'),
    islamic: grab('islamic'),
    dangers: grab('dangers'),
    alerts: grab('alerts'),
  };
}

// ═══════════════════════════════════════════════════════════════
// ৯০/১০ পলিসি — RULE ENGINE (নির্ধারক, তাৎক্ষণিক, কোনো API/নেটওয়ার্ক
// নির্ভরতা নেই) ক্লিনিক্যাল প্রেসক্রিপশন-ড্রাফটের ৯০% এখান থেকে আসে।
// Claude (AI) শুধু চূড়ান্ত assessment/islamic ভাষা পালিশ করে (১০%) —
// AI ব্যর্থ/ধীর হলেও ডাক্তার সম্পূর্ণ, নিরাপদ ড্রাফট তাৎক্ষণিক দেখেন।
// sar_rule_engine.js-এর DISEASE_PROFILES/CONDITION_PROFILES-এর প্যাটার্ন
// অনুসরণ করে সংক্ষিপ্ত আকারে এখানে বসানো হয়েছে (browser-side, dependency ছাড়া)।
// ═══════════════════════════════════════════════════════════════

// মেট্রিক্স-ভিত্তিক ঝুঁকি নিয়ম (analyze.js-এর runRuleEngine থ্রেশহোল্ডের সাথে সামঞ্জস্যপূর্ণ)
const CLINICAL_RISK_RULES = [
  { key:'hba1c_percent',     op:'gte',   t:8,             level:'critical', msg:'HbA1c গুরুতর উচ্চ — ডায়াবেটিক জটিলতার ঝুঁকি' },
  { key:'hba1c_percent',     op:'range', t:6.5,  t2:7.9,   level:'high',     msg:'HbA1c নিয়ন্ত্রণের বাইরে' },
  { key:'systolic_bp',       op:'gte',   t:160,           level:'critical', msg:'উচ্চ রক্তচাপ — জরুরি মনোযোগ প্রয়োজন' },
  { key:'systolic_bp',       op:'range', t:140,  t2:159,   level:'high',     msg:'রক্তচাপ স্বাভাবিকের চেয়ে বেশি' },
  { key:'hemoglobin_g_dl',   op:'lt',    t:10,            level:'high',     msg:'গুরুতর রক্তস্বল্পতা' },
  { key:'hemoglobin_g_dl',   op:'range', t:10,   t2:10.9,  level:'medium',   msg:'হালকা রক্তস্বল্পতা' },
  { key:'alt_u_l',           op:'gte',   t:56,            level:'medium',   msg:'লিভার এনজাইম (ALT) বেশি' },
  { key:'total_cholesterol', op:'gte',   t:240,           level:'high',     msg:'কোলেস্টেরল উচ্চ' },
  { key:'bmi',               op:'gte',   t:30,            level:'high',     msg:'গুরুতর স্থূলতা' },
  { key:'triglycerides',     op:'gte',   t:200,           level:'medium',   msg:'ট্রাইগ্লিসেরাইড বেশি' },
];

function evalClinicalRisks(m){
  const risks = [];
  for(const r of CLINICAL_RISK_RULES){
    const v = parseFloat(m[r.key]);
    if(isNaN(v) || v===0) continue;
    let hit=false;
    if(r.op==='gte') hit = v>=r.t;
    else if(r.op==='lt') hit = v<r.t;
    else if(r.op==='range') hit = v>=r.t && v<=r.t2;
    if(hit) risks.push({ msg:r.msg, level:r.level, value:v });
  }
  return risks;
}

// রোগ-বিভাগ (DM/OB/FL/IB/PR) baseline — sar_rule_engine.js DISEASE_PROFILES থেকে সংক্ষিপ্ত
const DISEASE_BASELINE = {
  DM: { name:'ডায়াবেটিস',
    general:'Low-GI খাবার, নিয়মিত ওষুধ ও রক্তে শর্করা পরীক্ষা চালিয়ে যান।',
    home:'নিয়মিত রক্তে শর্করা পরীক্ষা করুন, পায়ের যত্ন নিন।',
    ayurvedic:'করলা-মেথি চূর্ণ (১ চা চামচ সকালে খালি পেটে) সহায়ক হতে পারে।',
    unani:'জোশন্দা মেথি-করলা ইউনানি ব্যবস্থাপনায় প্রচলিত (হেকিমের পরামর্শে)।',
    homeo:'Syzygium Jambolanum বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।' },
  OB: { name:'স্থূলতা',
    general:'ক্যালরি নিয়ন্ত্রণ, উচ্চ প্রোটিন ও নিয়মিত হাঁটাচলা বজায় রাখুন।',
    home:'নিয়মিত ওজন মাপুন, প্রক্রিয়াজাত খাবার এড়িয়ে চলুন।',
    ayurvedic:'ত্রিফলা-গুগ্গুল চূর্ণ (রাতে ঘুমানোর আগে) বিপাক বাড়াতে সহায়ক।',
    unani:'মাজুন সন্দল বা ইতরিফল ইউনানি চিকিৎসায় প্রচলিত (হেকিমের পরামর্শে)।',
    homeo:'Fucus Vesiculosus বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।' },
  FL: { name:'ফ্যাটি লিভার',
    general:'তেল-চর্বি কম, অ্যান্টি-অক্সিডেন্ট সমৃদ্ধ খাবার খান।',
    home:'অ্যালকোহল ও ভাজাপোড়া এড়িয়ে চলুন, নিয়মিত হাঁটুন।',
    ayurvedic:'ভুমি আমলকী-হলুদ চূর্ণ (সকালে খালি পেটে) লিভার সুরক্ষায় সহায়ক।',
    unani:'জোশন্দা কাসনি (চিকোরি ক্বাথ) ইউনানি চিকিৎসায় প্রচলিত (হেকিমের পরামর্শে)।',
    homeo:'Chelidonium বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।' },
  IB: { name:'IBS/গ্যাস্ট্রিক',
    general:'Low-FODMAP নীতি মেনে চলুন, ছোট ছোট বেলায় খান।',
    home:'ট্রিগার খাবার চিহ্নিত করে এড়িয়ে চলুন, ধীরে-সুস্থে খান।',
    ayurvedic:'মৌরি-আজওয়াইন-হিং চূর্ণ (খাওয়ার পর) গ্যাস কমাতে সহায়ক।',
    unani:'জওয়ারিশ জালিনুস ইউনানি চিকিৎসায় প্রচলিত (হেকিমের পরামর্শে)।',
    homeo:'Lycopodium বা Nux Vomica বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।' },
  PR: { name:'গর্ভাবস্থা',
    general:'ফোলেট ও আয়রন সমৃদ্ধ খাবার, নিয়মিত চেকআপ চালিয়ে যান।',
    home:'নিয়মিত প্রসবপূর্ব চেকআপ করান, পর্যাপ্ত বিশ্রাম নিন।',
    ayurvedic:'শতাবরী-মরিঙ্গা চূর্ণ (সকালে) — শুধুমাত্র ডাক্তারের অনুমতি নিয়ে।',
    unani:'গর্ভাবস্থায় ইউনানি ওষুধ শুধুমাত্র রেজিস্টার্ড হেকিম ও গাইনোকোলজিস্টের অনুমোদনক্রমে।',
    homeo:'গর্ভাবস্থায় হোমিওপ্যাথিক ওষুধ শুধুমাত্র রেজিস্টার্ড হোমিওপ্যাথ ও গাইনোকোলজিস্টের অনুমোদনক্রমে।' },
};

// উপসর্গ-কিওয়ার্ড ম্যাচিং — sar_rule_engine.js CONDITION_PROFILES-এর প্যাটার্ন +
// doctor-portal-only ত্বক/চর্মরোগ সংযোজন (মূল rule engine-এ নেই) + আয়ুর্বেদিক/ইউনানি/হোমিওপ্যাথিক
const COMPLAINT_RULES = [
  { key:'fever',          keywords:['জ্বর','fever','temperature'],
    general:'হালকা, সহজপাচ্য, তরলসমৃদ্ধ খাবার দিন। Paracetamol (weight-based) বিবেচনা করুন।',
    home:'বিশ্রাম নিন, হালকা সুতির কাপড় পরুন, কুসুম গরম পানিতে গা মুছে দিন।',
    ayurvedic:'তুলসি-আদা-হলুদ চূর্ণ (½ চা চামচ উষ্ণ পানিতে দিনে ৩ বার)।',
    unani:'শরবত বজুরী মু\'তাদিল ইউনানি জ্বরনাশক শরবত (হেকিমের পরামর্শে)।',
    homeo:'Belladonna বা Ferrum Phos বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।',
    dangers:'জ্বর ১০৩°F+, ৩ দিনের বেশি স্থায়ী, বা খিঁচুনি/অচেতনতা হলে জরুরি বিভাগে যান।' },
  { key:'cold_cough',     keywords:['সর্দি','কাশি','cold','cough'],
    general:'ভিটামিন-সি ও জিঙ্ক সমৃদ্ধ খাবার, গরম পানীয় বাড়ান।',
    home:'গরম পানির ভাপ নিন, লবণ পানিতে গার্গল করুন।',
    ayurvedic:'সিতোপালাদি-তালিসাদি চূর্ণ (উষ্ণ পানিতে দিনে ২ বার)।',
    unani:'জোশন্দা (তুলসি-আদা-মধু ক্বাথ) ইউনানি চিকিৎসায় প্রচলিত।',
    homeo:'Aconite বা Bryonia বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।',
    dangers:'শ্বাসকষ্ট, বুকে ব্যথা, বা ১ সপ্তাহের বেশি স্থায়ী কাশিতে ডাক্তার দেখান।' },
  { key:'headache',       keywords:['মাথাব্যথা','headache'],
    general:'পর্যাপ্ত পানি পান করুন, বিশ্রাম নিন, স্ক্রিন-টাইম কমান।',
    home:'অন্ধকার-শান্ত ঘরে বিশ্রাম নিন, কপালে ঠান্ডা সেঁক দিন।',
    ayurvedic:'ভৃঙ্গরাজ-ব্রাহ্মী চূর্ণ (½ চা চামচ দিনে ২ বার)।',
    unani:'রওগানে বাবুনা (ক্যামোমাইল তেল) মাথায় মালিশ ইউনানি চিকিৎসায় প্রচলিত।',
    homeo:'Belladonna বা Nux Vomica বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।',
    dangers:'হঠাৎ তীব্র মাথাব্যথা, দৃষ্টি সমস্যা, বা বমি সহ হলে জরুরি বিভাগে যান।' },
  { key:'migraine',       keywords:['মাইগ্রেন','migraine'],
    general:'ট্রিগার খাবার (পুরনো পনির, অতিরিক্ত ক্যাফেইন) এড়িয়ে চলুন।',
    home:'উজ্জ্বল আলো ও শব্দ এড়িয়ে অন্ধকার ঘরে বিশ্রাম নিন।',
    ayurvedic:'ভৃঙ্গরাজ-শঙ্খপুষ্পি চূর্ণ (ঘুমানোর আগে)।',
    unani:'রওগানে বনাফশা মাথায় হালকা মালিশ ইউনানি চিকিৎসায় প্রচলিত।',
    homeo:'Iris Versicolor বা Natrum Mur বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।',
    dangers:'নতুন ধরনের বা অস্বাভাবিক তীব্র মাইগ্রেনে ডাক্তার দেখান।' },
  { key:'acidity',        keywords:['গ্যাস','এসিডিটি','acidity','gastric'],
    general:'ছোট ছোট বেলায় খান, মশলাদার/সাইট্রাস কমান।',
    home:'খাওয়ার পর সাথে সাথে শোবেন না, ছোট ছোট বেলায় খান।',
    ayurvedic:'শতাব্দী-মুলেঠি-আমলকী চূর্ণ (খাওয়ার আগে পানিতে)।',
    unani:'জওয়ারিশ জালিনুস বা আরক পুদিনা ইউনানি এসিডিটি চিকিৎসায় প্রচলিত।',
    homeo:'Nux Vomica বা Carbo Veg বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।',
    dangers:'রক্ত বমি, কালো পায়খানা, বা তীব্র পেটে ব্যথায় জরুরি বিভাগে যান।' },
  { key:'constipation',   keywords:['কোষ্ঠকাঠিন্য','constipation'],
    general:'ফাইবার ও পানি বাড়ান, উষ্ণ পানীয় পান করুন।',
    home:'সকালে উষ্ণ পানি পান করুন, নিয়মিত হাঁটাচলা করুন।',
    ayurvedic:'ত্রিফলা-ইসবগুল চূর্ণ (রাতে ঘুমানোর আগে)।',
    unani:'ইতরিফল বা রওগানে জাইতুন (অলিভ অয়েল) ইউনানি চিকিৎসায় প্রচলিত।',
    homeo:'Nux Vomica বা Bryonia বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।',
    dangers:'তীব্র পেট ব্যথাসহ কোষ্ঠকাঠিন্য বা মলে রক্ত থাকলে ডাক্তার দেখান।' },
  { key:'diarrhea',       keywords:['ডায়রিয়া','পাতলা পায়খানা','diarrhea','loose motion'],
    general:'ORS/নারকেল পানি দিয়ে পানিশূন্যতা রোধ করুন, হালকা খাবার (BRAT) দিন।',
    home:'ORS/ডাবের পানি ঘন ঘন পান করুন, নরম-সহজপাচ্য খাবার দিন।',
    ayurvedic:'বেলের শাঁস-ইসবগুল চূর্ণ (ঠান্ডা পানিতে দিনে ৩ বার)।',
    unani:'হাব্বে মুসাক্কিন ইউনানি চিকিৎসায় প্রচলিত (পানিশূন্যতা এড়াতে সতর্কতাসহ)।',
    homeo:'Arsenicum Album বা Podophyllum বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।',
    dangers:'রক্তমিশ্রিত পায়খানা, তীব্র পানিশূন্যতা, বা ২ দিনের বেশি স্থায়ী হলে দ্রুত ডাক্তার দেখান।' },
  { key:'stress',         keywords:['মানসিক চাপ','স্ট্রেস','stress','anxiety'],
    general:'পরিশোধিত কার্ব ও ক্যাফেইন কমান, ঘুম ও বিশ্রাম নিশ্চিত করুন।',
    home:'গভীর শ্বাস-প্রশ্বাস ব্যায়াম করুন, প্রিয়জনের সাথে কথা বলুন।',
    ayurvedic:'অশ্বগন্ধা-ব্রাহ্মী চূর্ণ (রাতে উষ্ণ পানিতে)।',
    unani:'খামিরা মারওয়ারিদ ইউনানি টনিক প্রচলিত (হেকিমের পরামর্শে)।',
    homeo:'Ignatia বা Aconite বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।',
    dangers:'তীব্র উদ্বেগ বা আত্মহত্যার চিন্তা থাকলে অবিলম্বে মানসিক স্বাস্থ্য সহায়তা নিন।' },
  { key:'sleep',          keywords:['ঘুম','sleep','insomnia'],
    general:'ক্যাফেইন ও ভারী রাতের খাবার এড়িয়ে চলুন, নিয়মিত ঘুমের সময় রাখুন।',
    home:'শোবার আগে স্ক্রিন এড়িয়ে চলুন, নিয়মিত সময়ে ঘুমাতে যান।',
    ayurvedic:'ব্রাহ্মী-জটামাংসী চূর্ণ (ঘুমানোর ৩০ মিনিট আগে)।',
    unani:'খামিরা গাওজাবান ইউনানি ঘুম-সহায়ক প্রচলিত (হেকিমের পরামর্শে)।',
    homeo:'Coffea Cruda বা Nux Vomica বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।',
    dangers:'দীর্ঘস্থায়ী অনিদ্রা দৈনন্দিন কাজে প্রভাব ফেললে বিশেষজ্ঞ দেখান।' },
  { key:'menstrual',      keywords:['মাসিক','period','cramp','cramping'],
    general:'আয়রন ও ম্যাগনেসিয়াম সমৃদ্ধ খাবার বাড়ান, বিশ্রাম নিন।',
    home:'পেটে উষ্ণ সেঁক দিন, পর্যাপ্ত বিশ্রাম নিন।',
    ayurvedic:'অশোক-শতাবরী চূর্ণ (সকাল-রাত উষ্ণ পানিতে)।',
    unani:'জোশন্দা সোঁঠ-মেথি ইউনানি চিকিৎসায় প্রচলিত (হেকিমের পরামর্শে)।',
    homeo:'Mag Phos বা Pulsatilla বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।',
    dangers:'অতিরিক্ত রক্তক্ষরণ বা তীব্র ব্যথায় ডাক্তার দেখান।' },
  { key:'fatigue',        keywords:['ক্লান্তি','দুর্বলতা','fatigue','weakness'],
    general:'আয়রন, B12 ও কমপ্লেক্স কার্ব সমৃদ্ধ খাবার বাড়ান।',
    home:'পর্যাপ্ত ঘুম ও হালকা ব্যায়াম করুন, পানিশূন্যতা এড়ান।',
    ayurvedic:'অশ্বগন্ধা-শিলাজিত চূর্ণ (সকালে উষ্ণ পানিতে)।',
    unani:'খামিরা আবরেশম বা মাজুন মুকাব্বি ইউনানি টনিক প্রচলিত।',
    homeo:'China বা Kali Phos বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।',
    dangers:'তীব্র/দীর্ঘস্থায়ী ক্লান্তি অন্য রোগের লক্ষণ হতে পারে — রক্ত পরীক্ষা করান।' },
  // ── ত্বক/চর্মরোগ — মূল rule engine-এ নেই, doctor-portal-only সংযোজন ──
  { key:'skin_fungal',    keywords:['tinea','ringworm','fungal','ছত্রাক','দাদ','corporis'],
    general:'টপিকাল অ্যান্টিফাংগাল ক্রিম (ক্লোট্রিমাজল/টারবিনাফিন গোত্র) বিবেচনা করুন। স্থান শুষ্ক ও পরিষ্কার রাখুন, ঢিলা সুতির কাপড় পরুন।',
    home:'স্থান শুকনো রাখুন, প্রতিদিন কাপড় পরিবর্তন করুন, শেয়ার করা তোয়ালে এড়িয়ে চলুন।',
    ayurvedic:'নিম পাতা বাটা বা নারকেল তেল+কর্পূর প্রলেপ প্রদাহ কমাতে সহায়ক হতে পারে।',
    unani:'রওগানে চালমুগরা ইউনানি ছত্রাক চিকিৎসায় প্রচলিত (হেকিমের তত্ত্বাবধানে)।',
    homeo:'Sepia বা Graphites বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।',
    dangers:'ছড়িয়ে পড়লে, পুঁজ/লালচে ফোলাভাব বা জ্বর সহ হলে দ্রুত ডাক্তার দেখান।' },
  { key:'skin_itch',      keywords:['itching','itch','চুলকানি','চুলকায়'],
    general:'অ্যালার্জি, শুষ্ক ত্বক বা ছত্রাক কারণ হতে পারে — অ্যান্টিহিস্টামিন ও ময়েশ্চারাইজার বিবেচনা করুন।',
    home:'ঠান্ডা পানিতে গোসল করুন, কড়া সাবান এড়িয়ে চলুন।',
    ayurvedic:'অ্যালোভেরা জেল বা নারকেল তেল প্রলেপ প্রশান্তিদায়ক হতে পারে।',
    unani:'রওগানে বনাফশা বা নিম-ভিত্তিক ইউনানি লেপ প্রচলিত।',
    homeo:'Sulphur বা Rhus Tox বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের পরামর্শে)।',
    dangers:'সারা শরীরে ছড়িয়ে পড়া চুলকানি বা শ্বাসকষ্ট সহ হলে জরুরি বিভাগে যান।' },
  { key:'skin_psoriasis', keywords:['psoriasis','সোরিয়াসিস'],
    general:'দীর্ঘস্থায়ী অটোইমিউন ত্বক সমস্যা — চর্মরোগ বিশেষজ্ঞের নিয়মিত ফলোআপ প্রয়োজন। টপিকাল স্টেরয়েড/ভিটামিন-ডি অ্যানালগ ডাক্তার নির্ধারণ করবেন।',
    home:'ত্বক নিয়মিত ময়েশ্চারাইজ করুন, রোদে অল্প সময় থাকুন (ডাক্তারের পরামর্শে)।',
    ayurvedic:'নিম-হলুদ পেস্ট প্রলেপ (চিকিৎসকের অনুমতিক্রমে) বিবেচনা করা যেতে পারে।',
    unani:'মালহাম রুতুবত (ময়েশ্চারাইজিং ইউনানি মলম) হেকিমের সরাসরি তত্ত্বাবধানে বিবেচনা করা যেতে পারে।',
    homeo:'Arsenicum Album বা Graphites বিবেচনা করা যেতে পারে (হোমিওপ্যাথ চিকিৎসকের দীর্ঘমেয়াদী তত্ত্বাবধানে)।',
    dangers:'জয়েন্টে ব্যথা/ফোলা দেখা দিলে (সোরিয়াটিক আর্থ্রাইটিস ঝুঁকি) দ্রুত বিশেষজ্ঞের কাছে যান।' },
];

function matchComplaintRules(complaintText){
  const lc = (complaintText||'').toLowerCase();
  return COMPLAINT_RULES.filter(r => r.keywords.some(kw => lc.includes(kw.toLowerCase())));
}

// ── কুরআন/হাদিস থেকে প্রমাণিত (authentic, cited) দু'আ — বানানো/অনুমাননির্ভর নয় ──
// তারিখ-ভিত্তিক deterministic ঘূর্ণন (random নয়) — প্রতিদিন consistent একই দু'আ দেখায়
const ISLAMIC_DUA_POOL = [
  { ar:'اللَّهُمَّ رَبَّ النَّاسِ أَذْهِبِ الْبَاسَ، اشْفِ أَنْتَ الشَّافِي، لاَ شِفَاءَ إِلاَّ شِفَاؤُكَ، شِفَاءً لاَ يُغَادِرُ سَقَمًا',
    bn:'হে আল্লাহ, মানুষের প্রতিপালক! কষ্ট দূর করে দাও, আরোগ্য দান করো — তুমিই প্রকৃত আরোগ্যদাতা। তোমার আরোগ্যদান ছাড়া কোনো আরোগ্য নেই, এমন আরোগ্য দাও যা কোনো রোগ অবশিষ্ট না রাখে।',
    ref:'সহীহ বুখারী ৫৭৫০, সহীহ মুসলিম ২১৯১' },
  { ar:'وَإِذَا مَرِضْتُ فَهُوَ يَشْفِينِ',
    bn:'আর যখন আমি অসুস্থ হই, তখন তিনিই (আল্লাহ) আমাকে আরোগ্য দান করেন।',
    ref:'সূরা আশ-শু\'আরা, ২৬:৮০' },
  { ar:'وَنُنَزِّلُ مِنَ الْقُرْآنِ مَا هُوَ شِفَاءٌ وَرَحْمَةٌ لِّلْمُؤْمِنِينَ',
    bn:'আর আমি কুরআন থেকে তা-ই অবতীর্ণ করি যা মুমিনদের জন্য নিরাময় ও রহমতস্বরূপ।',
    ref:'সূরা বনী ইসরাঈল, ১৭:৮২' },
];

function pickDua(){
  const d = ISLAMIC_DUA_POOL[new Date().getDate() % ISLAMIC_DUA_POOL.length];
  return `${d.ar}\n"${d.bn}"\n(সূত্র: ${d.ref})\n\nসবর করুন, দু'আ করুন। পরিবারের সহায়তা নিন।`;
}

// ── রুল-ইঞ্জিন থেকে সম্পূর্ণ প্রেসক্রিপশন-ড্রাফট বানায় (৯০% — নির্ধারক, তাৎক্ষণিক, sync, কোনো fetch নেই) ──
function computeRuleEngineResult(patientObj, complaint, metrics){
  const cat = patientObj.category || 'DM';
  const baseline = DISEASE_BASELINE[cat] || DISEASE_BASELINE.DM;
  const risks = evalClinicalRisks(metrics || {});
  const matched = matchComplaintRules(complaint);

  const riskMsgs = risks.map(r=>r.msg);
  let assessmentParts = [];
  if(matched.length) assessmentParts.push(`অভিযোগ অনুযায়ী প্রাসঙ্গিক বিষয়: ${matched.map(m=>m.keywords[0]).join(', ')}।`);
  if(riskMsgs.length) assessmentParts.push(`মেট্রিক্স থেকে সতর্কতা: ${riskMsgs.join('; ')}।`);
  if(!assessmentParts.length) assessmentParts.push(`রোগীর ${baseline.name} বিভাগ ও আজকের অভিযোগ ("${complaint}") বিবেচনা করে সাধারণ ব্যবস্থাপত্র প্রস্তুত করা হয়েছে।`);
  assessmentParts.push('ডাক্তার যাচাই করে চূড়ান্ত করবেন।');

  const rx = matched.length
    ? matched.map(m => ({ cat: baseline.name, generic: '(উপসর্গ-ভিত্তিক — ডাক্তার নির্দিষ্ট করবেন)', note: m.general }))
    : [{ cat: baseline.name, generic: 'Paracetamol (প্রয়োজনে)', note: 'Weight-based dosing — ডাক্তার নিশ্চিত করুন' }];

  const general     = [ ...matched.map(m=>m.general),     baseline.general   ].filter(Boolean).join(' ');
  const home        = [ ...matched.map(m=>m.home),        baseline.home      ].filter(Boolean).join(' ');
  const ayurvedic   = [ ...matched.map(m=>m.ayurvedic),   baseline.ayurvedic ].filter(Boolean).join(' ');
  const unani       = [ ...matched.map(m=>m.unani),       baseline.unani     ].filter(Boolean).join(' ');
  const homeopathic = [ ...matched.map(m=>m.homeo),       baseline.homeo     ].filter(Boolean).join(' ');
  const dangers = matched.length
    ? matched.map(m=>m.dangers).join(' ')
    : 'জ্বর ৩ দিনের বেশি, অচেতনতা, শ্বাসকষ্ট, বা তীব্র ব্যথায় দ্রুত ডাক্তার দেখান।';

  return {
    assessment: assessmentParts.join(' '),
    rx, general, home, ayurvedic, unani, homeopathic,
    islamic: pickDua(),
    dangers,
    alerts: 'শ্বাসকষ্ট, তীব্র ব্যথা, অচেতনতা বা কোনো জরুরি লক্ষণে দ্রুত হাসপাতালে যান।',
    _ruleEngine: { risks, matched: matched.map(m=>m.key) },
  };
}


async function runAIAnalysis(){
  const complaint = document.getElementById('complaint').value.trim();
  if(!complaint){ showToast('⚠️ আজকের অভিযোগ লিখুন'); return; }

  if(!checkAnalysisLimit()){ return; }

  const btn = document.getElementById('analyzeBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-inline"></span> বিশ্লেষণ চলছে...';

  const dbgToggle = document.getElementById('aiDebugToggle');
  const dbgBox = document.getElementById('aiDebugBox');
  if(dbgToggle) dbgToggle.style.display = 'none';
  if(dbgBox){ dbgBox.style.display = 'none'; dbgBox.textContent = ''; }

  const m = patient.metrics || {};
  const catNames = {DM:'ডায়াবেটিস',OB:'স্থূলতা/Weight Management',FL:'ফ্যাটি লিভার',IB:'IBS/গ্যাস্ট্রিক',PR:'গর্ভাবস্থা'};
  const cat = catNames[patient.category||'DM'] || patient.category;

  // ═══ ধাপ ১ — RULE ENGINE (৯০%): sync, কোনো fetch/API নেই, তাৎক্ষণিক ═══
  const ruleResult = computeRuleEngineResult(patient, complaint, m);
  currentRxData = ruleResult;
  renderAIResult(ruleResult);   // ডাক্তার সাথে সাথে সম্পূর্ণ ড্রাফট দেখেন — নেটওয়ার্কের অপেক্ষা নেই
  document.getElementById('aiAssessText').innerHTML =
    '<span class="spinner-inline"></span> ' + escH(ruleResult.assessment) +
    ' <span style="font-size:.68rem;color:#9A7A8A">(AI ভাষা পালিশ হচ্ছে...)</span>';

  btn.disabled = false;
  btn.innerHTML = '🔄 পুনরায় বিশ্লেষণ করুন';

  // ═══ ধাপ ২ — AI POLISH (১০%): ছোট, দ্রুত কল — শুধু assessment+islamic-এর ভাষা
  //     সংশ্লেষণ করে; নতুন কোনো ঔষধ/ক্লিনিক্যাল সিদ্ধান্ত নেয় না। ব্যর্থ হলেও
  //     রুল-ইঞ্জিনের ফলাফল অক্ষত থাকে — ডাক্তার কখনো খালি হাতে থাকেন না। ═══
  const diag = { time: new Date().toISOString(), complaint, ruleEngine: ruleResult._ruleEngine };
  let polished = null;

  try{
    // পটভূমিতে (non-blocking) আজকের ai_analysis + আগের প্রেসক্রিপশন — শুধু polish-এর প্রেক্ষাপট সমৃদ্ধ করতে
    let todayNote = '';
    try{
      const todayDate = new Date().toISOString().slice(0,10);
      const tr = await fetch(`${SUPA_URL}/rest/v1/ai_analysis?customer_id=eq.${patient.id}&analysis_date=eq.${todayDate}&order=created_at.desc&limit=1&select=health_summary_bn,focus`, {headers:H});
      const todayRows = tr.ok ? await tr.json() : [];
      const t = Array.isArray(todayRows) && todayRows[0];
      if(t && t.health_summary_bn) todayNote = t.health_summary_bn.slice(0,150);
    }catch(e){}

    const riskSummary = ruleResult._ruleEngine.risks.map(r=>r.msg).join('; ') || 'কোনো বড় ঝুঁকি ফ্ল্যাগ নেই';
    const matchedNames = ruleResult._ruleEngine.matched.join(', ') || 'নির্দিষ্ট কিছু না';
    const polishPrompt = `তুমি SAR ক্লিনিক্যাল সহকারী। একজন ডাক্তারের জন্য নিচের তথ্য থেকে মাত্র ২টি ছোট বাংলা টেক্সট তৈরি করো — কোনো নতুন ঔষধ/পরামর্শ নয়, শুধু ভাষাগত সংশ্লেষণ:

রোগী বিভাগ: ${cat} · আজকের অভিযোগ: ${complaint}
রুল-ইঞ্জিন থেকে সনাক্ত বিষয়: ${matchedNames}
ঝুঁকি ফ্ল্যাগ: ${riskSummary}
${todayNote ? `আজকের স্বয়ংক্রিয় AI সারাংশ: ${todayNote}` : ''}

শুধু এই JSON দাও, কোনো markdown/ব্যাখ্যা ছাড়া:
{"assessment":"২-৩ বাক্যের ক্লিনিক্যাল সারাংশ (বাংলায়)","islamic":"১ বাক্য ইসলামিক/আধ্যাত্মিক সান্ত্বনা (বাংলায়)"}`;

    const r = await fetch('/.netlify/functions/analyze', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ prompt: polishPrompt })
    });
    if(r.ok){
      const d = await r.json();
      diag.netlify = { httpStatus:r.status, hasParsed:!!d.parsed, hasText:!!d.text };
      if(d.parsed && d.parsed.assessment) polished = d.parsed;
      else if(d.assessment) polished = d;
      else if(d.text) polished = robustParseAI(d.text);
    } else {
      const t = await r.text().catch(()=>'');
      diag.netlify = { httpStatus:r.status, errorBody:t.slice(0,300) };
    }
  }catch(e){ diag.netlify = { fetchError:e.message }; }

  if(polished && polished.assessment){
    currentRxData.assessment = polished.assessment;
    document.getElementById('aiAssessText').textContent = polished.assessment;
    if(polished.islamic){
      currentRxData.islamic = polished.islamic;
      const islamicEl = document.getElementById('rxIslamic');
      if(islamicEl) islamicEl.value = polished.islamic;
    }
  } else {
    // AI polish ব্যর্থ/ধীর — রুল-ইঞ্জিনের টেক্সটই থেকে যায়, শুধু spinner সরাই
    document.getElementById('aiAssessText').textContent = ruleResult.assessment;
    console.warn('SAR doctor.html — AI polish ব্যর্থ (rule-engine ফলাফল অক্ষত আছে):', diag);
    if(dbgBox){ dbgBox.textContent = JSON.stringify(diag, null, 2); }
    if(dbgToggle){ dbgToggle.style.display = 'block'; }
  }

  // AI polish সফল/ব্যর্থ যাই হোক — চূড়ান্ত ড্রাফট (rule-engine + সম্ভাব্য polish) একবারই consultation-এ পাঠাই
  sendForApproval();
}

function renderAIResult(data){
  document.getElementById('aiAssessText').textContent = data.assessment || '—';

  // Render prescription rows
  const rxCard  = document.getElementById('rxCard');
  const signCard= document.getElementById('signCard');
  rxCard.style.display   = 'block';
  signCard.style.display = 'block';

  const rx = data.rx || [];
  document.getElementById('rxRows').innerHTML = rx.map((r,i) => rxRowHTML(r.cat||'', r.generic||'', r.note||'', i)).join('');
  document.getElementById('rxGeneral').value     = data.general     || '';
  document.getElementById('rxHome').value        = data.home        || '';
  document.getElementById('rxAyurvedic').value   = data.ayurvedic   || '';
  document.getElementById('rxUnani').value       = data.unani       || '';
  document.getElementById('rxHomeopathic').value = data.homeopathic || '';
  document.getElementById('rxIslamic').value     = data.islamic     || '';
  document.getElementById('rxDangers').value     = data.dangers     || '';
  document.getElementById('rxAlerts').value      = data.alerts      || '';

  rxCard.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function rxRowHTML(cat, drug, note, idx){
  return `<div class="rx-grid" id="rxrow-${idx}">
    <input class="rx-input" value="${escH(cat)}"  placeholder="বিভাগ">
    <input class="rx-input" value="${escH(drug)}" placeholder="Generic নাম">
    <div style="display:flex;gap:4px">
      <input class="rx-input" value="${escH(note)}" placeholder="মাত্রা / নির্দেশনা" style="flex:1">
      <button class="del-rx-btn" onclick="this.closest('.rx-grid').remove()">✕</button>
    </div>
  </div>`;
}

function addRxRow(){
  const c = document.getElementById('rxRows');
  const idx = Date.now();
  const div = document.createElement('div');
  div.innerHTML = rxRowHTML('','','',idx);
  c.appendChild(div.firstElementChild);
}

function escH(s){ return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

// ── SIGN ──
async function signPrescription(){
  const name = document.getElementById('docName').value.trim();
  const reg  = document.getElementById('docReg').value.trim();
  if(!name||!reg){
    showSignMsg('ডাক্তারের নাম ও BMDC রেজিস্ট্রেশন নম্বর দিন।', false); return;
  }

  // Collect edited rx
  const rows = document.querySelectorAll('#rxRows .rx-grid');
  const editedRx = [...rows].map(row => {
    const inputs = row.querySelectorAll('.rx-input');
    return { cat:inputs[0]?.value, generic:inputs[1]?.value, note:inputs[2]?.value };
  }).filter(r=>r.generic);

  const prescription = {
    customer_id:  patient.id,
    doctor_name:  name,
    doctor_bmdc:  reg,
    doctor_note:  document.getElementById('docNote').value,
    ai_assessment:document.getElementById('aiAssessText').textContent,
    edited_rx:    editedRx,
    general:      document.getElementById('rxGeneral').value,
    home:         document.getElementById('rxHome').value,
    ayurvedic:    document.getElementById('rxAyurvedic').value,
    unani:        document.getElementById('rxUnani').value,
    homeopathic:  document.getElementById('rxHomeopathic').value,
    islamic:      document.getElementById('rxIslamic').value,
    dangers:      document.getElementById('rxDangers').value,
    alerts:       document.getElementById('rxAlerts').value,
    complaint:    document.getElementById('complaint').value,
    status:       'signed',
    signed_at:    new Date().toISOString(),
  };

  // Save to Supabase prescriptions (if table exists) or sar_notes
  try {
    await fetch(`${SUPA_URL}/rest/v1/sar_notes`,{
      method:'POST', headers:{...H,'Prefer':'return=minimal'},
      body:JSON.stringify({
        customer_id: patient.id,
        note_type: 'prescription',
        urgency_level: 'medium',
        note_text_bn: `[Dr. ${name} / BMDC: ${reg}]\n\nঅভিযোগ: ${prescription.complaint}\n\nAI মূল্যায়ন: ${prescription.ai_assessment}\n\nঔষধ: ${editedRx.map(r=>r.generic+' — '+r.note).join('; ')}\n\nসাধারণ: ${prescription.general}\n\nআয়ুর্বেদিক: ${prescription.ayurvedic}\n\nইউনানি: ${prescription.unani}\n\nহোমিওপ্যাথিক: ${prescription.homeopathic}\n\nইসলামিক/আধ্যাত্মিক: ${prescription.islamic}`,
        is_resolved: false,
      })
    });
  } catch(e){ console.warn('Supabase note save:', e); }

  showSignMsg(`✅ প্রেসক্রিপশন সাইন করা হয়েছে — Dr. ${name} (BMDC: ${reg})। গ্রাহককে WhatsApp ও Email-এ পাঠানো হচ্ছে...`, true);
  showToast('✅ প্রেসক্রিপশন সাইন ও রিলিজ সম্পন্ন');

  // Notify via Edge Function
  if(patient.id){
    const custPhone = patient.phone || JSON.parse(localStorage.getItem('sar_customer')||'{}').phone;
    if(custPhone){
      const waMsg = `🩺 *SAR ডাক্তার প্রেসক্রিপশন*\n\nপ্রিয় ${patient.name||'আপা'},\n\nআপনার প্রেসক্রিপশন প্রস্তুত!\n\n👨‍⚕️ Dr. ${name}\nBMDC: ${reg}\n\n💊 ওষুধ:\n${editedRx.map(r=>`• ${r.generic}: ${r.note}`).join('\n')}\n\n📋 পরামর্শ: ${prescription.general}\n\n⚠️ বিপদ লক্ষণ: ${prescription.dangers}\n\nSAR — She AI Restaurant\n📞 01346098892`;
      fetch(`${SUPA_URL}/functions/v1/send-whatsapp`,{method:'POST',headers:H,
        body:JSON.stringify({to_phone:custPhone, custom_message:waMsg, customer_id:patient.id})
      }).catch(()=>{});
    }
  }
}

function rejectPrescription(){
  showSignMsg('📋 প্রত্যাখ্যান করা হয়েছে। গ্রাহককে সশরীরে ক্লিনিক দেখাতে পরামর্শ দেওয়া হয়েছে।', false);
  showToast('প্রেসক্রিপশন প্রত্যাখ্যাত — সশরীরে পরামর্শ প্রয়োজন');
}

function showSignMsg(txt, ok){
  const el = document.getElementById('signMsg');
  el.textContent = txt;
  el.className   = 'sign-msg ' + (ok?'ok':'err');
  el.style.display = 'block';
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 4000);
}

window.addEventListener('load', init);
