// ════════════════════════════════════════════════════════════════════════
// SAR COMPLETE RULE ENGINE v3.0
// netlify/functions/sar_rule_engine.js
//
// বিজ্ঞানভিত্তিক সম্পূর্ণ Rule Engine:
// ► 16টি condition: fever, cold_cough, stress, menstruation, headache,
//   migraine, fatigue, weakness, loose_motion, diarrhea, dysentery,
//   journey, sleep_disorder, depression, constipation, acidity
// ► 5টি disease category: DM, OB, FL, IB, PR
// ► প্রতিটির জন্য: calorie calc, 7 nutrients, 5 DV%, 5 benefits,
//   chutney, topping, disease powder (×2), condition powder
// ════════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────────────
// SECTION 1 — DISEASE BASE PROFILES
// Base calorie, macro targets, 2 medicinal powders per disease
// ──────────────────────────────────────────────────────────────────────
const DISEASE_PROFILES = {

  DM: {
    name_bn:      'ডায়াবেটিস',
    base_kcal:    1600,
    base_protein: 65,   // g/day — higher to slow glucose absorption
    base_fiber:   30,   // g/day — critical for glycemic control
    base_fat:     45,   // g/day — healthy fats only
    base_carb:    180,  // g/day — low-GI only
    calorie_logic: 'Low-GI খাবার, ধীরে হজম, রক্তে শর্করা স্থিতিশীল রাখতে ক্যালরি মাঝারি।',
    // ২টি disease medicinal powder
    disease_powder_1: { name:'করলা-মেথি চূর্ণ', dose:'১ চা চামচ সকালে খালি পেটে উষ্ণ পানিতে', benefit:'রক্তের শর্করা নিয়ন্ত্রণ, ইনসুলিন সংবেদনশীলতা বৃদ্ধি' },
    disease_powder_2: { name:'জামুন বীজ-আমলকী চূর্ণ', dose:'½ চা চামচ দুপুরে খাওয়ার আগে', benefit:'HbA1c হ্রাস, অগ্ন্যাশয় সক্রিয় করে' },
    // Disease topping
    disease_topping: { items:['চিয়া বীজ', 'তিসি বীজ', 'কালোজিরা', 'দারুচিনি গুঁড়া'], benefit:'GI কমায়, ওমেগা-৩, ক্রোমিয়াম যোগায়' },
    // Disease chutney
    disease_chutney: { name:'জামুন-তেঁতুল চাটনি', ingredients:['জামুন', 'তেঁতুল', 'আদা', 'ধনেপাতা'], benefit:'রক্তে শর্করা কমায়, অ্যান্টি-ডায়াবেটিক' },
    // Key ingredients pool
    ingredients: {
      grain:   ['লাল চাল', 'ওটস', 'যব', 'বাজরা', 'কিনোয়া'],
      protein: ['ছোলার স্প্রাউট', 'মুগ ডাল', 'বোনলেস মাছ', 'দেশি ডিম', 'মসুর ডাল'],
      veg:     ['করলা', 'ঝিঙে', 'চিচিঙ্গা', 'ধুন্দুল', 'শশা', 'লাউ'],
      leafy:   ['পালং শাক', 'মেথি পাতা', 'সজনে পাতা', 'নিম পাতা'],
      seed:    ['চিয়া বীজ', 'তিসি বীজ', 'কুমড়ার বীজ'],
    },
  },

  OB: {
    name_bn:      'স্থূলতা',
    base_kcal:    1350,
    base_protein: 80,   // g/day — high protein to preserve muscle, boost satiety
    base_fiber:   35,   // g/day — maximum fiber for satiety
    base_fat:     35,   // g/day — very low fat
    base_carb:    140,  // g/day — low carb
    calorie_logic: 'ক্যালরি ঘাটতি তৈরি করতে কম, উচ্চ প্রোটিন পেশি রক্ষা করে, উচ্চ ফাইবার পেট ভরা রাখে।',
    disease_powder_1: { name:'ত্রিফলা-গুগ্গুল চূর্ণ', dose:'১ চা চামচ রাতে ঘুমানোর আগে উষ্ণ পানিতে', benefit:'বিপাক বৃদ্ধি, চর্বি পোড়ায়, পাচনতন্ত্র পরিষ্কার' },
    disease_powder_2: { name:'গার্সিনিয়া-আদা চূর্ণ', dose:'½ চা চামচ খাওয়ার ৩০ মিনিট আগে', benefit:'ক্ষুধা কমায়, চর্বি সংশ্লেষণ বাধা দেয়' },
    disease_topping: { items:['কুমড়ার বীজ', 'সূর্যমুখী বীজ', 'তিসি বীজ', 'শশার বীজ'], benefit:'স্বাস্থ্যকর চর্বি, তৃপ্তি বাড়ায়, বিপাক সক্রিয়' },
    disease_chutney: { name:'লেবু-পুদিনা-আদা চাটনি', ingredients:['লেবু', 'পুদিনা', 'আদা', 'কাঁচা মরিচ'], benefit:'বিপাক বৃদ্ধি, ডিটক্স, ক্ষুধা নিয়ন্ত্রণ' },
    ingredients: {
      grain:   ['মিলেট', 'ওটস', 'যব', 'বাজরা'],
      protein: ['গ্রিক ইয়োগার্ট', 'মুগ স্প্রাউট', 'দেশি মুরগি', 'সয়াবিন'],
      veg:     ['শশা', 'ধুন্দুল', 'লাউ', 'চিচিঙ্গা', 'ঝিঙে', 'ক্যাপসিকাম'],
      leafy:   ['সজনে পাতা', 'পালং শাক', 'জলপাই শাক', 'পুদিনা'],
      seed:    ['তিসি বীজ', 'কুমড়ার বীজ', 'শশার বীজ', 'বেসিল বীজ'],
    },
  },

  FL: {
    name_bn:      'ফ্যাটি লিভার',
    base_kcal:    1500,
    base_protein: 65,
    base_fiber:   28,
    base_fat:     40,
    base_carb:    165,
    calorie_logic: 'লিভার পুনরুদ্ধারে মাঝারি ক্যালরি, অ্যান্টি-অক্সিডেন্ট সমৃদ্ধ, ALT কমাতে সাহায্য করে।',
    disease_powder_1: { name:'ভুমি আমলকী-হলুদ চূর্ণ', dose:'১ চা চামচ সকালে খালি পেটে', benefit:'ALT/AST কমায়, লিভার কোষ পুনর্জন্ম, ডিটক্সিফিকেশন' },
    disease_powder_2: { name:'দুধ থিস্টল-নিম চূর্ণ', dose:'½ চা চামচ সন্ধ্যায়', benefit:'সিলিমারিন লিভার রক্ষা করে, প্রদাহ কমায়' },
    disease_topping: { items:['সূর্যমুখী বীজ', 'তিল', 'আখরোট কুচি', 'তিসি বীজ'], benefit:'ভিটামিন-ই, ওমেগা-৩, লিভার ফ্যাট কমায়' },
    disease_chutney: { name:'আমলকী-আদা-হলুদ চাটনি', ingredients:['আমলকী', 'আদা', 'হলুদ', 'লেবু'], benefit:'শক্তিশালী হেপাটোপ্রোটেক্টিভ, অ্যান্টি-ইনফ্লেমেটরি' },
    ingredients: {
      grain:   ['ওটস', 'বাদামি চাল', 'যব', 'কিনোয়া'],
      protein: ['বোনলেস মাছ', 'মসুর ডাল', 'মুগ স্প্রাউট', 'চিকেন'],
      veg:     ['মূলা', 'গাজর', 'বিট', 'ব্রোকলি', 'বাঁধাকপি', 'টমেটো'],
      leafy:   ['ধনেপাতা', 'পুদিনা', 'পালং শাক', 'জলপাই শাক'],
      seed:    ['সূর্যমুখী বীজ', 'তিল', 'তিসি বীজ'],
    },
  },

  IB: {
    name_bn:      'IBS/গ্যাস্ট্রিক',
    base_kcal:    1550,
    base_protein: 55,   // moderate — some proteins trigger IBS
    base_fiber:   20,   // lower soluble fiber only
    base_fat:     50,
    base_carb:    200,
    calorie_logic: 'Low-FODMAP নীতি, গাট হিলিং খাবার, সহজে হজমযোগ্য, প্রদাহ কমানো।',
    disease_powder_1: { name:'ত্রিফলা-শতাব্দী চূর্ণ', dose:'½ চা চামচ রাতে উষ্ণ পানিতে', benefit:'গাট মাইক্রোবায়োম উন্নত, কোষ্ঠকাঠিন্য ও ডায়রিয়া উভয় নিয়ন্ত্রণ' },
    disease_powder_2: { name:'মৌরি-আজওয়াইন-হিং চূর্ণ', dose:'১ চা চামচ খাওয়ার পর', benefit:'গ্যাস, ব্লোটিং, স্পাজম কমায়' },
    disease_topping: { items:['বেসিল বীজ', 'তিসি বীজ', 'ভুনা জিরা', 'মৌরি'], benefit:'পাচক এনজাইম উদ্দীপক, গাট লাইনিং সুরক্ষা' },
    disease_chutney: { name:'পুদিনা-আজওয়াইন চাটনি', ingredients:['পুদিনা', 'আজওয়াইন', 'আদা', 'লেবু'], benefit:'অ্যান্টিস্পাজমোডিক, গ্যাস নিরাময়, হজম উন্নত' },
    ingredients: {
      grain:   ['সাদা চাল', 'ওটস', 'চালের আটা', 'কলার আটা'],
      protein: ['মুগ ডাল', 'দেশি মুরগি', 'গ্রিক ইয়োগার্ট', 'বোনলেস মাছ'],
      veg:     ['কাঁচা কলা', 'গাজর', 'মিষ্টি আলু', 'সজনা', 'লাউ'],
      leafy:   ['পুদিনা', 'কারিপাতা', 'ধনেপাতা', 'পালং শাক'],
      seed:    ['বেসিল বীজ', 'তিসি বীজ', 'মৌরি'],
    },
  },

  PR: {
    name_bn:      'গর্ভাবস্থা',
    base_kcal:    1850,  // +300 kcal above normal
    base_protein: 75,    // g/day — fetal development
    base_fiber:   28,
    base_fat:     60,
    base_carb:    230,
    calorie_logic: 'ভ্রূণের বিকাশে +৩০০ kcal, ফোলেট ও আয়রন অগ্রাধিকার, ক্যালসিয়াম হাড় গঠনে।',
    disease_powder_1: { name:'শতাবরী-মরিঙ্গা চূর্ণ', dose:'১ চা চামচ সকালে দুধ-মুক্ত পানীয়তে', benefit:'ভ্রূণের মস্তিষ্ক বিকাশ, মাতৃদুগ্ধ উৎপাদন, হরমোন ভারসাম্য' },
    disease_powder_2: { name:'অশোক-অশ্বগন্ধা চূর্ণ', dose:'½ চা চামচ সন্ধ্যায়', benefit:'জরায়ু শক্তিশালী, গর্ভাবস্থার উদ্বেগ কমায়' },
    disease_topping: { items:['তিল', 'কাজু কুচি', 'কুমড়ার বীজ', 'আখরোট'], benefit:'DHA, ক্যালসিয়াম, ওমেগা-৩ — ভ্রূণের মস্তিষ্ক ও হাড়' },
    disease_chutney: { name:'ডালিম-আমলকী চাটনি', ingredients:['ডালিম', 'আমলকী', 'আদা', 'গোলাপজল'], benefit:'আয়রন শোষণ বৃদ্ধি, অ্যান্টি-অক্সিডেন্ট, রক্তাল্পতা প্রতিরোধ' },
    ingredients: {
      grain:   ['লাল চাল', 'ওটস', 'কিনোয়া', 'বাজরা'],
      protein: ['দেশি ডিম', 'বোনলেস মাছ', 'মুগ ডাল', 'বাদাম'],
      veg:     ['সজনা', 'মিষ্টি কুমড়া', 'বিট', 'গাজর', 'মিষ্টি আলু'],
      leafy:   ['সজনে পাতা', 'লাল শাক', 'পালং শাক', 'মেথি পাতা'],
      seed:    ['তিল', 'কুমড়ার বীজ', 'আখরোট', 'বাদাম'],
    },
  },
};

// ──────────────────────────────────────────────────────────────────────
// SECTION 2 — CONDITION PROFILES (16 conditions)
// Scientific calorie impact, chutney, powder, topping, nutrient priority
// ──────────────────────────────────────────────────────────────────────
const CONDITION_PROFILES = {

  fever: {
    name_bn: 'জ্বর',
    // SCIENCE: Fever raises BMR ~7% per 1°F above 98.6°F
    // But digestion weakens — NET: REDUCE calories 10-15%, light foods
    calorie_effect: -0.12,   // −12% from base
    calorie_logic:  'জ্বরে বিপাকক্রিয়া বাড়ে কিন্তু হজম দুর্বল হয়। হালকা, সহজপাচ্য, তরলসমৃদ্ধ খাবার দরকার।',
    priority_nutrients: ['ভিটামিন-সি', 'জিঙ্ক', 'ভিটামিন-এ', 'পটাসিয়াম', 'ইলেক্ট্রোলাইট'],
    add_ingredients: ['সজনে পাতা', 'তুলসি পাতা', 'আদা', 'রসুন', 'লেবু', 'নারকেল পানি'],
    remove_ingredients: ['ভারী grain', 'কাঁচা সবজি', 'উচ্চ ফাইবার শাক'],
    reduce_foods: 'ভারী খাবার কমান — grain ৫০% কমান, তরল বাড়ান',
    chutney: { name:'তুলসি-আদা-তেঁতুল চাটনি', ingredients:['তুলসি', 'আদা', 'তেঁতুল', 'লেবু', 'কালো গোলমরিচ'], benefit:'অ্যান্টিপাইরেটিক, ইমিউন বুস্ট, শরীর ঠান্ডা করে, ইনফ্লেমেশন কমায়' },
    powder: { name:'হলুদ-আদা-তুলসি চূর্ণ', dose:'½ চা চামচ উষ্ণ পানিতে ৩ বার', benefit:'কার্কুমিন অ্যান্টিব্যাকটেরিয়াল, জিঞ্জেরল অ্যান্টিভাইরাল, তাপমাত্রা কমায়' },
    topping: { items:['তিসি বীজ', 'কালোজিরা', 'তুলসি বীজ'], benefit:'ওমেগা-৩, থাইমোকুইনন — প্রতিরোধ শক্তি বৃদ্ধি' },
    benefits: ['শরীরের তাপমাত্রা স্বাভাবিক করে', 'রোগ প্রতিরোধ শক্তি বাড়ায়', 'হাইড্রেশন বজায় রাখে', 'শক্তির ঘাটতি পূরণ করে', 'ইনফ্লেমেশন কমায়'],
  },

  cold_cough: {
    name_bn: 'সর্দি-কাশি',
    calorie_effect: +0.05,   // +5% — immune system needs energy
    calorie_logic:  'ইমিউন সিস্টেম সক্রিয় থাকায় সামান্য বেশি ক্যালরি দরকার। ভিটামিন-সি ও জিঙ্ক অগ্রাধিকার।',
    priority_nutrients: ['ভিটামিন-সি', 'জিঙ্ক', 'ভিটামিন-ডি', 'কোয়ার্সেটিন', 'বেটা-গ্লুকান'],
    add_ingredients: ['আমলকী', 'তুলসি', 'আদা', 'রসুন', 'মধু (যদি অনুমোদিত)', 'লেবু'],
    remove_ingredients: ['ঠান্ডা খাবার', 'কাঁচা শাকসবজি'],
    chutney: { name:'আমলকী-রসুন-আদা চাটনি', ingredients:['আমলকী', 'রসুন', 'আদা', 'কালো গোলমরিচ', 'লেবু'], benefit:'অ্যান্টিভাইরাল, মিউকাস পরিষ্কার, ফুসফুস শক্তিশালী' },
    powder: { name:'সিতোপালাদি-তালিসাদি চূর্ণ', dose:'১ চা চামচ উষ্ণ পানিতে দিনে ২ বার', benefit:'শ্বাসনালী পরিষ্কার, কাশি কমায়, গলা ব্যথা সারায়' },
    topping: { items:['কালোজিরা', 'আদা কুচি', 'তুলসি বীজ'], benefit:'শ্বাসনালী খোলে, মিউকাস কমায়' },
    benefits: ['শ্বাসনালী পরিষ্কার করে', 'ভাইরাস প্রতিরোধ করে', 'মিউকাস কমায়', 'গলা ব্যথা সারায়', 'দ্রুত সুস্থতা আনে'],
  },

  stress: {
    name_bn: 'মানসিক চাপ',
    // SCIENCE: Cortisol increases, blood sugar spikes, cravings for refined carbs
    // → REDUCE refined carbs, INCREASE Mg, B-vitamins, adaptogens
    calorie_effect: 0.00,    // same calories, but different macro distribution
    calorie_logic:  'কর্টিসল বাড়লে রক্তে শর্করা ওঠানামা করে। পরিশোধিত কার্ব কমান, ম্যাগনেসিয়াম ও B-ভিটামিন বাড়ান।',
    priority_nutrients: ['ম্যাগনেসিয়াম', 'ভিটামিন-B6', 'ভিটামিন-B12', 'ওমেগা-৩', 'ট্রিপটোফ্যান'],
    add_ingredients: ['আখরোট', 'কুমড়ার বীজ', 'পালং শাক', 'কলা', 'ডার্ক চকলেট (সীমিত)'],
    remove_ingredients: ['পরিশোধিত কার্ব', 'ক্যাফেইন অতিরিক্ত'],
    chutney: { name:'ব্রাহ্মী-গোলাপ পাপড়ি চাটনি', ingredients:['ব্রাহ্মী পাতা', 'গোলাপজল', 'আমলকী', 'লেবু'], benefit:'নিউরোপ্রোটেক্টিভ, কর্টিসল কমায়, মন শান্ত করে' },
    powder: { name:'অশ্বগন্ধা-ব্রাহ্মী চূর্ণ', dose:'১ চা চামচ রাতে উষ্ণ পানিতে', benefit:'অ্যাডাপটোজেন — কর্টিসল হ্রাস, উদ্বেগ কমায়, ঘুম উন্নত করে' },
    topping: { items:['আখরোট', 'কুমড়ার বীজ', 'তিসি বীজ'], benefit:'ওমেগা-৩, ম্যাগনেসিয়াম — মস্তিষ্ক শান্ত রাখে' },
    benefits: ['কর্টিসল কমায়', 'মস্তিষ্কের কার্যকারিতা উন্নত', 'ঘুমের মান বাড়ায়', 'রক্তচাপ স্বাভাবিক রাখে', 'মেজাজ উন্নত করে'],
  },

  menstruation: {
    name_bn: 'মাসিক',
    // SCIENCE: Iron loss 30-80mg/cycle, increase iron, folate, magnesium for cramps
    // Day 1-3: +150-200 kcal for energy expenditure
    calorie_effect: +0.12,
    calorie_logic:  'মাসিকে আয়রন হারানো হয় (৩০-৮০mg), cramping-এ ম্যাগনেসিয়াম দরকার, এনার্জি ক্ষয় বেশি।',
    priority_nutrients: ['আয়রন', 'ফোলেট', 'ম্যাগনেসিয়াম', 'ভিটামিন-B6', 'ক্যালসিয়াম'],
    add_ingredients: ['লাল শাক', 'বিট', 'খেজুর', 'ডালিম', 'তিল', 'কুমড়ার বীজ', 'সজনে পাতা'],
    remove_ingredients: ['লবণাক্ত খাবার', 'ক্যাফেইন', 'কাঁচা বাঁধাকপি'],
    chutney: { name:'তেঁতুল-আমলকী-খেজুর চাটনি', ingredients:['তেঁতুল', 'আমলকী', 'খেজুর', 'গুড়', 'আদা'], benefit:'আয়রন শোষণ বৃদ্ধি, ভিটামিন-সি সহায়ক, ব্লিডিং নিয়ন্ত্রণ' },
    powder: { name:'অশোক-শতাবরী চূর্ণ', dose:'১ চা চামচ সকাল-রাত উষ্ণ পানিতে', benefit:'জরায়ুর ব্যথা কমায়, হরমোন ভারসাম্য, রক্তপাত নিয়ন্ত্রণ' },
    topping: { items:['তিল', 'কুমড়ার বীজ', 'খেজুর কুচি', 'ডালিম দানা'], benefit:'আয়রন, ম্যাগনেসিয়াম, প্রাকৃতিক মিষ্টি' },
    benefits: ['আয়রন ঘাটতি পূরণ', 'cramping কমায়', 'মেজাজ স্থিতিশীল করে', 'রক্ত তৈরিতে সাহায্য', 'হরমোন ভারসাম্য রক্ষা'],
  },

  headache: {
    name_bn: 'মাথাব্যথা',
    // SCIENCE: Dehydration, low Mg, tyramine trigger — reduce tyramine, increase Mg, water
    calorie_effect: -0.05,
    calorie_logic:  'মাথাব্যথায় ডিহাইড্রেশন বড় কারণ। টাইরামিন খাবার বাদ, ম্যাগনেসিয়াম ও পানি বাড়ান।',
    priority_nutrients: ['ম্যাগনেসিয়াম', 'ভিটামিন-B2', 'পানি', 'ভিটামিন-ডি', 'কোএনজাইম-Q10'],
    add_ingredients: ['পালং শাক', 'কুমড়ার বীজ', 'আখরোট', 'আদা', 'লেবু'],
    remove_ingredients: ['পুরনো পনির', 'ক্যাফেইন অতিরিক্ত', 'আচার', 'প্রক্রিয়াজাত খাবার'],
    chutney: { name:'আদা-পুদিনা-লেবু চাটনি', ingredients:['আদা', 'পুদিনা', 'লেবু', 'গোলমরিচ'], benefit:'ব্যথা উপশম, রক্ত সঞ্চালন বৃদ্ধি, ডিহাইড্রেশন দূর' },
    powder: { name:'ভৃঙ্গরাজ-ব্রাহ্মী চূর্ণ', dose:'½ চা চামচ পানিতে দিনে ২ বার', benefit:'মস্তিষ্কের রক্ত সঞ্চালন উন্নত, মাথাব্যথা কমায়' },
    topping: { items:['আখরোট', 'কুমড়ার বীজ', 'তিসি বীজ'], benefit:'ম্যাগনেসিয়াম, ওমেগা-৩ — প্রদাহ কমায়' },
    benefits: ['মাথাব্যথা উপশম', 'মস্তিষ্কে রক্ত সঞ্চালন বাড়ায়', 'ম্যাগনেসিয়াম ঘাটতি পূরণ', 'হাইড্রেশন উন্নত', 'নার্ভ শান্ত করে'],
  },

  migraine: {
    name_bn: 'মাইগ্রেন',
    // SCIENCE: Serotonin drop, tyramine triggers, Mg deficiency
    calorie_effect: -0.08,
    calorie_logic:  'মাইগ্রেনে সেরোটোনিন কমে, টাইরামিন সমৃদ্ধ খাবার ট্রিগার। সেরোটোনিন precursor খাবার, ম্যাগনেসিয়াম জরুরি।',
    priority_nutrients: ['ম্যাগনেসিয়াম', 'ভিটামিন-B2 (Riboflavin)', 'কোএনজাইম-Q10', 'ট্রিপটোফ্যান', 'ওমেগা-৩'],
    add_ingredients: ['কুমড়ার বীজ', 'পালং শাক', 'আখরোট', 'আদা', 'হলুদ'],
    remove_ingredients: ['পুরনো খাবার', 'অতিরিক্ত নুন', 'ক্যাফেইন', 'সাইট্রাস ফল অতিরিক্ত'],
    chutney: { name:'আদা-হলুদ-ধনেপাতা চাটনি', ingredients:['আদা', 'হলুদ', 'ধনেপাতা', 'লেবু'], benefit:'সেরোটোনিন স্থিতিশীল, প্রদাহ কমায়, নার্ভ রিল্যাক্স' },
    powder: { name:'ভৃঙ্গরাজ-শঙ্খপুষ্পি চূর্ণ', dose:'½ চা চামচ ঘুমানোর আগে', benefit:'মাইগ্রেন ফ্রিকোয়েন্সি কমায়, সেরোটোনিন উৎপাদন বাড়ায়' },
    topping: { items:['আখরোট', 'কুমড়ার বীজ', 'তিল'], benefit:'ম্যাগনেসিয়াম ও B2 সমৃদ্ধ — মাইগ্রেন প্রতিরোধ' },
    benefits: ['মাইগ্রেনের তীব্রতা কমায়', 'ট্রিগার ফুড বাদ দেয়', 'সেরোটোনিন স্থিতিশীল রাখে', 'ম্যাগনেসিয়াম সরবরাহ', 'প্রদাহ নিয়ন্ত্রণ'],
  },

  fatigue: {
    name_bn: 'ক্লান্তি',
    // SCIENCE: Low iron, B12, complex carb depletion — increase all
    calorie_effect: +0.10,
    calorie_logic:  'ক্লান্তিতে গ্লাইকোজেন ক্ষয় হয়। কমপ্লেক্স কার্ব, আয়রন ও B12 বাড়িয়ে এনার্জি পুনরুদ্ধার।',
    priority_nutrients: ['আয়রন', 'ভিটামিন-B12', 'ফোলেট', 'কমপ্লেক্স কার্বোহাইড্রেট', 'ভিটামিন-সি'],
    add_ingredients: ['লাল চাল', 'মসুর ডাল', 'বোনলেস মাছ', 'সজনে পাতা', 'বিট', 'খেজুর'],
    remove_ingredients: ['সহজ চিনি', 'পরিশোধিত খাবার'],
    chutney: { name:'খেজুর-আমলকী-বিট চাটনি', ingredients:['খেজুর', 'আমলকী', 'বিট', 'আদা', 'লেবু'], benefit:'তাৎক্ষণিক এনার্জি, আয়রন শোষণ, রক্ত তৈরি' },
    powder: { name:'অশ্বগন্ধা-শিলাজিত চূর্ণ', dose:'১ চা চামচ সকালে উষ্ণ পানিতে', benefit:'মাইটোকন্ড্রিয়াল এনার্জি উৎপাদন বাড়ায়, ক্লান্তি দূর করে' },
    topping: { items:['খেজুর কুচি', 'বাদাম', 'তিল', 'কুমড়ার বীজ'], benefit:'দ্রুত শক্তি, আয়রন, ম্যাগনেসিয়াম' },
    benefits: ['এনার্জি দ্রুত পুনরুদ্ধার', 'আয়রনের ঘাটতি পূরণ', 'মাইটোকন্ড্রিয়া সক্রিয়', 'রক্ত তৈরি সহায়তা', 'মানসিক সতেজতা আনে'],
  },

  weakness: {
    name_bn: 'দুর্বলতা',
    // SCIENCE: Protein catabolism, electrolyte imbalance — increase protein+electrolytes
    calorie_effect: +0.15,
    calorie_logic:  'দুর্বলতায় পেশির প্রোটিন ভাঙে। প্রোটিন ২০% বৃদ্ধি, ইলেক্ট্রোলাইট ও মিনারেল সমৃদ্ধ খাবার।',
    priority_nutrients: ['প্রোটিন', 'সোডিয়াম', 'পটাসিয়াম', 'ম্যাগনেসিয়াম', 'ভিটামিন-B12'],
    add_ingredients: ['বোনলেস মাছ', 'দেশি ডিম', 'দেশি মুরগি', 'বাদাম', 'কাজু', 'নারকেল পানি'],
    remove_ingredients: ['কম পুষ্টির খাবার'],
    chutney: { name:'আমলকী-রসুন-নারকেল চাটনি', ingredients:['আমলকী', 'রসুন', 'নারকেল', 'লেবু'], benefit:'প্রোটিন শোষণ বৃদ্ধি, ইমিউন বুস্ট, ইলেক্ট্রোলাইট' },
    powder: { name:'অশ্বগন্ধা-শতাবরী চূর্ণ', dose:'১ চা চামচ দুবার সকাল-রাত', benefit:'পেশি শক্তি বৃদ্ধি, এনার্জি বাড়ায়, দুর্বলতা দূর' },
    topping: { items:['বাদাম', 'কাজু', 'তিল', 'কুমড়ার বীজ'], benefit:'উচ্চ প্রোটিন, ম্যাগনেসিয়াম, দ্রুত শক্তি' },
    benefits: ['পেশির শক্তি পুনরুদ্ধার', 'ইলেক্ট্রোলাইট সুষম', 'প্রোটিন সংশ্লেষণ বাড়ায়', 'দ্রুত সুস্থতা', 'রোগ প্রতিরোধ শক্তি বৃদ্ধি'],
  },

  loose_motion: {
    name_bn: 'পাতলা পায়খানা',
    // SCIENCE: BRAT diet — Banana, Rice, Apple, Toast. LOW fiber, electrolytes crucial
    calorie_effect: -0.15,
    calorie_logic:  'হজম দুর্বল, পুষ্টি শোষণ কম। BRAT নীতি — হালকা, সহজপাচ্য, ইলেক্ট্রোলাইট সমৃদ্ধ।',
    priority_nutrients: ['সোডিয়াম', 'পটাসিয়াম', 'জিঙ্ক', 'প্রোবায়োটিক', 'পানি'],
    add_ingredients: ['কাঁচা কলা', 'সাদা চাল', 'গ্রিক ইয়োগার্ট', 'নারকেল পানি', 'গাজর'],
    remove_ingredients: ['উচ্চ ফাইবার শাক', 'কাঁচা সবজি', 'মশলা', 'চর্বিযুক্ত খাবার'],
    chutney: { name:'ডাবের পানি-লেবু-লবণ চাটনি', ingredients:['ডাবের পানি', 'লেবু', 'গোলাপী লবণ', 'আদা'], benefit:'ORS-এর মতো ইলেক্ট্রোলাইট পূরণ, পাকস্থলী শান্ত করে' },
    powder: { name:'বেলের শাঁস-ইসবগুল চূর্ণ', dose:'১ চা চামচ ঠান্ডা পানিতে দিনে ৩ বার', benefit:'মল ঘন করে, পেটের আস্তরণ রক্ষা করে, ব্যাকটেরিয়া মেরে' },
    topping: { items:['ভুনা জিরা', 'বেসিল বীজ', 'সামান্য তিল'], benefit:'অ্যান্টিডায়ারিয়াল, গাট লাইনিং রিপেয়ার' },
    benefits: ['ইলেক্ট্রোলাইট পূরণ করে', 'মল ঘন করে', 'পাকস্থলীর প্রদাহ কমায়', 'ডিহাইড্রেশন রোধ করে', 'প্রোবায়োটিক সরবরাহ'],
  },

  diarrhea: {
    name_bn: 'ডায়রিয়া',
    // Severe version — stricter BRAT, more fluids
    calorie_effect: -0.20,
    calorie_logic:  'তীব্র ডায়রিয়ায় শরীর দুর্বল। খুব হালকা খাবার, সর্বোচ্চ তরল, ORS প্রতিস্থাপক।',
    priority_nutrients: ['পানি', 'সোডিয়াম', 'পটাসিয়াম', 'গ্লুকোজ', 'জিঙ্ক'],
    add_ingredients: ['কাঁচা কলা', 'ভাতের মাড়', 'নারকেল পানি', 'গ্রিক ইয়োগার্ট', 'দেশি ডিম সেদ্ধ'],
    remove_ingredients: ['সমস্ত কাঁচা সবজি', 'উচ্চ ফাইবার', 'মশলা', 'চর্বি', 'দুগ্ধজাত'],
    chutney: { name:'বেলের শাঁস-গোলাপী লবণ চাটনি', ingredients:['বেলের শাঁস', 'গোলাপী লবণ', 'জিরা', 'লেবু'], benefit:'ট্যানিন ব্যাকটেরিয়া মারে, ইলেক্ট্রোলাইট পূরণ' },
    powder: { name:'বেল-ইসবগুল-জিরা চূর্ণ', dose:'২ চা চামচ পানিতে দিনে ৪ বার', benefit:'অ্যান্টি-ডায়ারিয়াল, পেট বাঁধে, ব্যাকটেরিয়া নাশ' },
    topping: { items:['ভুনা জিরা', 'বেসিল বীজ'], benefit:'পাকস্থলী শান্ত, প্রদাহ নিরাময়' },
    benefits: ['তীব্র পানিশূন্যতা রোধ', 'ইলেক্ট্রোলাইট পুনরুদ্ধার', 'অন্ত্রের ক্ষতি কমায়', 'ব্যাকটেরিয়া নাশ করে', 'দ্রুত সুস্থতা'],
  },

  dysentery: {
    name_bn: 'আমাশয়',
    // Blood in stool — anti-bacterial, gut healing priority
    calorie_effect: -0.18,
    calorie_logic:  'আমাশয়ে অন্ত্রে ক্ষত হয়। খুব হালকা, অ্যান্টিব্যাকটেরিয়াল খাবার, কোনো কাঁচা খাবার নয়।',
    priority_nutrients: ['ভিটামিন-সি', 'জিঙ্ক', 'প্রোবায়োটিক', 'ট্যানিন', 'ভিটামিন-এ'],
    add_ingredients: ['বেল ফলের শাঁস', 'ডাবের পানি', 'কাঁচা কলা সেদ্ধ', 'গ্রিক ইয়োগার্ট', 'রসুন'],
    remove_ingredients: ['সমস্ত কাঁচা খাবার', 'মশলা', 'চর্বি', 'উচ্চ ফাইবার'],
    chutney: { name:'বেল-রসুন-হলুদ চাটনি', ingredients:['বেলের শাঁস', 'রসুন', 'হলুদ', 'গোলাপী লবণ'], benefit:'শক্তিশালী অ্যান্টিব্যাকটেরিয়াল, অন্ত্রের ক্ষত নিরাময়' },
    powder: { name:'কুটজ-বিল্ব (বেল) চূর্ণ', dose:'১ চা চামচ পানিতে দিনে ৩ বার', benefit:'আমাশয়ের প্রধান আয়ুর্বেদিক ওষুধ, রক্তপাত বন্ধ করে' },
    topping: { items:['ভুনা জিরা', 'হলুদ গুঁড়া'], benefit:'অ্যান্টিসেপটিক, অন্ত্র পরিষ্কার করে' },
    benefits: ['অন্ত্রের ক্ষত সারায়', 'ব্যাকটেরিয়া ও পরজীবী নাশ', 'রক্তপাত বন্ধ করে', 'অন্ত্রের আস্তরণ পুনর্গঠন', 'ডিহাইড্রেশন রোধ'],
  },

  journey: {
    name_bn: 'ভ্রমণ',
    // Motion sickness, nausea risk, no access to facilities
    calorie_effect: +0.05,
    calorie_logic:  'ভ্রমণে শক্তি বেশি খরচ হয়। হালকা, বহনযোগ্য, বমি বিরোধী খাবার অগ্রাধিকার।',
    priority_nutrients: ['ভিটামিন-B6', 'জিঞ্জেরল', 'পটাসিয়াম', 'কার্বোহাইড্রেট', 'ভিটামিন-সি'],
    add_ingredients: ['আদা', 'লেবু', 'বাদাম', 'শুকনো খেজুর', 'ওটস বার'],
    remove_ingredients: ['ভারী চর্বিযুক্ত খাবার', 'মশলাদার খাবার', 'ভাজা'],
    chutney: { name:'আদা-লেবু-পুদিনা চাটনি', ingredients:['আদা', 'লেবু', 'পুদিনা', 'জিরা'], benefit:'মোশন সিকনেস কমায়, বমি ভাব দূর করে' },
    powder: { name:'আদা-এলাচ-পুদিনা চূর্ণ', dose:'½ চা চামচ পানিতে যাত্রার আগে ও মাঝে', benefit:'অ্যান্টিনসিয়া, পাকস্থলী স্থিতিশীল রাখে' },
    topping: { items:['বাদাম', 'শুকনো আদা কুচি', 'মৌরি'], benefit:'পেট শান্ত, এনার্জি ধরে রাখে' },
    benefits: ['বমি ভাব দূর করে', 'হজম স্থিতিশীল রাখে', 'এনার্জি সরবরাহ', 'ডিহাইড্রেশন রোধ', 'মোশন সিকনেস কমায়'],
  },

  sleep_disorder: {
    name_bn: 'ঘুমের সমস্যা',
    // SCIENCE: Melatonin precursors (tryptophan), Mg deficiency, cortisol high
    calorie_effect: +0.05,
    calorie_logic:  'ঘুম কম হলে ঘ্রেলিন বাড়ে (ক্ষুধা হরমোন)। ট্রিপটোফ্যান ও ম্যাগনেসিয়াম সমৃদ্ধ খাবার।',
    priority_nutrients: ['ট্রিপটোফ্যান', 'ম্যাগনেসিয়াম', 'মেলাটোনিন precursor', 'ভিটামিন-B6', 'ক্যালসিয়াম'],
    add_ingredients: ['কুমড়ার বীজ', 'আখরোট', 'চেরি', 'কলা', 'ওটস'],
    remove_ingredients: ['ক্যাফেইন', 'ভারী রাতের খাবার', 'অতিরিক্ত চিনি'],
    chutney: { name:'চেরি-আখরোট-মধু চাটনি', ingredients:['শুকনো চেরি', 'আখরোট', 'গোলাপজল', 'এলাচ'], benefit:'প্রাকৃতিক মেলাটোনিন, ঘুম গভীর করে' },
    powder: { name:'ব্রাহ্মী-জটামাংসী চূর্ণ', dose:'১ চা চামচ ঘুমানোর ৩০ মিনিট আগে উষ্ণ পানিতে', benefit:'নার্ভ শান্ত করে, মেলাটোনিন বাড়ায়, গভীর ঘুম আনে' },
    topping: { items:['আখরোট', 'কুমড়ার বীজ', 'তিল'], benefit:'ট্রিপটোফ্যান ও ম্যাগনেসিয়াম — ঘুমের হরমোন তৈরিতে সহায়ক' },
    benefits: ['ঘুমের মান উন্নত করে', 'মেলাটোনিন উৎপাদন বাড়ায়', 'কর্টিসল কমায়', 'নার্ভ শান্ত রাখে', 'ঘুম চক্র স্বাভাবিক করে'],
  },

  depression: {
    name_bn: 'বিষণ্নতা',
    // SCIENCE: Serotonin/dopamine deficiency, omega-3, B12, folate crucial
    calorie_effect: +0.08,
    calorie_logic:  'বিষণ্নতায় সেরোটোনিন ও ডোপামিন কম। ওমেগা-৩, B12, ফোলেট ও সেরোটোনিন precursor বাড়ান।',
    priority_nutrients: ['ওমেগা-৩', 'ভিটামিন-B12', 'ফোলেট', 'ট্রিপটোফ্যান', 'জিঙ্ক'],
    add_ingredients: ['আখরোট', 'তিসি বীজ', 'বোনলেস মাছ (স্যামন টাইপ)', 'পালং শাক', 'ডার্ক চকোলেট (সীমিত)'],
    remove_ingredients: ['পরিশোধিত চিনি', 'অ্যালকোহল', 'ট্রান্স ফ্যাট'],
    chutney: { name:'ব্রাহ্মী-গোলাপ-আমলকী চাটনি', ingredients:['ব্রাহ্মী পাতা', 'গোলাপ পাপড়ি', 'আমলকী', 'মধু'], benefit:'মস্তিষ্কে সেরোটোনিন বাড়ায়, উদ্বেগ কমায়, মন উজ্জ্বল করে' },
    powder: { name:'অশ্বগন্ধা-শঙ্খপুষ্পি-জটামাংসী চূর্ণ', dose:'১ চা চামচ সকাল-রাত', benefit:'নিউরোট্রান্সমিটার ব্যালেন্স, বিষণ্নতা কমায়, মেজাজ উন্নত' },
    topping: { items:['আখরোট', 'তিসি বীজ', 'কুমড়ার বীজ', 'শুকনো চেরি'], benefit:'ওমেগা-৩, ট্রিপটোফ্যান, জিঙ্ক — মস্তিষ্কের নিউরোট্রান্সমিটার তৈরিতে সহায়ক' },
    benefits: ['সেরোটোনিন উৎপাদন বাড়ায়', 'মেজাজ স্থিতিশীল করে', 'মস্তিষ্কের প্রদাহ কমায়', 'শক্তি ও উদ্যম ফেরায়', 'ঘুমের মান উন্নত করে'],
  },

  constipation: {
    name_bn: 'কোষ্ঠকাঠিন্য',
    // HIGH fiber, warm water, probiotics
    calorie_effect: 0.00,
    calorie_logic:  'ফাইবার ও পানি সর্বোচ্চ বাড়ান। উষ্ণ পানীয়, প্রোবায়োটিক ও অলিভ অয়েল বিকল্প।',
    priority_nutrients: ['ফাইবার', 'পানি', 'ম্যাগনেসিয়াম', 'প্রোবায়োটিক', 'ভিটামিন-সি'],
    add_ingredients: ['বিট', 'পালং শাক', 'ঢেঁড়স', 'পেঁপে', 'ইসবগুলের ভুসি', 'খেজুর', 'আলুবোখারা'],
    remove_ingredients: ['সাদা চাল বেশি', 'পনির', 'কলা পাকা'],
    chutney: { name:'আলুবোখারা-বিট-লেবু চাটনি', ingredients:['আলুবোখারা', 'বিট', 'লেবু', 'আদা'], benefit:'প্রাকৃতিক রেচক, মল নরম করে, কোলন পরিষ্কার' },
    powder: { name:'ত্রিফলা-ইসবগুল চূর্ণ', dose:'১ চা চামচ রাতে ঘুমানোর আগে উষ্ণ পানিতে', benefit:'ত্রিফলা সর্বোত্তম প্রাকৃতিক রেচক, মল নরম ও নিয়মিত করে' },
    topping: { items:['তিসি বীজ', 'ইসবগুল', 'আলুবোখারা কুচি'], benefit:'সর্বোচ্চ সলিউবল ফাইবার — কোষ্ঠকাঠিন্য নিরাময়' },
    benefits: ['কোলন পরিষ্কার করে', 'মল নিয়মিত করে', 'পাচনতন্ত্র সক্রিয়', 'প্রদাহ কমায়', 'গাট ব্যাকটেরিয়া উন্নত'],
  },

  acidity: {
    name_bn: 'এসিডিটি/গ্যাস',
    // SCIENCE: Alkaline foods, small meals, no trigger foods
    calorie_effect: -0.05,
    calorie_logic:  'ছোট ছোট খাবার ৫-৬ বার। অ্যাসিড উৎপাদনকারী খাবার বাদ, ক্ষারীয় খাবার যোগ।',
    priority_nutrients: ['ক্যালসিয়াম', 'ম্যাগনেসিয়াম', 'ভিটামিন-U', 'ফাইবার', 'প্রোবায়োটিক'],
    add_ingredients: ['ডাবের পানি', 'কলা', 'কাঁচা কলা', 'ওটস', 'আদা', 'গ্রিক ইয়োগার্ট'],
    remove_ingredients: ['টমেটো অতিরিক্ত', 'তেতো করলা', 'মশলাদার', 'সাইট্রাস অতিরিক্ত'],
    chutney: { name:'পুদিনা-ডাবের পানি-আদা চাটনি', ingredients:['পুদিনা', 'ডাবের পানি', 'আদা', 'এলাচ'], benefit:'প্রাকৃতিক অ্যান্টাসিড, হাইড্রোক্লোরিক অ্যাসিড নিউট্রালাইজ' },
    powder: { name:'শতাব্দী-মুলেঠি-আমলকী চূর্ণ', dose:'½ চা চামচ খাওয়ার আগে পানিতে', benefit:'পাকস্থলীর আস্তরণ রক্ষা করে, অ্যাসিড কমায়' },
    topping: { items:['বেসিল বীজ', 'মৌরি', 'ভুনা জিরা'], benefit:'পাকস্থলী শান্ত, গ্যাস কমায়, হজম সহায়ক' },
    benefits: ['পাকস্থলীর pH ব্যালেন্স', 'অ্যাসিড রিফ্লাক্স কমায়', 'পেটের জ্বালা উপশম', 'হজম উন্নত করে', 'গ্যাস নিরাময়'],
  },
};

// ──────────────────────────────────────────────────────────────────────
// SECTION 3 — 7 ESSENTIAL NUTRIENTS (per condition/disease combination)
// ──────────────────────────────────────────────────────────────────────
const BASE_NUTRIENTS = {
  DM: {
    nutrients: [
      { name:'ফাইবার',       target_g:30,  benefit:'রক্তে শর্করার শোষণ ধীর করে' },
      { name:'ম্যাগনেসিয়াম', target_mg:320, benefit:'ইনসুলিন সংবেদনশীলতা বৃদ্ধি' },
      { name:'ক্রোমিয়াম',   target_mcg:35, benefit:'গ্লুকোজ বিপাক নিয়ন্ত্রণ' },
      { name:'ভিটামিন-ডি',  target_iu:600, benefit:'ইনসুলিন নিঃসরণ সহায়তা' },
      { name:'ওমেগা-৩',      target_g:2,   benefit:'ইনফ্লেমেশন কমায়, হৃদয় রক্ষা' },
      { name:'প্রোটিন',      target_g:65,  benefit:'রক্তে শর্করা স্থিতিশীল রাখে' },
      { name:'জিঙ্ক',        target_mg:8,  benefit:'ইনসুলিন সংশ্লেষণ ও সঞ্চয়' },
    ],
    dv_targets: [
      { name:'ক্যালরি DV',   pct:80, note:'ডায়াবেটিসে কম ক্যালরি' },
      { name:'কার্ব DV',     pct:55, note:'Low-GI কার্ব, মোট কার্ব কম' },
      { name:'ফাইবার DV',    pct:120, note:'উচ্চ ফাইবার প্রয়োজন' },
      { name:'প্রোটিন DV',   pct:130, note:'গ্লুকোজ নিয়ন্ত্রণে উচ্চ প্রোটিন' },
      { name:'চর্বি DV',     pct:70,  note:'স্বাস্থ্যকর চর্বি সীমিত' },
    ],
  },
  OB: {
    nutrients: [
      { name:'প্রোটিন',      target_g:80,  benefit:'পেশি রক্ষা, তৃপ্তি বাড়ায়' },
      { name:'ফাইবার',       target_g:35,  benefit:'পেট ভরা রাখে, ক্যালরি কম' },
      { name:'ভিটামিন-ডি',  target_iu:800, benefit:'চর্বি বিপাক, হরমোন নিয়ন্ত্রণ' },
      { name:'আয়রন',        target_mg:18, benefit:'বিপাক সক্রিয় রাখে' },
      { name:'ক্যালসিয়াম',  target_mg:1000, benefit:'চর্বি শোষণ কমায়' },
      { name:'ভিটামিন-B12', target_mcg:2.4, benefit:'শক্তি বিপাক, নার্ভ স্বাস্থ্য' },
      { name:'ম্যাগনেসিয়াম', target_mg:320, benefit:'ইনসুলিন প্রতিরোধ কমায়' },
    ],
    dv_targets: [
      { name:'ক্যালরি DV',  pct:67,  note:'৩০-৩৫% ঘাটতি' },
      { name:'প্রোটিন DV',  pct:160, note:'উচ্চ প্রোটিন পেশি রক্ষায়' },
      { name:'ফাইবার DV',   pct:140, note:'সর্বোচ্চ ফাইবার' },
      { name:'কার্ব DV',    pct:54,  note:'কম কার্ব নীতি' },
      { name:'চর্বি DV',    pct:54,  note:'স্বাস্থ্যকর চর্বি সীমিত' },
    ],
  },
  FL: {
    nutrients: [
      { name:'ভিটামিন-ই',   target_mg:15, benefit:'লিভার কোষের অক্সিডেটিভ স্ট্রেস কমায়' },
      { name:'ভিটামিন-সি',  target_mg:90, benefit:'কোলাজেন তৈরি, লিভার ডিটক্স' },
      { name:'ওমেগা-৩',      target_g:2,  benefit:'লিভারের চর্বি কমায়' },
      { name:'ফোলেট',        target_mcg:400, benefit:'মেথাইলেশন, লিভার ফাংশন' },
      { name:'সেলেনিয়াম',   target_mcg:55, benefit:'গ্লুটাথিয়ন উৎপাদন, ডিটক্স' },
      { name:'কোলিন',        target_mg:425, benefit:'ফ্যাট মেটাবলিজম, লিভার থেকে চর্বি বের করে' },
      { name:'অ্যান্টিঅক্সিডেন্ট', target_note:'উচ্চ', benefit:'ALT/AST কমায়' },
    ],
    dv_targets: [
      { name:'ক্যালরি DV', pct:75, note:'মাঝারি ঘাটতি' },
      { name:'চর্বি DV',   pct:62, note:'লিভারে চর্বি কমাতে' },
      { name:'প্রোটিন DV', pct:130, note:'লিভার পুনর্জন্মে' },
      { name:'ফাইবার DV',  pct:112, note:'ডিটক্সিফিকেশনে' },
      { name:'কার্ব DV',   pct:64, note:'সরল চিনি কম' },
    ],
  },
  IB: {
    nutrients: [
      { name:'সলিউবল ফাইবার', target_g:10, benefit:'গাট ব্যাকটেরিয়া পুষ্টি সরবরাহ' },
      { name:'প্রোবায়োটিক',  target_note:'১০^৯ CFU', benefit:'গাট মাইক্রোবায়োম উন্নত' },
      { name:'ম্যাগনেসিয়াম', target_mg:300, benefit:'মসৃণ পেশির স্পাজম কমায়' },
      { name:'ভিটামিন-ডি',   target_iu:600, benefit:'অন্ত্রের প্রদাহ কমায়' },
      { name:'জিঙ্ক',         target_mg:8,  benefit:'অন্ত্রের আস্তরণ মেরামত' },
      { name:'ওমেগা-৩',       target_g:1.5, benefit:'অন্ত্রের প্রদাহ কমায়' },
      { name:'L-গ্লুটামিন',  target_note:'খাদ্য উৎস', benefit:'গাট লাইনিং মেরামত' },
    ],
    dv_targets: [
      { name:'ক্যালরি DV',       pct:78,  note:'মাঝারি, সহজপাচ্য' },
      { name:'সলিউবল ফাইবার DV', pct:100, note:'শুধু সলিউবল ফাইবার' },
      { name:'প্রোটিন DV',       pct:110, note:'সহজপাচ্য প্রোটিন' },
      { name:'চর্বি DV',          pct:77,  note:'স্বাস্থ্যকর চর্বি' },
      { name:'কার্ব DV',          pct:77,  note:'Low-FODMAP কার্ব' },
    ],
  },
  PR: {
    nutrients: [
      { name:'ফোলেট',      target_mcg:600, benefit:'নিউরাল টিউব ত্রুটি প্রতিরোধ' },
      { name:'আয়রন',      target_mg:27,   benefit:'মাতৃ ও ভ্রূণের রক্ত তৈরি' },
      { name:'ক্যালসিয়াম', target_mg:1300, benefit:'ভ্রূণের হাড় ও দাঁত গঠন' },
      { name:'ডিএইচএ',    target_mg:200,  benefit:'ভ্রূণের মস্তিষ্ক ও চোখ বিকাশ' },
      { name:'ভিটামিন-ডি', target_iu:600,  benefit:'ক্যালসিয়াম শোষণ, ভ্রূণের হাড়' },
      { name:'আয়োডিন',   target_mcg:220, benefit:'থাইরয়েড, ভ্রূণের মস্তিষ্ক' },
      { name:'প্রোটিন',   target_g:75,    benefit:'ভ্রূণের সকল অঙ্গ গঠন' },
    ],
    dv_targets: [
      { name:'ক্যালরি DV',  pct:93,  note:'+৩০০ kcal প্রয়োজন' },
      { name:'ফোলেট DV',   pct:150, note:'দ্বিগুণ ফোলেট প্রয়োজন' },
      { name:'আয়রন DV',   pct:150, note:'১.৫ গুণ আয়রন প্রয়োজন' },
      { name:'ক্যালসিয়াম DV', pct:130, note:'ভ্রূণের হাড়ের জন্য' },
      { name:'প্রোটিন DV', pct:150, note:'ভ্রূণ বিকাশে উচ্চ প্রোটিন' },
    ],
  },
};

// ──────────────────────────────────────────────────────────────────────
// SECTION 4 — MAIN RULE ENGINE FUNCTION
// Input: customer (from customers table), metrics (from customer_metrics)
// Output: complete rule engine result for ai_analysis table
// ──────────────────────────────────────────────────────────────────────
function runFullRuleEngine(cust, m) {

  // 1. Disease category
  const cat = pickCategory(m);
  const disease = DISEASE_PROFILES[cat];

  // 2. BMI
  const bmi = +m.bmi || calcBmi(m);

  // 3. Detect ALL active conditions
  const conditions = detectConditions(m);

  // 4. Calculate calories (scientific)
  const { targetKcal, multiplier, calorieReason } = calcCalories(disease, bmi, conditions, m);

  // 5. Protein & fiber targets (cascade from conditions)
  const { targetProtein, targetFiber, targetCarb, targetFat } = calcMacros(disease, conditions, cat);

  // 6. Select ingredients (cascade from disease + top conditions)
  const ingredients = selectIngredients(disease, conditions, cat);

  // 7. Select plate elements (chutney, topping, powders)
  const plate = selectPlate(disease, conditions);

  // 8. Build nutrition panel (7 nutrients)
  const nutrients = buildNutrients(cat, conditions, targetKcal, targetProtein, targetFiber);

  // 9. Build DV% (5 targets)
  const dvTargets = buildDV(cat, targetKcal, targetProtein, targetFiber, targetCarb, targetFat);

  // 10. Build benefits (5 categories)
  const benefits = buildBenefits(plate, conditions, cat);

  // 11. Health score
  const score = calcScore(bmi, m, conditions);

  // 12. Mini prompt for AI (10%) — tiny, no data dump
  const miniPrompt = buildMiniPrompt(cust, cat, score, conditions, m);

  // 13. Suggested meal
  const suggestedMeal = suggestMeal(cat, conditions);

  return {
    // Meta
    cat, cat_bn: disease.name_bn, bmi, score,
    conditions, condition_count: conditions.length,

    // Calorie
    targetKcal, multiplier, calorieReason,

    // Macros
    targetProtein, targetFiber, targetCarb, targetFat,

    // Ingredients
    ingredients,

    // Plate
    disease_chutney: plate.disease_chutney,
    condition_chutney: plate.condition_chutney,
    final_chutney: plate.final_chutney,
    disease_powder_1: plate.disease_powder_1,
    disease_powder_2: plate.disease_powder_2,
    condition_powder: plate.condition_powder,
    disease_topping: plate.disease_topping,
    condition_topping: plate.condition_topping,
    final_topping: plate.final_topping,

    // Nutrition
    nutrients,   // 7 essential nutrients
    dvTargets,   // 5 daily value targets

    // Benefits (5 categories)
    benefits,

    // For AI
    miniPrompt,
    suggestedMeal,
  };
}

// ── Helper: detect active conditions ──────────────────────────────────
function detectConditions(m) {
  const active = [];
  if (m.today_fever)                                  active.push('fever');
  if (m.today_cold_cough)                             active.push('cold_cough');
  if ((+m.today_stress_level || 0) >= 7)              active.push('stress');
  if (m.today_period_active)                          active.push('menstruation');
  if (m.today_headache)                               active.push('headache');
  if (m.today_migraine)                               active.push('migraine');
  if (m.today_fatigue || m.today_mood === '😴 ক্লান্ত') active.push('fatigue');
  if (m.today_weakness)                               active.push('weakness');
  if (m.today_loose_motion)                           active.push('loose_motion');
  if (m.today_diarrhea)                               active.push('diarrhea');
  if (m.today_dysentery)                              active.push('dysentery');
  if (m.today_journey)                                active.push('journey');
  if (m.today_sleep_disorder || (+m.today_sleep_hours||7) < 5) active.push('sleep_disorder');
  if (m.today_depression || m.today_mood === '😔 খারাপ') active.push('depression');
  if (m.today_constipation)                           active.push('constipation');
  if (m.today_acidity || m.today_stomach_upset)       active.push('acidity');
  return active;
}

// ── Helper: calorie calculation ────────────────────────────────────────
function calcCalories(disease, bmi, conditions, m) {
  let base = disease.base_kcal;

  // BMI adjustment
  if (bmi >= 30)       base = Math.min(base, 1300);
  else if (bmi >= 27)  base = Math.round(base * 0.92);
  else if (bmi < 18.5) base = Math.round(base * 1.10);

  // Condition multipliers (scientific, additive but capped)
  let totalEffect = 0;
  const reasons = [];

  // PRIORITY ORDER: Severe conditions override others
  // Dysentery/Diarrhea most restrictive
  if (conditions.includes('dysentery'))   { totalEffect -= 0.18; reasons.push('আমাশয়: হালকা −18%'); }
  else if (conditions.includes('diarrhea')) { totalEffect -= 0.20; reasons.push('ডায়রিয়া: হালকা −20%'); }
  else if (conditions.includes('loose_motion')) { totalEffect -= 0.15; reasons.push('পাতলা পায়খানা −15%'); }

  // Fever reduces (NET effect — digestion weak)
  if (conditions.includes('fever'))       { totalEffect -= 0.12; reasons.push('জ্বর: হালকা খাবার −12%'); }

  // Pregnancy increases
  if (conditions.includes('menstruation')) { totalEffect += 0.12; reasons.push('মাসিক: +12%'); }
  if (disease.name_bn === 'গর্ভাবস্থা')    { totalEffect += 0.10; reasons.push('গর্ভাবস্থা: +10%'); }

  // Weakness, fatigue increase
  if (conditions.includes('weakness'))    { totalEffect += 0.15; reasons.push('দুর্বলতা: +15%'); }
  if (conditions.includes('fatigue'))     { totalEffect += 0.10; reasons.push('ক্লান্তি: +10%'); }

  // Nausea/acidity/journey reduce
  if (conditions.includes('acidity'))     { totalEffect -= 0.05; reasons.push('এসিডিটি: −5%'); }
  if (conditions.includes('journey'))     { totalEffect += 0.05; reasons.push('ভ্রমণ: +5%'); }

  // Sleep
  if (conditions.includes('sleep_disorder')) { totalEffect += 0.05; reasons.push('ঘুমের সমস্যা: +5%'); }
  if (conditions.includes('depression'))  { totalEffect += 0.08; reasons.push('বিষণ্নতা: +8%'); }

  // Activity
  const act = String(m.activity_level || '');
  if (/high|active|বেশি/i.test(act)) { totalEffect += 0.08; reasons.push('সক্রিয় জীবনযাপন: +8%'); }
  if (/low|কম|sedentary/i.test(act)) { totalEffect -= 0.08; reasons.push('নিষ্ক্রিয় জীবনযাপন: −8%'); }

  // Cap total effect
  totalEffect = Math.max(-0.35, Math.min(+0.30, totalEffect));
  const multiplier = 1 + totalEffect;
  const targetKcal = Math.round((base * multiplier) / 10) * 10;
  const calorieReason = reasons.length ? reasons.join('; ') : 'রোগ-বিভাগ অনুযায়ী স্বাভাবিক';

  return { targetKcal, multiplier: +multiplier.toFixed(3), calorieReason };
}

// ── Helper: macro targets ──────────────────────────────────────────────
function calcMacros(disease, conditions, cat) {
  let protein = disease.base_protein;
  let fiber   = disease.base_fiber;
  let carb    = disease.base_carb;
  let fat     = disease.base_fat;

  if (conditions.includes('weakness'))     protein += 15;
  if (conditions.includes('fever'))        { protein += 5; carb -= 30; }
  if (conditions.includes('menstruation')) protein += 5;
  if (conditions.includes('diarrhea') || conditions.includes('loose_motion')) {
    fiber -= 10; carb -= 20;
  }
  if (conditions.includes('constipation')) fiber += 8;
  if (conditions.includes('stress'))       carb -= 20;

  return {
    targetProtein: Math.max(40, protein),
    targetFiber:   Math.max(10, Math.min(40, fiber)),
    targetCarb:    Math.max(80, carb),
    targetFat:     Math.max(25, fat),
  };
}

// ── Helper: ingredient selection ──────────────────────────────────────
function selectIngredients(disease, conditions, cat) {
  const base = { ...disease.ingredients };
  const add  = [];
  const remove = [];

  conditions.forEach(c => {
    const cp = CONDITION_PROFILES[c];
    if (!cp) return;
    if (cp.add_ingredients)    add.push(...cp.add_ingredients);
    if (cp.remove_ingredients) remove.push(...cp.remove_ingredients);
  });

  // Add condition-specific ingredients (max 3 per condition)
  const addUniq = [...new Set(add)].slice(0, 6);
  const finalGrain   = base.grain   ? [base.grain[0], ...(addUniq.filter(i=>i.includes('চাল')||i.includes('ওটস')))] : [];
  const finalProtein = base.protein ? [base.protein[0], base.protein[1]] : [];
  const finalVeg     = base.veg     ? [base.veg[0], base.veg[1]] : [];
  const finalLeafy   = base.leafy   ? [base.leafy[0]] : [];
  const finalSeed    = base.seed    ? [base.seed[0]] : [];
  const finalExtra   = addUniq.filter(i => !remove.some(r => i.includes(r.slice(0,4)))).slice(0, 4);

  return {
    grain:   finalGrain.slice(0,2).join(' + ') || base.grain?.[0],
    protein: finalProtein.join(' + ') || base.protein?.[0],
    veg:     finalVeg.join(' + ') || base.veg?.[0],
    leafy:   finalLeafy.join(' + ') || base.leafy?.[0],
    seed:    finalSeed.join(' + ') || base.seed?.[0],
    extra:   finalExtra.join(', '),
    removed: remove.slice(0, 3).join(', '),
  };
}

// ── Helper: plate selection ────────────────────────────────────────────
function selectPlate(disease, conditions) {
  // Disease-level (always present)
  const dc = disease.disease_chutney;
  const dt = disease.disease_topping;
  const dp1 = disease.disease_powder_1;
  const dp2 = disease.disease_powder_2;

  // Top condition (highest priority)
  const PRIORITY = ['dysentery','diarrhea','loose_motion','fever','menstruation','weakness','migraine','depression','sleep_disorder'];
  const topCond = PRIORITY.find(p => conditions.includes(p)) || conditions[0];
  const cp = topCond ? CONDITION_PROFILES[topCond] : null;

  // Final: if condition exists, blend; else use disease
  const finalChutney = cp
    ? `${dc.name} বা ${cp.chutney.name} (অবস্থা অনুযায়ী)`
    : dc.name;

  const finalTopping = cp
    ? [...dt.items.slice(0,2), ...cp.topping.items.slice(0,2)]
    : dt.items;

  return {
    disease_chutney:   dc,
    condition_chutney: cp?.chutney || null,
    final_chutney:     finalChutney,
    disease_powder_1:  dp1,
    disease_powder_2:  dp2,
    condition_powder:  cp?.powder || null,
    disease_topping:   dt,
    condition_topping: cp?.topping || null,
    final_topping:     [...new Set(finalTopping)].slice(0, 5).join(' + '),
  };
}

// ── Helper: 7 nutrients ────────────────────────────────────────────────
function buildNutrients(cat, conditions, kcal, protein, fiber) {
  const base = BASE_NUTRIENTS[cat]?.nutrients || BASE_NUTRIENTS.DM.nutrients;
  const result = [...base];

  // Condition-specific nutrient boosts
  if (conditions.includes('menstruation')) {
    const iron = result.find(n => n.name.includes('আয়রন'));
    if (iron) iron.target_mg = 27; else result.push({ name:'আয়রন', target_mg:27, benefit:'মাসিকে আয়রন ক্ষতিপূরণ' });
  }
  if (conditions.includes('stress') || conditions.includes('depression')) {
    result.push({ name:'ম্যাগনেসিয়াম (বর্ধিত)', target_mg:400, benefit:'কর্টিসল কমায়, সেরোটোনিন বাড়ায়' });
  }
  if (conditions.includes('fever') || conditions.includes('cold_cough')) {
    result.push({ name:'ভিটামিন-সি (বর্ধিত)', target_mg:200, benefit:'ইমিউন সিস্টেম সক্রিয় করে' });
  }

  return result.slice(0, 7).map((n, i) => ({ rank: i+1, ...n }));
}

// ── Helper: 5 DV% ──────────────────────────────────────────────────────
function buildDV(cat, kcal, protein, fiber, carb, fat) {
  const base = BASE_NUTRIENTS[cat]?.dv_targets || BASE_NUTRIENTS.DM.dv_targets;
  const DAILY = { kcal:2000, protein:50, fiber:25, carb:260, fat:65 };
  return [
    { name:'ক্যালরি', daily_value:2000, today_target:kcal, pct:Math.round(kcal/DAILY.kcal*100), note:base[0]?.note||'' },
    { name:'প্রোটিন', daily_value:50,   today_target:protein, pct:Math.round(protein/DAILY.protein*100), note:base[1]?.note||'' },
    { name:'ফাইবার',  daily_value:25,   today_target:fiber,   pct:Math.round(fiber/DAILY.fiber*100),   note:base[2]?.note||'' },
    { name:'কার্বোহাইড্রেট', daily_value:260, today_target:carb, pct:Math.round(carb/DAILY.carb*100), note:base[3]?.note||'' },
    { name:'চর্বি',   daily_value:65,   today_target:fat,     pct:Math.round(fat/DAILY.fat*100),     note:base[4]?.note||'' },
  ];
}

// ── Helper: 5-category benefits ────────────────────────────────────────
function buildBenefits(plate, conditions, cat) {
  const topCond = conditions[0] ? CONDITION_PROFILES[conditions[0]] : null;
  return {
    meal_overall:    `থেরাপিউটিক ${DISEASE_PROFILES[cat].name_bn} মিল — ${DISEASE_PROFILES[cat].calorie_logic}`,
    ingredients_bn:  topCond ? topCond.benefits.join(' | ') : 'রোগ-নিয়ন্ত্রণে সর্বোত্তম উপাদান নির্বাচন',
    chutney_bn:      plate.disease_chutney.benefit + (plate.condition_chutney ? ' | ' + plate.condition_chutney.benefit : ''),
    disease_powder_bn: plate.disease_powder_1.benefit + ' | ' + plate.disease_powder_2.benefit,
    topping_bn:      plate.disease_topping.benefit + (plate.condition_topping ? ' | ' + plate.condition_topping.benefit : ''),
  };
}

// ── Helper: health score ───────────────────────────────────────────────
function calcScore(bmi, m, conditions) {
  let score = 75;
  if (bmi >= 18.5 && bmi < 25) score += 8;
  else if (bmi >= 30) score -= 12;
  else if (bmi < 18.5) score -= 6;

  const sleep  = +m.today_sleep_hours || 7;
  const stress = +m.today_stress_level || 5;
  const water  = +m.today_water_intake || 2;

  score += sleep >= 7 ? 5 : sleep < 5 ? -8 : 0;
  score += Math.round((6 - stress) * 1.5);
  score += water >= 2 ? 3 : -3;

  // Condition penalties
  const PENALTY = { fever:-15, dysentery:-18, diarrhea:-15, loose_motion:-10,
    migraine:-12, weakness:-10, depression:-8, menstruation:-5, headache:-6,
    cold_cough:-5, stress:-5, fatigue:-7, sleep_disorder:-6,
    constipation:-4, acidity:-4, journey:0 };
  conditions.forEach(c => { score += PENALTY[c] || 0; });

  return Math.max(30, Math.min(98, score));
}

// ── Helper: mini prompt (10% AI) ──────────────────────────────────────
function buildMiniPrompt(cust, cat, score, conditions, m) {
  const cname = cust.full_name || 'SAR সদস্যা';
  const cond_bn = conditions.map(c => CONDITION_PROFILES[c]?.name_bn || c).join(', ') || 'স্বাভাবিক';
  return `SAR মহিলা স্বাস্থ্য প্ল্যাটফর্মের জন্য ব্যক্তিগত বাংলা রিপোর্ট লেখো।
রোগী: ${cname}, রোগ: ${DISEASE_PROFILES[cat].name_bn}, স্কোর: ${score}/100
আজকের অবস্থা: ${cond_bn}, মুড: ${m.today_mood||'জানা নেই'}, ঘুম: ${m.today_sleep_hours||7}ঘণ্টা, স্ট্রেস: ${m.today_stress_level||5}/10
শুধু JSON ফেরত দাও — markdown নয়:
{"problems":"(২ লাইন)","cautions":"(২ লাইন)","home_remedy":"(৩টি উপায়)","ayurvedic":"(২টি পরামর্শ)","islamic":"(দোয়া+হাদিস)","meditation":"(১টি পদ্ধতি)","exercise":"(আজকের জন্য)","dos":"(৩টি করণীয়)","donts":"(৩টি বর্জনীয়)","general":"(১ লাইন)","meal_rx":"(মিল সারাংশ)"}`;
}

// ── Helper: meal suggestion ────────────────────────────────────────────
function suggestMeal(cat, conditions) {
  const names = {
    DM: 'ডায়াবেটিক থেরাপিউটিক বাটি',
    OB: 'লো-ক্যাল ডিটক্স বাটি',
    FL: 'লিভার ডিটক্স বাটি',
    IB: 'গাট হিলিং বাটি',
    PR: 'মাতৃত্ব পুষ্টি বাটি',
  };
  let name = names[cat] || names.DM;
  if (conditions.includes('fever'))        name = 'জ্বর-পুনরুদ্ধার হালকা মিল';
  if (conditions.includes('diarrhea') || conditions.includes('dysentery')) name = 'BRAT থেরাপিউটিক মিল';
  if (conditions.includes('menstruation')) name = 'আয়রন-ফোলেট পুনরুদ্ধার মিল';
  if (conditions.includes('weakness'))     name = 'শক্তি পুনরুদ্ধার মিল';
  if (conditions.includes('migraine'))     name = 'মাইগ্রেন-সেফ থেরাপিউটিক মিল';
  return { name, cat };
}

// ── Utility helpers ───────────────────────────────────────────────────
function pickCategory(m) {
  if (m.sar_category_interest) return m.sar_category_interest;
  if (m.pregnancy_status && m.pregnancy_status !== 'না') return 'PR';
  if (m.diabetes_type    && m.diabetes_type    !== 'না') return 'DM';
  if (m.fatty_liver_grade && m.fatty_liver_grade !== 'না') return 'FL';
  if (m.ibs_type         && m.ibs_type         !== 'না') return 'IB';
  if (+m.bmi >= 25) return 'OB';
  return 'DM';
}
function calcBmi(m) {
  const w = +m.weight_kg || +m.today_weight_kg;
  const h = +m.height_cm;
  return (w && h) ? +(w / ((h/100)**2)).toFixed(1) : 23;
}

// ── EXPORTS ───────────────────────────────────────────────────────────
module.exports = {
  runFullRuleEngine,
  DISEASE_PROFILES,
  CONDITION_PROFILES,
  BASE_NUTRIENTS,
  detectConditions,
};
