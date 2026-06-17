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
    bn: { name: 'Angeli', hi: 'আসসালামু আলাইকুম! আমি Angeli 🌸 SAR সম্পর্কে যা জানতে চান জিজ্ঞেস করুন।',
          ph: 'লিখুন অথবা মাইক চাপুন...', voice: 'bn-BD', online: 'অনলাইন',
          micDenied: 'মাইকের অনুমতি দেওয়া হয়নি। ব্রাউজারের ঠিকানা-বারে 🔒 চিহ্নে ক্লিক করে মাইক চালু করুন, অথবা লিখে জিজ্ঞেস করুন।',
          micErr: 'মাইকে সমস্যা হলো। আবার চেষ্টা করুন বা লিখুন।', listening: '🎙️ শুনছি...' },
    en: { name: 'Angeli', hi: "Hello! I'm Angeli. Ask me anything about SAR.",
          ph: 'Type or tap the mic...', voice: 'en-US', online: 'Online',
          micDenied: 'Microphone permission was denied. Click the 🔒 icon in the address bar to allow it, or just type your question.',
          micErr: 'Mic had a problem. Please try again or type.', listening: '🎙️ Listening...' },
    hi: { name: 'Angeli', hi: 'नमस्ते! मैं Angeli हूँ। SAR के बारे में पूछिए।',
          ph: 'लिखें या माइक दबाएँ...', voice: 'hi-IN', online: 'ऑनलाइन',
          micDenied: 'माइक की अनुमति नहीं दी गई। पता-बार में 🔒 पर क्लिक करके माइक चालू करें, या लिखकर पूछें।',
          micErr: 'माइक में समस्या हुई। फिर कोशिश करें या लिखें।', listening: '🎙️ सुन रही हूँ...' },
    ar: { name: 'Angeli', hi: 'مرحبا! أنا Angeli. اسألني عن SAR.',
          ph: 'اكتب أو اضغط الميكروفون...', voice: 'ar-SA', online: 'متصل',
          micDenied: 'لم يتم منح إذن الميكروفون. انقر على 🔒 في شريط العنوان للسماح، أو اكتب سؤالك.',
          micErr: 'حدثت مشكلة في الميكروفون. حاول مرة أخرى أو اكتب.', listening: '🎙️ أستمع...' },
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
    z-index:99999;display:flex;align-items:center;justify-content:center;position:fixed}
  #ang-fab svg{width:42px;height:42px}
  #ang-fab:hover{transform:scale(1.05)}
  #ang-fab.speaking{animation:ang-talk 1.1s ease-in-out infinite}
  #ang-spk{position:absolute;top:-3px;right:-3px;width:20px;height:20px;border-radius:50%;
    background:#fff;border:1.5px solid #D4537E;display:none;align-items:center;
    justify-content:center;font-size:11px;color:#D4537E}
  #ang-fab.speaking #ang-spk{display:flex}
  @keyframes ang-talk{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
  #ang-head .av svg{width:30px;height:30px}
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
  // ছোট মেয়ের মুখ (Angeli) — আঁকা SVG, আলাদা ছবি ফাইল লাগে না
  var GIRL_SVG =
    '<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M10 18a12 12 0 0 1 24 0c0 1.6 1.1 2 1.1 3.8 0 1.7-1.6 2.6-2.2 2.6l-1 .2c-.7 4.6-4.6 8.2-9.9 8.2s-9.2-3.6-9.9-8.2l-1-.2c-.6 0-2.2-.9-2.2-2.6 0-1.8 1.1-2.2 1.1-3.8Z" fill="#F8D3B0"/>' +
    '<path d="M22 2.5c7 0 12 5 12 13 0 1-.1 2-.3 2.6-.6-2.4-1.3-4.2-1.9-4.9-3.3 1-10 1.3-13.8-.6-.7 1.8-2.6 3.4-4.9 4-1.3-9.2 1.8-14.1 8.9-14.1Z" fill="#7A4A28"/>' +
    '<path d="M8.5 18.5c-1.6.5-3.2 2.4-3.2 4.8 0 3 2.2 5.3 4.8 5.5" fill="none" stroke="#7A4A28" stroke-width="2.5" stroke-linecap="round"/>' +
    '<path d="M35.5 18.5c1.6.5 3.2 2.4 3.2 4.8 0 3-2.2 5.3-4.8 5.5" fill="none" stroke="#7A4A28" stroke-width="2.5" stroke-linecap="round"/>' +
    '<circle cx="16.8" cy="20.5" r="2.9" fill="#3A2A1A"/><circle cx="27.2" cy="20.5" r="2.9" fill="#3A2A1A"/>' +
    '<circle cx="17.9" cy="19.4" r="1" fill="#fff"/><circle cx="28.3" cy="19.4" r="1" fill="#fff"/>' +
    '<circle cx="13" cy="24.5" r="2.2" fill="#F2A0B4" opacity=".7"/><circle cx="31" cy="24.5" r="2.2" fill="#F2A0B4" opacity=".7"/>' +
    '<path d="M19 26.5q3 2.2 6 0" fill="none" stroke="#C0566B" stroke-width="1.8" stroke-linecap="round"/>' +
    '<circle cx="32.5" cy="9.5" r="2" fill="#FF6FA3"/><circle cx="35.5" cy="11" r="2" fill="#FF6FA3"/><circle cx="33" cy="12.8" r="2" fill="#FF6FA3"/><circle cx="30.2" cy="11.2" r="2" fill="#FF6FA3"/><circle cx="32.8" cy="10.8" r="1.4" fill="#FFE08A"/>' +
    '<path d="M13 33c2.6 4.2 5.4 6.2 9 6.2s6.4-2 9-6.2c2.6 1 5 3 5 8H8c0-5 2.4-7 5-8Z" fill="#5DCAA5"/></svg>';

  var fab = document.createElement('button');
  fab.id = 'ang-fab';
  fab.innerHTML = GIRL_SVG + '<span id="ang-spk">🔊</span>';
  fab.setAttribute('aria-label', 'Angeli চ্যাট');

  var win = document.createElement('div');
  win.id = 'ang-win';
  win.innerHTML =
    '<div id="ang-head">' +
      '<div class="av">' + GIRL_SVG + '</div>' +
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
    if (who === 'user') {
      d.textContent = text;            // কাস্টমারের লেখা — সাধারণ টেক্সট
    } else {
      d.innerHTML = formatAngeli(text); // Angeli-র উত্তর — বোল্ড ও নতুন লাইনসহ
    }
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
  }

  // Angeli-র উত্তর সুন্দর করে দেখানো: HTML নিরাপদ করা, **বোল্ড**, নতুন লাইন
  function formatAngeli(text) {
    var safe = String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); // ক্ষতিকর কোড আটকাও
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); // **বোল্ড** → <b>বোল্ড</b>
    safe = safe.replace(/\n/g, '<br>');                   // নতুন লাইন → <br>
    return safe;
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
      speechSynthesis.cancel();   // আগের কথা থামাও, যেন একসাথে দুটো না বাজে
      // পড়ার আগে ** আর নতুন-লাইন চিহ্ন সরাও, যাতে "তারা" না বলে
      var clean = String(text).replace(/\*\*/g, '').replace(/\n+/g, '. ');
      var u = new SpeechSynthesisUtterance(clean);
      u.lang = L[lang].voice;
      u.onstart = function () { fab.classList.add('speaking'); };   // কথা শুরু → আইকন নড়ে
      u.onend   = function () { fab.classList.remove('speaking'); }; // কথা শেষ → থামে
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
    r.onerror = function (e) {
      recognizing = false;
      win.querySelector('#ang-mic').classList.remove('rec');
      input.placeholder = L[lang].ph;
      var msg = (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed'))
        ? L[lang].micDenied : L[lang].micErr;
      addMsg(msg, 'angeli');
    };
    r.onend = function () {
      recognizing = false;
      win.querySelector('#ang-mic').classList.remove('rec');
      input.placeholder = L[lang].ph;
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
    input.placeholder = L[lang].listening;
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
