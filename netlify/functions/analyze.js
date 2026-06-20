// ════════════════════════════════════════════════════════
// netlify/functions/analyze.js
// SAR She AI Restaurant — Claude AI Analysis Function
// Updated: daily_log + weather + comprehensive prompt
// ════════════════════════════════════════════════════════

exports.handler = async (event) => {

  const h = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:h, body:'' };
  if (event.httpMethod !== 'POST')
    return { statusCode:405, headers:h, body: JSON.stringify({ error:'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TWO MODES:
    // Mode 1 — body.prompt exists → use raw prompt (dashboard)
    // Mode 2 — body.customer/metrics/daily_log → build prompt (n8n)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let finalPrompt = '';

    if (body.prompt) {
      // ── Mode 1: Raw prompt ──────────────────────────
      finalPrompt = body.prompt;

    } else {
      // ── Mode 2: Build from structured data ─────────
      const customer  = body.customer  || {};
      const metrics   = body.metrics   || {};
      const daily_log = body.daily_log || null;

      const catMap = {
        DM:'ডায়াবেটিস', OB:'স্থূলতা / অতিরিক্ত ওজন',
        FL:'ফ্যাটি লিভার', IB:'IBS / গ্যাস্ট্রিক', PR:'গর্ভাবস্থা'
      };

      // Birthday check
      const dob    = customer.date_of_birth ? new Date(customer.date_of_birth) : null;
      const today  = new Date();
      const isBday = dob &&
        dob.getDate()  === today.getDate() &&
        dob.getMonth() === today.getMonth();
      const age = dob ? Math.floor((today - dob) / 31557600000) : null;

      // Metrics string
      const skipKeys = ['id','customer_id','created_at','updated_at'];
      const metricsStr = Object.entries(metrics)
        .filter(([k,v]) => v != null && v !== '' && !skipKeys.includes(k))
        .map(([k,v]) => `${k}: ${v}`)
        .join('\n') || 'মেট্রিক্স পাওয়া যায়নি';

      // Daily log string
      const log    = daily_log || {};
      const logStr = daily_log ? `
গত রাতের তথ্য:
- জ্বর: ${log.fever ? 'হ্যাঁ ('+log.fever_temp+'°F)' : 'না'}
- সর্দি/কাশি: ${log.cold_cough    ? 'হ্যাঁ' : 'না'}
- পেট খারাপ: ${log.stomach_upset  ? 'হ্যাঁ' : 'না'}
- পাতলা পায়খানা: ${log.loose_motion ? 'হ্যাঁ' : 'না'}
- মাথাব্যথা: ${log.headache       ? 'হ্যাঁ' : 'না'}
- শরীর ব্যথা: ${log.body_pain     ? 'হ্যাঁ' : 'না'}
- মাসিক: ${log.period_today        ? 'হ্যাঁ' : 'না'}
- Cramping: ${log.cramping ? 'হ্যাঁ ('+log.cramping_level+'/10)' : 'না'}
- মানসিক অবস্থা: ${log.mental_condition || 'জানানো হয়নি'}
- Mood: ${log.mood || 'জানানো হয়নি'}
- চাপের মাত্রা: ${log.stress_level || 5}/10
- কফি: ${log.coffee_cups || 0} কাপ
- খাবার: ${log.food_eaten || 'জানানো হয়নি'}
- পানীয়: ${log.drinks_taken || 'জানানো হয়নি'}
- পানি: ${log.water_intake || 2} লিটার
- ঘুম: ${log.sleep_hours || 7} ঘণ্টা (${log.sleep_quality || 'মাঝারি'})
- পছন্দের খাবার: ${log.food_preference_today || 'কিছু বলেননি'}
- নোট: ${log.notes || 'কিছু নেই'}
` : 'গত রাতের কোনো আপডেট নেই।';

      // Weather data
      let weatherStr = '';
      try {
        const WK = process.env.OPENWEATHER_API_KEY;
        if (WK) {
          const wr = await fetch(
            `https://api.openweathermap.org/data/2.5/weather?q=Dhaka,BD&appid=${WK}&units=metric&lang=en`
          );
          if (wr.ok) {
            const wd = await wr.json();
            const isRain  = wd.weather?.[0]?.main === 'Rain';
            const isHot   = wd.main?.temp > 34;
            const isCold  = wd.main?.temp < 18;
            const isHumid = wd.main?.humidity > 80;
            weatherStr = `
আজকের ঢাকার আবহাওয়া:
- তাপমাত্রা: ${wd.main?.temp}°C (feels like ${wd.main?.feels_like}°C)
- অবস্থা: ${wd.weather?.[0]?.description}
- আর্দ্রতা: ${wd.main?.humidity}%
- বৃষ্টি: ${isRain ? 'হ্যাঁ' : 'না'}
- পরামর্শ: ${isHot ? 'অত্যন্ত গরম — বেশি পানি ও ঠান্ডা খাবার' : isCold ? 'ঠান্ডা — গরম স্যুপ ও আদা চা' : isHumid ? 'আর্দ্র — হালকা ও সহজপাচ্য খাবার' : 'স্বাভাবিক আবহাওয়া'}`;
          }
        }
      } catch(we) { /* non-critical */ }

      // Special flags
      const periodFlag = log.period_today || log.cramping;
      const stressFlag = (log.stress_level || 0) >= 7;
      const feverFlag  = log.fever;
      const coffeeFlag = (log.coffee_cups || 0) >= 3;

      finalPrompt = `তুমি SAR She AI Restaurant-এর বিশেষজ্ঞ AI স্বাস্থ্য বিশ্লেষক।
তুমি বাংলাদেশের নারীদের স্বাস্থ্য বিশেষজ্ঞ। পরামর্শ বৈজ্ঞানিক, আয়ুর্বেদিক ও ইসলামিক।

গ্রাহক: ${customer.full_name || 'SAR গ্রাহক'}
বয়স: ${age ? age + ' বছর' : 'অজানা'}
রোগ বিভাগ: ${catMap[customer.sar_category] || customer.sar_category || 'DM'}
${isBday ? '🎂 আজ তাঁর জন্মদিন!' : ''}

━━━ স্বাস্থ্য মেট্রিক্স ━━━
${metricsStr}

━━━ গত রাতের আপডেট ━━━
${logStr}
${weatherStr ? '\n━━━ আজকের আবহাওয়া ━━━\n' + weatherStr : ''}
${periodFlag  ? '\n⚠️ মাসিক/cramping আছে — বিশেষ পরামর্শ দাও।'                    : ''}
${stressFlag  ? '\n⚠️ মানসিক চাপ বেশি ('+log.stress_level+'/10) — EI support দাও।' : ''}
${feverFlag   ? '\n⚠️ জ্বর আছে — হালকা খাবার ও ঘরোয়া প্রতিকার দাও।'              : ''}
${coffeeFlag  ? '\n⚠️ অতিরিক্ত কফি ('+log.coffee_cups+' কাপ) — সতর্ক করো।'        : ''}

উপরের সব তথ্য বিশ্লেষণ করে শুধু নিচের JSON দাও (markdown নয়, শুধু JSON):

{
  "health_score": 70,
  "analysis_bn": "৩-৪ বাক্যে আজকের স্বাস্থ্য মূল্যায়ন",
  "morning_greeting": "ব্যক্তিগত সুপ্রভাত বার্তা",
  "problems": ["সমস্যা ১", "সমস্যা ২"],
  "solutions": ["সমাধান ১", "সমাধান ২"],
  "conventional_medicine": ["Generic নাম, ডোজ, সময়"],
  "homeopathic": ["হোমিওপ্যাথিক পরামর্শ"],
  "ayurvedic": ["আয়ুর্বেদিক চিকিৎসা"],
  "islamic_advice": ["ইসলামিক/সুন্নাহ পরামর্শ, দুআ"],
  "home_remedy": ["ঘরোয়া/কবিরাজি প্রতিকার"],
  "herbs_today": ["আজকের বিশেষ herb/powder ও পদ্ধতি"],
  "food_remedies": ["খাবারভিত্তিক প্রতিকার"],
  "recommendations": "সার্বিক পরামর্শ",
  "weather_advice": "${weatherStr ? 'আবহাওয়া অনুযায়ী পরামর্শ' : ''}",
  "period_advice": "${periodFlag ? 'মাসিক/cramping পরামর্শ' : ''}",
  "ei_message": "আবেগীয় সহায়তা বার্তা",
  "dangers": "জরুরি সতর্কতা — না থাকলে খালি string",
  "daily_menu": {
    "breakfast": {
      "name": "নাস্তার নাম (SAR therapeutic recipe)",
      "calories": 280,
      "benefits": "স্বাস্থ্য উপকার",
      "herbs": "ব্যবহৃত herbs"
    },
    "lunch": {
      "name": "দুপুরের নাম",
      "calories": 420,
      "benefits": "স্বাস্থ্য উপকার",
      "herbs": "ব্যবহৃত herbs"
    },
    "dinner": {
      "name": "রাতের নাম",
      "calories": 350,
      "benefits": "স্বাস্থ্য উপকার",
      "herbs": "ব্যবহৃত herbs"
    }
  },
  "birthday_message": "${isBday ? 'জন্মদিনের শুভেচ্ছা ও স্বাস্থ্য পরামর্শ' : ''}",
  "whatsapp_summary": "২-৩ লাইনে WhatsApp বার্তা"
}`;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CALL CLAUDE API
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500, headers: h,
        body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in Netlify environment variables' })
      };
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 2500,
        messages:   [{ role: 'user', content: finalPrompt }]
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return {
        statusCode: r.status, headers: h,
        body: JSON.stringify({ error: 'Claude API error ' + r.status, detail: errText.substring(0,200) })
      };
    }

    const d    = await r.json();
    const text = d.content?.[0]?.text || '';

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PARSE JSON RESPONSE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let parsed = null;
    try {
      let clean = text.replace(/```json|```/g, '').trim();
      const jsonStart = clean.indexOf('{');
      const jsonEnd   = clean.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        clean = clean.substring(jsonStart, jsonEnd + 1);
      }
      parsed = JSON.parse(clean);
    } catch(pe) {
      // ── অসম্পূর্ণ/truncated JSON — field গুলো আলাদা করে উদ্ধার করি ──
      const grabStr = (key) => {
        const m = text.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
        return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ') : null;
      };
      const grabNum = (key) => {
        const m = text.match(new RegExp('"' + key + '"\\s*:\\s*(\\d+)'));
        return m ? parseInt(m[1]) : null;
      };
      const grabArr = (key) => {
        const m = text.match(new RegExp('"' + key + '"\\s*:\\s*\\[([^\\]]*)\\]'));
        if (!m) return [];
        return (m[1].match(/"((?:[^"\\]|\\.)*)"/g) || []).map(s => s.slice(1,-1));
      };

      parsed = {
        health_score:           grabNum('health_score') ?? null,
        analysis_bn:            grabStr('analysis_bn') || 'বিশ্লেষণ অসম্পূর্ণ — আবার চেষ্টা করুন।',
        morning_greeting:       grabStr('morning_greeting') || '',
        recommendations:        grabStr('recommendations') || '',
        problems:               grabArr('problems'),
        solutions:              grabArr('solutions'),
        conventional_medicine:  grabArr('conventional_medicine'),
        homeopathic:            grabArr('homeopathic'),
        ayurvedic:              grabArr('ayurvedic'),
        food_remedies:          grabArr('food_remedies'),
        _truncated:             true   // debug: parse fail হয়েছিল বোঝাতে
      };
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // RETURN
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    return {
      statusCode: 200,
      headers:    h,
      body:       JSON.stringify({
        text,          // raw Claude text
        parsed,        // parsed JSON object
        ...parsed      // spread for direct field access
      })
    };

  } catch(e) {
    console.error('analyze.js error:', e);
    return {
      statusCode: 500,
      headers:    h,
      body:       JSON.stringify({ error: e.message })
    };
  }
};
