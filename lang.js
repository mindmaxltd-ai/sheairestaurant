/* ============================================================
   SAR — Universal Language Toggle System
   Include on EVERY page: <script src="lang.js"></script>
   Works site-wide: localStorage remembers the choice across pages.
   ============================================================ */

(function () {
  const STORAGE_KEY = 'sar_lang'; // 'bn' | 'en'

  // ---- 1. Shared UI dictionary (buttons, nav, cart, toasts, common labels) ----
  // Add more keys as you convert more pages. Every page can also define
  // window.SAR_PAGE_DICT = {...} BEFORE loading lang.js for page-specific strings;
  // it gets merged with this shared one.
  const DICT = {
    // Nav / common
    home:            { bn: 'হোম',              en: 'Home' },
    menu:            { bn: 'মেনু',              en: 'Menu' },
    dashboard:       { bn: 'ড্যাশবোর্ড',        en: 'Dashboard' },
    cart:            { bn: 'কার্ট',              en: 'Cart' },
    checkout:        { bn: 'চেকআউট',            en: 'Checkout' },
    logout:          { bn: 'লগ আউট',            en: 'Log out' },
    back:            { bn: 'ফিরে যান',          en: 'Back' },
    save:            { bn: 'সংরক্ষণ করুন',      en: 'Save' },
    cancel:          { bn: 'বাতিল',             en: 'Cancel' },
    loading:         { bn: 'লোড হচ্ছে...',      en: 'Loading...' },

    // Cart / order
    cart_empty:      { bn: 'কার্ট খালি।',        en: 'Your cart is empty.' },
    add_to_cart:     { bn: 'কার্টে যোগ করুন',    en: 'Add to cart' },
    added_to_cart:   { bn: 'কার্টে যোগ হয়েছে',  en: 'Added to cart' },
    remove:          { bn: 'সরান',              en: 'Remove' },
    total:           { bn: 'মোট',               en: 'Total' },
    subscription_needed: { bn: 'সাবস্ক্রিপশন সক্রিয় করুন', en: 'Please activate your subscription' },

    // Meals
    breakfast:       { bn: 'সকাল',              en: 'Breakfast' },
    lunch:           { bn: 'দুপুর',              en: 'Lunch' },
    dinner:          { bn: 'রাত',               en: 'Dinner' },

    // Categories
    cat_DM:          { bn: 'ডায়াবেটিস',        en: 'Diabetes' },
    cat_OB:          { bn: 'স্থূলতা',           en: 'Obesity' },
    cat_FL:          { bn: 'ফ্যাটি লিভার',      en: 'Fatty Liver' },
    cat_IB:          { bn: 'IBS/গ্যাস্ট্রিক',   en: 'IBS/Gastric' },
    cat_PR:          { bn: 'গর্ভাবস্থা',        en: 'Pregnancy' },

    // AI box
    ai_analysis_done: { bn: '✓ AI বিশ্লেষণ সম্পন্ন!', en: '✓ AI analysis complete!' },
    ai_recommendations: { bn: 'AI সুপারিশ', en: 'AI Recommendations' },
  };

  // ---- 2. Merge page-specific dictionary if the page defined one ----
  function mergedDict() {
    const pageDict = window.SAR_PAGE_DICT || {};
    return Object.assign({}, DICT, pageDict);
  }

  // ---- 3. Get / set language ----
  function getLang() {
    return localStorage.getItem(STORAGE_KEY) || 'bn';
  }

  function setLang(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
    applyLang();
    document.documentElement.setAttribute('lang', lang);
    // notify page scripts (e.g. to re-render dynamic content like cart/menu)
    window.dispatchEvent(new CustomEvent('sar:langchange', { detail: { lang } }));
  }

  function toggleLang() {
    setLang(getLang() === 'bn' ? 'en' : 'bn');
  }

  // ---- 4. Translate function — use anywhere in JS: t('cart_empty') ----
  function t(key, fallback) {
    const d = mergedDict();
    const entry = d[key];
    if (!entry) return fallback || key;
    return entry[getLang()] || entry.bn || fallback || key;
  }
  window.t = t; // global helper

  // ---- 5. Apply to DOM elements marked with data-i18n="key" ----
  function applyLang() {
    const lang = getLang();
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.setAttribute('placeholder', t(key));
    });
    // update toggle button label itself, if present
    document.querySelectorAll('.lang-toggle-btn').forEach((btn) => {
      btn.textContent = lang === 'bn' ? 'English' : 'বাংলা';
    });
  }

  // ---- 6. Inject a default floating toggle button (optional) ----
  function injectToggleButton() {
    if (document.querySelector('.lang-toggle-btn')) return; // don't duplicate
    const btn = document.createElement('button');
    btn.className = 'lang-toggle-btn';
    btn.type = 'button';
    btn.style.cssText = `
      position:fixed; top:14px; right:14px; z-index:9999;
      padding:.4rem 1rem; border-radius:50px; border:1px solid rgba(255,255,255,.2);
      background:rgba(10,10,20,.75); color:#fff; font-size:.78rem; font-weight:700;
      cursor:pointer; backdrop-filter:blur(10px);
    `;
    btn.addEventListener('click', toggleLang);
    document.body.appendChild(btn);
  }

  // ---- 7. Init on load ----
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.setAttribute('lang', getLang());
    injectToggleButton();
    applyLang();
  });

  // Expose for manual use in page scripts
  window.SAR_LANG = { get: getLang, set: setLang, toggle: toggleLang, apply: applyLang, t };
})();
