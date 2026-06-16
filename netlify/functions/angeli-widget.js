// angeli-widget.js
// ─────────────────────────────────────────────────────────────
// ANGELI — ভাসমান চ্যাট widget (সাইটের ডান-নিচ কোণায়)
//
// ব্যবহার: যেকোনো পেজে </body> ট্যাগের ঠিক আগে এই এক লাইন বসান:
//   <script src="/angeli-widget.js"></script>
//
// ব্যস — Angeli নিজে নিজে ডান-নিচ কোণায় চলে আসবে।
// ভয়েস (verbal) + লেখা (written), ৪ ভাষা: বাংলা, ইংরেজি, হিন্দি, আরবি।
// ─────────────────────────────────────────────────────────────

(function () {
  // আপনার Netlify function-এর ঠিকানা (একই সাইটে থাকলে এটাই ঠিক)
  var API = '/.netlify/functions/angeli';

  // ভাষা অনুযায়ী লেবেল ও voice কোড
  var L = {
    bn: { name: 'Angeli', hi: 'নমস্কার! আমি Angeli 🌸 SAR সম্পর্কে যা জানতে চান জিজ্ঞেস করুন।',
          ph: 'লিখুন অথবা মাইক চাপুন...', voice: 'bn-BD', online: 'অনলাইন' },
    en: { name: 'Angeli', hi: "Hello! I'm Angeli. Ask me anything about SAR.",
          ph: 'Type or tap the mic...', voice: 'en-US', online: 'Online' },
    hi: { name: 'Angeli', hi: 'नमस्ते! मैं Angeli हूँ। SAR के बारे में पूछिए।',
          ph: 'लिखें या माइक दबाएँ...', voice: 'hi-IN', online: 'ऑनलाइन' },
    ar: { name: 'Angeli', hi: 'مرحبا! أنا Angeli. اسألني عن SAR.',
          ph: 'اكتب أو اضغط الميكروفون...', voice: 'ar-SA', online: 'متصل' },
  };

  var lang = 'bn';
  var convId = null;
  var history = [];      // [{role, text}]
  var open = false;
  var recognizing = false;
  var recog = null;

  // ── স্টাইল ─────────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent = `
  #ang-fab{position:fixed;right:20px;bottom:20px;width:62px;height:62px;border-radius:50%;
    background:#D4537E;color:#fff;border:none;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);
    font-size:30px;z-index:99999;display:flex;align-items:center;justify-content:center}
  #ang-fab:hover{transform:scale(1.05)}
  #ang-win{position:fixed;right:20px;bottom:92px;width:340px;max-width:calc(100vw - 40px);
    height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:18px;
    box-shadow:0 8px 30px rgba(0,0,0,.28);z-index:99999;display:none;flex-direction:column;
    overflow:hidden;font-family:system-ui,'Noto Sans Bengali',sans-serif}
  #ang-win.show{display:flex}
  #ang-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#D4537E;color:#fff}
  #ang-head .av{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.25);
    display:flex;align-items:center;justify-content:center;font-size:20px}
  #ang-head .nm{font-weight:600;font-size:15px;line-height:1.1}
  #ang-head .st{font-size:11px;opacity:.9}
  #ang-head select{margin-left:auto;border:none;border-radius:6px;padding:3px 4px;font-size:12px}
  #ang-head .cl{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0 4px}
  #ang-body{flex:1;padding:14px;overflow-y:auto;background:#faf7f5;display:flex;flex-direction:column;gap:8px}
  .ang-msg{max-width:80%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap}
  .ang-u{align-self:flex-end;background:#D4537E;color:#fff;border-bottom-right-radius:4px}
  .ang-a{align-self:flex-start;background:#fff;border:.5px solid #e4dcd8;border-bottom-left-radius:4px}
  .ang-typing{align-self:flex-start;background:#fff;border:.5px solid #e4dcd8;border-radius:14px;
    padding:10px 14px;display:flex;gap:4px}
  .ang-typing i{width:6px;height:6px;border-radius:50%;background:#bbb;display:inline-block;
    animation:angb 1s infinite}
  .ang-typing i:nth-child(2){animation-delay:.2s}.ang-typing i:nth-child(3){animation-delay:.4s}
  @keyframes angb{0%,60%,100%{opacity:.3}30%{opacity:1}}
  #ang-foot{display:flex;align-items:center;gap:8px;padding:10px;border-top:.5px solid #eee;background:#fff}
  #ang-foot input{flex:1;border:.5px solid #ddd;border-radius:20px;padding:9px 14px;font-size:14px;outline:none}
  #ang-mic,#ang-send{width:40px;height:40px;border-radius:50%;border:none;cursor:pointer;flex-shrink:0;
    display:flex;align-items:center;justify-content:center;font-size:18px}
  #ang-mic{background:#f3e3ea;color:#D4537E}#ang-mic.rec{background:#D4537E;color:#fff}
  #ang-send{background:#D4537E;color:#fff}
  `;
  document.head.appendChild(css);

  // ── DOM তৈরি ───────────────────────────────────────────────
  var fab = document.createElement('button');
  fab.id = 'ang-fab'; fab.innerHTML = '🌸'; fab.setAttribute('aria-label', 'Angeli চ্যাট');

  var win = document.createElement('div');
  win.id = 'ang-win';
  win.innerHTML =
    '<div id="ang-head">' +
      '<div class="av">🌸</div>' +
      '<div><div class="nm">Angeli</div><div class="st" id="ang-st">● অনলাইন</div></div>' +
      '<select id="ang-lang">' +
        '<option value="bn">বাংলা</option><option value="en">EN</option>' +
        '<option value="hi">हिं</option><option value="ar">عربى</option></select>' +
      '<button class="cl" id="ang-close" aria-label="বন্ধ">×</button>' +
    '</div>' +
    '<div id="ang-body"></div>' +
    '<div id="ang-foot">' +
      '<button id="ang-mic" aria-label="ভয়েস">🎤</button>' +
      '<input id="ang-input" type="text" />' +
      '<button id="ang-send" aria-label="পাঠান">➤</button>' +
    '</div>';

  document.body.appendChild(fab);
  document.body.appendChild(win);

  var body  = win.querySelector('#ang-body');
  var input = win.querySelector('#ang-input');

  // ── সহায়ক ফাংশন ───────────────────────────────────────────
  function applyLang() {
    input.placeholder = L[lang].ph;
    win.querySelector('#ang-st').textContent = '● ' + L[lang].online;
    win.dir = (lang === 'ar') ? 'rtl' : 'ltr';
  }

  function addMsg(text, who) {
    var d = document.createElement('div');
    d.className = 'ang-msg ' + (who === 'user' ? 'ang-u' : 'ang-a');
    d.textContent = text;
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
  }

  function showTyping() {
    var t = document.createElement('div');
    t.className = 'ang-typing'; t.id = 'ang-typing';
    t.innerHTML = '<i></i><i></i><i></i>';
    body.appendChild(t); body.scrollTop = body.scrollHeight;
  }
  function hideTyping() {
    var t = document.getElementById('ang-typing'); if (t) t.remove();
  }

  // Angeli উত্তর শব্দে পড়ে শোনায় (verbal output)
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = L[lang].voice;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  // ── বার্তা পাঠানো ──────────────────────────────────────────
  function send(text, inputType) {
    text = (text || input.value).trim();
    if (!text) return;
    input.value = '';
    addMsg(text, 'user');
    history.push({ role: 'user', text: text });
    showTyping();

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'chat',
        message: text,
        lang: lang,
        input_type: inputType || 'written',
        conversation_id: convId,
        history: history.slice(-6),
      }),
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      hideTyping();
      var ans = d.answer || (lang === 'en' ? 'Sorry, no answer.' : 'দুঃখিত, উত্তর পাওয়া যায়নি।');
      if (d.conversation_id) convId = d.conversation_id;
      addMsg(ans, 'angeli');
      history.push({ role: 'angeli', text: ans });
      if (inputType === 'verbal') speak(ans);   // ভয়েসে জিজ্ঞেস করলে ভয়েসে উত্তর
    })
    .catch(function () {
      hideTyping();
      addMsg(lang === 'en' ? 'Connection error.' : 'সংযোগে সমস্যা হলো।', 'angeli');
    });
  }

  // ── ভয়েস ইনপুট (verbal) — ব্রাউজারের Web Speech API ───────
  function setupRecog() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    var r = new SR();
    r.continuous = false; r.interimResults = false;
    r.onresult = function (e) {
      var said = e.results[0][0].transcript;
      send(said, 'verbal');
    };
    r.onend = function () {
      recognizing = false;
      win.querySelector('#ang-mic').classList.remove('rec');
    };
    return r;
  }

  function toggleMic() {
    if (!recog) recog = setupRecog();
    if (!recog) {
      addMsg(lang === 'en' ? 'Voice not supported in this browser.'
                           : 'এই ব্রাউজারে ভয়েস কাজ করে না।', 'angeli');
      return;
    }
    if (recognizing) { recog.stop(); return; }
    recog.lang = L[lang].voice;
    recognizing = true;
    win.querySelector('#ang-mic').classList.add('rec');
    try { recog.start(); } catch (e) {}
  }

  // ── উইন্ডো খোলা/বন্ধ ───────────────────────────────────────
  function toggleWin() {
    open = !open;
    win.classList.toggle('show', open);
    if (open && body.children.length === 0) {
      addMsg(L[lang].hi, 'angeli');   // প্রথম স্বাগত বার্তা
    }
  }

  // ── ইভেন্ট ─────────────────────────────────────────────────
  fab.onclick = toggleWin;
  win.querySelector('#ang-close').onclick = toggleWin;
  win.querySelector('#ang-send').onclick = function () { send(); };
  win.querySelector('#ang-mic').onclick = toggleMic;
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
  win.querySelector('#ang-lang').onchange = function (e) {
    lang = e.target.value; applyLang();
  };

  applyLang();
})();
