/* ============================================================
   SAR — Universal Automatic Language Toggle System (v2)
   ------------------------------------------------------------
   HOW TO USE: add this ONE line to any page's <head>, nothing else:
     <script src="lang.js"></script>

   No data-i18n attributes, no per-page dictionaries, no HTML edits.
   This script scans every text node on the page itself, matches it
   against TEXT_MAP below, and swaps Bengali <-> English on toggle.
   A MutationObserver also catches text that gets added later by
   your own JS (e.g. dashboard cards that load after a fetch call).

   TO ADD MORE TRANSLATIONS: just add more "বাংলা": "English" lines
   inside TEXT_MAP below. Nothing else needs to change.
   ============================================================ */

(function () {
  const STORAGE_KEY = 'sar_lang'; // 'bn' | 'en'

  // ---- 1. The dictionary. Exact-match on trimmed text. ----
  const TEXT_MAP = {
    "লোড...": "Loading...",
    "লোড হচ্ছে...": "Loading...",
    "লোড হচ্ছে": "Loading",
    "লোড হচ্ছে…": "Loading…",
    "অর্ডার করুন": "Place Order",
    "৳ ০": "৳ 0",
    "ড্যাশবোর্ড": "Dashboard",
    "AI বিশ্লেষণ": "AI Analysis",
    "আমার প্রোফাইল": "My Profile",
    "সেবাসমূহ": "Services",
    "ট্র্যাক": "Track",
    "পেমেন্ট": "Payment",
    "আপডেট →": "Update →",
    "বিশ্লেষণ লোড হচ্ছে...": "Analysis loading...",
    "রিসিট দেখুন": "View Receipt",
    "← ড্যাশবোর্ড": "← Dashboard",
    "⚕️ গুরুত্বপূর্ণ আইনি ও স্বাস্থ্য দাবিত্যাগ": "⚕️ Important Legal & Health Disclaimer",
    "🇧🇩 বাংলা": "🇧🇩 Bangla",
    "সাধারণ সচেতনতা ও শিক্ষামূলক উদ্দেশ্যে": "For general awareness and educational purposes",
    "আপনার নিবন্ধিত চিকিৎসকের পরামর্শ নিন": "Please consult your registered physician",
    "SAR · সার": "SAR",
    "📊 ড্যাশবোর্ড": "📊 Dashboard",
    "কীভাবে কাজ করে": "How It Works",
    "ড্যাশবোর্ড — She AI Revolution - SAR": "Dashboard — She AI Revolution - SAR",
    "সদস্য আইডি:": "Member ID:",
    "পাসওয়ার্ড পরিবর্তন": "Change Password",
    "আজকের অবস্থা লিখুন": "Log Today's Status",
    "AI রিপোর্ট দেখুন": "View AI Report",
    "Basic সদস্য": "Basic Member",
    "স্বাগতম, আপা!": "Welcome, sister!",
    "আজকের তারিখ লোড হচ্ছে...": "Loading today's date...",
    "🥗 আজকের মেনু": "🥗 Today's Menu",
    "🛒 অর্ডার করুন": "🛒 Place Order",
    "আজকের মেনু": "Today's Menu",
    "মেট্রিক্স": "Metrics",
    "রিসিট": "Receipt",
    "আজকের অবস্থা": "Today's Status",
    "AI রিপোর্ট": "AI Report",
    "ডাক্তার": "Doctor",
    "SAR-কে লিখুন": "Write to SAR",
    "প্রোফাইল": "Profile",
    "পাসওয়ার্ড": "Password",
    "লগআউট": "Log Out",
    "স্বাস্থ্য স্কোর": "Health Score",
    "/১০০": "/100",
    "মোট অর্ডার": "Total Orders",
    "এ পর্যন্ত": "so far",
    "লয়্যালটি পয়েন্ট": "Loyalty Points",
    "সাবস্ক্রিপশন": "Subscription",
    "দিন বাকি": "days left",
    "হিমোগ্লোবিন g/dL": "Hemoglobin g/dL",
    "মাসিক চক্রের ফেজ": "Menstrual Cycle Phase",
    "তারিখ দিন...": "Enter date...",
    "📄 আজকের স্বাস্থ্য রিপোর্ট ✨": "📄 Today's Health Report ✨",
    "পূর্ণ রিপোর্ট দেখুন →": "View Full Report →",
    "SAR দৈনিক স্বাস্থ্য রিপোর্ট": "SAR Daily Health Report",
    "অনুগ্রহ করে অপেক্ষা করুন": "Please wait",
    "আজকের থেরাপিউটিক মেনু": "Today's Therapeutic Menu",
    "সব দেখুন →": "View All →",
    "মেনু লোড হচ্ছে...": "Menu loading...",
    "সাম্প্রতিক অর্ডার": "Recent Orders",
    "নতুন অর্ডার →": "New Order →",
    "অর্ডার লোড হচ্ছে...": "Orders loading...",
    "দ্রুত কাজ": "Quick Actions",
    "ট্র্যাক করুন": "Track",
    "মেট্রিক্স আপডেট": "Update Metrics",
    "মেনু দেখুন": "View Menu",
    "পেমেন্ট করুন": "Make Payment",
    "ডাক্তার পরামর্শ — AI + ২৫০ মেট্রিক্স বিশ্লেষণ ও প্রেসক্রিপশন": "Doctor Consultation — AI + 250 Metrics Analysis & Prescription",
    "মূল স্বাস্থ্য মেট্রিক্স": "Key Health Metrics",
    "রক্তচাপ": "Blood Pressure",
    "গ্লুকোজ": "Glucose",
    "হিমোগ্লোবিন": "Hemoglobin",
    "ভিটামিন ডি": "Vitamin D",
    "লয়্যালটি প্রোগ্রাম": "Loyalty Program",
    "সদস্যতার অবস্থা": "Membership Status",
    "পরিচালনা →": "Manage →",
    "SAR টিমের নোট": "Notes from SAR Team",
    "SAR টিম থেকে কোনো নোট নেই।": "No notes from the SAR team.",
    "— SAR AI • আজকের অনুপ্রেরণা": "— SAR AI • Today's Inspiration",
    "AI স্বাস্থ্য বিশ্লেষণ": "AI Health Analysis",
    "আপনার সম্পূর্ণ বিশ্লেষণ": "Your Complete Analysis",
    "👤 আমার প্রোফাইল": "👤 My Profile",
    "📊 মেট্রিক্স আপডেট করুন": "📊 Update Metrics",
    "🔑 পাসওয়ার্ড": "🔑 Password",
    "📝 আজকের স্বাস্থ্য আপডেট": "📝 Today's Health Update",
    "কণ্ঠে বলুন (বাংলায়)": "Speak (in Bangla)",
    "Click করুন তারপর বলুন — Chrome-এ কাজ করে": "Click then speak — works in Chrome",
    "💊 আজকের শারীরিক লক্ষণ": "💊 Today's Physical Symptoms",
    "🌡️ জ্বর": "🌡️ Fever",
    "🤧 সর্দি/কাশি": "🤧 Cold/Cough",
    "🤢 পেট খারাপ": "🤢 Upset Stomach",
    "💧 পাতলা পায়খানা": "💧 Diarrhea",
    "🤕 মাথাব্যথা": "🤕 Headache",
    "😣 শরীর ব্যথা": "😣 Body Ache",
    "তাপমাত্রা:": "Temperature:",
    "🌸 মাসিক চক্র": "🌸 Menstrual Cycle",
    "🌸 আজ মাসিক হয়েছে": "🌸 Period today",
    "😰 ব্যথা/cramping": "😰 Pain/cramping",
    "ব্যথার মাত্রা": "Pain Level",
    "🧠 মানসিক অবস্থা": "🧠 Mental State",
    "😊 ভালো": "😊 Good",
    "😐 মাঝারি": "😐 Moderate",
    "😔 খারাপ": "😔 Bad",
    "😰 দুশ্চিন্তায়": "😰 Anxious",
    "😡 রাগান্বিত": "😡 Angry",
    "😴 ক্লান্ত": "😴 Tired",
    "চাপের মাত্রা": "Stress Level",
    "🍽️ আজকের খাবার ও পানীয়": "🍽️ Today's Food & Drink",
    "☕ কফি (কাপ)": "☕ Coffee (cups)",
    "💧 পানি (লিটার)": "💧 Water (litres)",
    "😴 ঘুম ও বিবিধ": "😴 Sleep & Other",
    "ঘুম (ঘণ্টা)": "Sleep (hours)",
    "ঘুমের মান": "Sleep Quality",
    "ভালো": "Good",
    "মাঝারি": "Moderate",
    "খারাপ": "Bad",
    "🎤 কণ্ঠে": "🎤 By Voice",
    "💾 Save করুন": "💾 Save",
    "কণ্ঠে বলুন": "Speak",
    "Click করুন → বলুন → text হয়ে যাবে": "Click → speak → it becomes text",
    "বিষয়": "Subject",
    "সাধারণ মতামত": "General Feedback",
    "পরামর্শ": "Suggestion",
    "অভিযোগ": "Complaint",
    "প্রশংসা": "Praise",
    "নতুন আইডিয়া": "New Idea",
    "খাবারের মতামত": "Feedback on Food",
    "সেবার মতামত": "Feedback on Service",
    "আপনার বার্তা": "Your Message",
    "📨 পাঠান": "📨 Send",
    "📋 AI স্বাস্থ্য রিপোর্ট": "📋 AI Health Report",
    "রিপোর্ট লোড হচ্ছে...": "Report loading...",
    "শেষ ৭ দিনের রিপোর্ট · স্বয়ংক্রিয়ভাবে মুছে যায়": "Last 7 days' reports · auto-deleted",
    "🔄 রিফ্রেশ": "🔄 Refresh",
    "🔑 পাসওয়ার্ড পরিবর্তন": "🔑 Change Password",
    "বর্তমান পাসওয়ার্ড": "Current Password",
    "নতুন পাসওয়ার্ড": "New Password",
    "নতুন পাসওয়ার্ড নিশ্চিত করুন": "Confirm New Password",
    "🔑 পাসওয়ার্ড Set করুন": "🔑 Set Password",
    "📷 আমার ছবি": "📷 My Photo",
    "এখনো ছবি নেই — নিচে আপলোড করুন": "No photo yet — upload below",
    "📤 ছবি আপলোড / বদল করুন": "📤 Upload / Change Photo",
    "✨ সৌন্দর্য সমন্বয়": "✨ Beauty Adjustments",
    "উজ্জ্বলতা": "Brightness",
    "ত্বকের উষ্ণতা/টোন": "Skin Warmth/Tone",
    "মসৃণতা (soft glow)": "Smoothness (soft glow)",
    "ঠোঁটের আভা (লিপস্টিক)": "Lip Tint (lipstick)",
    "গালের আভা (blush)": "Cheek Tint (blush)",
    "রিসেট": "Reset",
    "✓ সংরক্ষণ": "✓ Save",
    "💡 ছবি শুধু আপনার এই ডিভাইসে থাকে, নিরাপদ।": "💡 Your photo stays only on this device, safely.",
    "SAR ডাক্তার পোর্টাল — AI + ২৫০ মেট্রিক্স বিশ্লেষণ": "SAR Doctor Portal — AI + 250 Metrics Analysis",
    "ডাক্তার পরামর্শ": "Doctor Consultation",
    "পরামর্শ ফি": "Consultation Fee",
    "৳৭৫০": "৳750",
    "✅ AI-সহায়ক ডাক্তার মূল্যায়ন": "✅ AI-assisted doctor evaluation",
    "✅ দিনে সর্বোচ্চ ৩টি প্রেসক্রিপশন": "✅ Up to 3 prescriptions per day",
    "✅ প্রেসক্রিপশন PDF — ড্যাশবোর্ডে সংরক্ষিত": "✅ Prescription PDF — saved to dashboard",
    "✅ BMDC নিবন্ধিত ডাক্তার দ্বারা যাচাইকৃত": "✅ Verified by BMDC-registered doctor",
    "৳৭৫০ দিয়ে পরামর্শ শুরু করুন →": "Start consultation for ৳750 →",
    "← ড্যাশবোর্ডে ফিরে যান": "← Back to Dashboard",
    "SAR ডাক্তার পোর্টাল": "SAR Doctor Portal",
    "👨‍⚕️ AI + ২৫০ মেট্রিক্স বিশ্লেষণ": "👨‍⚕️ AI + 250 Metrics Analysis",
    "গুরুত্বপূর্ণ বিজ্ঞপ্তি:": "Important Notice:",
    "আপনিই প্রেসক্রিপশনের দায়িত্বশীল ডাক্তার।": "You are the doctor responsible for the prescription.",
    "গ্রাহকের তথ্য লোড হচ্ছে...": "Loading customer information...",
    "সদস্য নং": "Member No.",
    "📊 স্বাস্থ্য মেট্রিক্স (২৫০)": "📊 Health Metrics (250)",
    "মেট্রিক্স লোড হচ্ছে...": "Metrics loading...",
    "📄 আমার প্রেসক্রিপশন (সর্বশেষ ৫টি)": "📄 My Prescriptions (last 5)",
    "💬 আজকের অভিযোগ": "💬 Today's Complaint",
    "🤖 AI বিশ্লেষণ ও প্রেসক্রিপশন তৈরি করুন": "🤖 Generate AI Analysis & Prescription",
    "🔬 AI মূল্যায়ন (Claude)": "🔬 AI Evaluation (Claude)",
    "বিশ্লেষণ": "Analysis",
    "🔍 কারিগরি বিবরণ দেখুন (Admin-এর জন্য)": "🔍 View Technical Details (for Admin)",
    "💊 প্রেসক্রিপশন (সম্পাদনযোগ্য)": "💊 Prescription (editable)",
    "বিভাগ": "Category",
    "ওষুধ (Generic)": "Medicine (Generic)",
    "নির্দেশনা": "Instructions",
    "+ আরও যোগ করুন": "+ Add More",
    "সাধারণ নির্দেশনা": "General Instructions",
    "ঘরোয়া প্রতিকার": "Home Remedies",
    "🌿 আয়ুর্বেদিক পরামর্শ": "🌿 Ayurvedic Advice",
    "🍯 ইউনানি পরামর্শ": "🍯 Unani Advice",
    "💊 হোমিওপ্যাথিক পরামর্শ": "💊 Homeopathic Advice",
    "☪️ ইসলামিক / আধ্যাত্মিক সহায়তা (কুরআন-হাদিস)": "☪️ Islamic / Spiritual Guidance (Quran-Hadith)",
    "⚠️ বিপদ সংকেত": "⚠️ Warning Signs",
    "🚨 জরুরি সতর্কতা": "🚨 Emergency Alert",
    "✍️ কাউন্টার-সাইন ও রিলিজ": "✍️ Countersign & Release",
    "ডাক্তারের নাম *": "Doctor's Name *",
    "BMDC রেজি. নং *": "BMDC Reg. No. *",
    "ডাক্তারের নোট": "Doctor's Notes",
    "📝 নিবন্ধন": "📝 Register",
    "🔐 লগইন": "🔐 Login",
    "💳 পেমেন্ট": "💳 Payment",
    "👩‍🍳 কিচেন": "👩‍🍳 Kitchen",
    "⚙️ অ্যাডমিন": "⚙️ Admin",
    "🍱 মেনু": "🍱 Menu",
    "প্রকৃতির নিরাময় · নারীর শক্তি": "Nature's Healing · Women's Power",
    "SAR সার": "SAR",
    "নারীর স্বাস্থ্য · ওয়েলনেস · ক্ষমতায়ন প্ল্যাটফর্ম": "Women's Health · Wellness · Empowerment Platform",
    "🌸 এখনই নিবন্ধন করুন": "🌸 Register Now",
    "🍱 মিল প্ল্যান দেখুন": "🍱 View Meal Plan",
    "🌿 অর্গানিক": "🌿 Organic",
    "🤖 AI ব্যক্তিগতকৃত": "🤖 AI Personalized",
    "🔗 ব্লকচেইন যাচাই": "🔗 Blockchain Verified",
    "আমাদের দর্শন": "Our Philosophy",
    "খাবারই ঔষধ, ঔষধই খাবার": "Food is Medicine, Medicine is Food",
    "সার — জীবনের মূল নির্যাস": "SAR — The Essence of Life",
    "বাংলায় \"সার\" মানে নির্যাস, সারমর্ম — যা কিছুর প্রাণ।": "In Bengali, \"SAR\" means essence — the soul of anything.",
    "কেন SAR আলাদা": "Why SAR is Different",
    "বিশুদ্ধতার অঙ্গীকার": "A Commitment to Purity",
    "প্রতিটি পরামর্শ নারীর শরীরকে আরোগ্য দেয়, ভার দেয় না।": "Every recommendation heals a woman's body, never burdens it.",
    "অর্গানিক ও বিশুদ্ধ": "Organic & Pure",
    "তেল, চিনি, লবণ ও কৃত্রিম রং-মুক্ত — প্রকৃতির বিশুদ্ধ পুষ্টি।": "Free of oil, sugar, salt and artificial colour — nature's pure nutrition.",
    "হালাল ও আয়ুর্বেদিক": "Halal & Ayurvedic",
    "গ্লুটেন-মুক্ত": "Gluten-Free",
    "সংবেদনশীল শরীরের জন্য নিরাপদ, সহজপাচ্য, পুষ্টিকর।": "Safe, easily digestible and nourishing for sensitive bodies.",
    "নারীদের জন্য, নারীদের দ্বারা": "For Women, By Women",
    "তিন ধাপে সুস্থতার পথ": "Wellness in Three Steps",
    "সহজ, ব্যক্তিগত, বিজ্ঞানসম্মত।": "Simple, personal, science-based.",
    "নিবন্ধন ও বিশ্লেষণ": "Register & Analyze",
    "ব্যক্তিগত মিল প্ল্যান": "Personal Meal Plan",
    "সুস্থতার যাত্রা": "The Wellness Journey",
    "আমাদের মিল প্ল্যান": "Our Meal Plans",
    "আজকের নিরাময়ী খাবার": "Today's Healing Meals",
    "সাকারা সালাদ": "Sakara Salad",
    "সবুজ পাতা · বাদাম · ভেষজ": "Greens · Nuts · Herbs",
    "পাওয়ার প্রিমাভেরা": "Power Primavera",
    "সবুজ সবজি · প্রোটিন": "Green Vegetables · Protein",
    "পিংক পেয়ার ট্রাইকলোর": "Pink Pear Tricolour",
    "নাশপাতি · কোহলরাবি": "Pear · Kohlrabi",
    "রোস্টেড ভেজিটেবল বোল": "Roasted Vegetable Bowl",
    "মসুর · ভাজা সবজি": "Lentils · Roasted Vegetables",
    "সামার সান সালাদ": "Summer Sun Salad",
    "কমলা · গাজর · কিনোয়া": "Orange · Carrot · Quinoa",
    "সুইট বিট": "Sweet Beet",
    "বিট · সবুজ পাতা · বাদাম": "Beet · Greens · Nuts",
    "ইতালিয়ান চপড সালাদ": "Italian Chopped Salad",
    "রঙিন সবজি · ছোলা": "Colourful Vegetables · Chickpeas",
    "সুপারফুড কুকি": "Superfood Cookie",
    "ওটস · বেরি · বাদাম": "Oats · Berries · Nuts",
    "🍱 সম্পূর্ণ মিল প্ল্যান দেখুন": "🍱 View Full Meal Plan",
    "প্রতিটি পাত একটি প্রতিশ্রুতি": "Every Plate Is a Promise",
    "রঙিন · বিশুদ্ধ · নিরাময়ী": "Colourful · Pure · Healing",
    "🍱 আমাদের মিল প্ল্যান দেখুন": "🍱 View Our Meal Plans",
    "আমাদের প্রভাব": "Our Impact",
    "সংখ্যায় বিপ্লব": "The Revolution in Numbers",
    "স্বাস্থ্য মেট্রিক বিশ্লেষণ": "Health Metrics Analyzed",
    "থেরাপিউটিক হিলিং রেসিপি": "Therapeutic Healing Recipes",
    "নিবন্ধিত নারী": "Registered Women",
    "AI ওয়েলনেস সহায়তা": "AI Wellness Support",
    "— She Ai Revolution · SAR সার": "— She Ai Revolution · SAR",
    "আমাদের লক্ষ্য": "Our Goal",
    "২০৩০-এর মধ্যে ১০ লাখ নারী": "1 Million Women by 2030",
    "প্রতি বছর — আরও বেশি নারীর জীবনে প্রকৃতির নিরাময়।": "Every year — nature's healing reaches more women's lives.",
    "১,০০০ নারী": "1,000 Women",
    "যাত্রা শুরু · বাংলাদেশ": "Journey begins · Bangladesh",
    "৫০,০০০ নারী": "50,000 Women",
    "সম্প্রসারণ ও বিশ্বাস": "Expansion & Trust",
    "২ লাখ নারী": "200,000 Women",
    "জাতীয় উপস্থিতি": "National Presence",
    "৫ লাখ নারী": "500,000 Women",
    "আঞ্চলিক নেতৃত্ব": "Regional Leadership",
    "১০ লাখ নারী": "1,000,000 Women",
    "🎯 মূল লক্ষ্য অর্জন": "🎯 Core Goal Achieved",
    "আপনার সুস্থতার যাত্রা শুরু হোক আজ": "Begin Your Wellness Journey Today",
    "প্রকৃতির নিরাময়, নারীর শক্তি — আপনার জন্য অপেক্ষা করছে।": "Nature's healing, women's power — waiting for you.",
    "🌸 এখনই যোগ দিন": "🌸 Join Now",
    "আবিষ্কার": "Discover",
    "SAR কী?": "What is SAR?",
    "কেন SAR?": "Why SAR?",
    "মিল প্ল্যান": "Meal Plans",
    "SAR-এর প্রভাব": "SAR's Impact",
    "২০৩০ লক্ষ্য": "2030 Goal",
    "আর্টিকেল ও আপডেট": "Articles & Updates",
    "নিবন্ধন করুন": "Register",
    "লগইন করুন": "Login",
    "স্বাস্থ্য মেট্রিক্স": "Health Metrics",
    "অর্ডার ট্র্যাক": "Track Order",
    "যোগাযোগ ও গ্রুপ": "Contact & Group",
    "KOTHA — পেডিয়াট্রিক AI": "KOTHA — Pediatric AI",
    "© ২০২৬ She Ai Revolution · SAR সার · MindMax Enterprises": "© 2026 She Ai Revolution · SAR · MindMax Enterprises",
    "আজকের AI মিল স্কোর — She AI Revolution (SAR)": "Today's AI Meal Score — She AI Revolution (SAR)",
    "সব রেসিপি": "All Recipes",
    "🛒 কার্ট": "🛒 Cart",
    "প্রতিদিন ভোর ৬টায় AI বিশ্লেষণ": "AI analysis every day at 6 AM",
    "আজকের জন্য": "For Today",
    "শুধু আপনার": "Just For You",
    "থেরাপিউটিক মেনু": "Therapeutic Menu",
    "মিল স্কোর": "Meal Score",
    "শুভ সকাল!": "Good Morning!",
    "আপনার আজকের প্ল্যান তৈরি হচ্ছে…": "Your plan for today is being prepared…",
    "আজ ভোর ৬:০০-এ আপডেট": "Updated today at 6:00 AM",
    "দৈনিক টার্গেট": "Daily Target",
    "প্রোটিন": "Protein",
    "আজকের ফোকাস": "Today's Focus",
    "মুড": "Mood",
    "আবহাওয়া": "Weather",
    "↻ এখনই পুনঃবিশ্লেষণ করুন": "↻ Re-analyze Now",
    "দুই রোগের মিল একসাথে মেশান": "Combine meals from two conditions",
    "— প্রতি মিশ্র মিলে অতিরিক্ত ভেষজ পাউডারের জন্য ২৫% যোগ হবে": "— 25% added per mixed meal for extra herbal powder",
    "আপনার": "Your",
    "৭ দিনের": "7-Day",
    "প্ল্যান": "Plan",
    "কীভাবে কাজ করে:": "How it works:",
    "তেলমুক্ত, চিনিমুক্ত, রংমুক্ত, অর্গানিক ও আয়ুর্বেদিক": "Oil-free, sugar-free, colour-free, organic and ayurvedic",
    "১০০-উপাদানের মাস্টার তালিকা": "100-Ingredient Master List",
    "এটি চিকিৎসা পরামর্শ নয়।": "This is not medical advice.",
    "আপনার অর্ডার": "Your Order",
    "কার্ট এখনও খালি।": "Your cart is empty.",
    "একটি মিলের \"কার্টে যোগ\" বা \"এখনই অর্ডার\" চাপুন।": "Tap \"Add to Cart\" or \"Order Now\" on a meal.",
    "সাবটোটাল": "Subtotal",
    "মিশ্রণ চার্জ (২৫%)": "Mixing Charge (25%)",
    "ভ্যাট (৫%)": "VAT (5%)",
    "সর্বমোট": "Grand Total",
    "Order নিশ্চিত করুন →": "Confirm Order →",
  };

  // ---- 2. Language get/set ----
  function getLang() {
    return localStorage.getItem(STORAGE_KEY) || 'bn';
  }

  function setLang(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.setAttribute('lang', lang);
    applyLang();
    window.dispatchEvent(new CustomEvent('sar:langchange', { detail: { lang } }));
  }

  function toggleLang() {
    setLang(getLang() === 'bn' ? 'en' : 'bn');
  }

  // t('বাংলা text') -> returns translated text if lang=en and a match exists,
  // otherwise returns the original text unchanged. Safe to call from any JS
  // (e.g. showToast(t('✓ কার্টে যোগ হয়েছে'))).
  function t(bnText) {
    if (typeof bnText !== 'string') return bnText;
    const key = bnText.trim();
    if (getLang() === 'en' && TEXT_MAP[key]) return TEXT_MAP[key];
    return bnText;
  }
  window.t = t;

  // ---- 3. Walk & translate all text nodes in <body> ----
  const originalText = new WeakMap(); // text node -> its original (Bengali) value
  const originalAttr = new WeakMap(); // element -> { placeholder, title, etc. }

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']);

  function collectTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  function translateTextNode(node, lang) {
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const original = originalText.get(node);
    const trimmed = original.trim();
    if (!trimmed) return;
    const startIdx = original.indexOf(trimmed);
    const leading = original.slice(0, startIdx);
    const trailing = original.slice(startIdx + trimmed.length);
    if (lang === 'en' && TEXT_MAP[trimmed]) {
      node.nodeValue = leading + TEXT_MAP[trimmed] + trailing;
    } else {
      node.nodeValue = original;
    }
  }

  const ATTRS_TO_TRANSLATE = ['placeholder', 'title', 'alt'];

  function translateAttrs(el, lang) {
    if (!originalAttr.has(el)) {
      const stored = {};
      ATTRS_TO_TRANSLATE.forEach((a) => {
        if (el.hasAttribute(a)) stored[a] = el.getAttribute(a);
      });
      originalAttr.set(el, stored);
    }
    const stored = originalAttr.get(el);
    Object.keys(stored).forEach((a) => {
      const orig = stored[a];
      const trimmed = orig.trim();
      if (lang === 'en' && TEXT_MAP[trimmed]) {
        el.setAttribute(a, TEXT_MAP[trimmed]);
      } else {
        el.setAttribute(a, orig);
      }
    });
  }

  function applyLang(root) {
    const lang = getLang();
    const scope = root || document.body;
    if (!scope) return;

    collectTextNodes(scope).forEach((node) => translateTextNode(node, lang));

    ATTRS_TO_TRANSLATE.forEach((attr) => {
      if (scope.querySelectorAll) {
        scope.querySelectorAll(`[${attr}]`).forEach((el) => translateAttrs(el, lang));
      }
    });
    if (scope.hasAttribute && ATTRS_TO_TRANSLATE.some((a) => scope.hasAttribute(a))) {
      translateAttrs(scope, lang);
    }

    document.querySelectorAll('.lang-toggle-btn').forEach((btn) => {
      btn.textContent = lang === 'bn' ? 'English' : 'বাংলা';
    });
  }

  // ---- 4. Catch content added later by page's own JS (fetch results etc.) ----
  let observerScheduled = false;
  let pendingRoots = [];
  function scheduleReapply(nodes) {
    pendingRoots.push(...nodes);
    if (observerScheduled) return;
    observerScheduled = true;
    setTimeout(() => {
      observerScheduled = false;
      const roots = pendingRoots;
      pendingRoots = [];
      roots.forEach((n) => {
        if (n.nodeType === 1) applyLang(n);
      });
    }, 60); // small debounce so bursts of DOM writes only trigger one pass
  }

  function startObserver() {
    const observer = new MutationObserver((mutations) => {
      const roots = [];
      mutations.forEach((m) => {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) roots.push(n);
        });
      });
      if (roots.length) scheduleReapply(roots);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ---- 5. Floating toggle button ----
  // Default position: bottom-left (clear of typical top-left logo / top-right nav).
  // Override per-page BEFORE loading lang.js:
  //   <script>window.SAR_LANG_BTN_STYLE = 'top:14px; left:14px;';</script>
  function injectToggleButton() {
    if (document.querySelector('.lang-toggle-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'lang-toggle-btn';
    btn.type = 'button';
    const posOverride = window.SAR_LANG_BTN_STYLE || 'bottom:18px; left:18px;';
    btn.style.cssText = `
      position:fixed; ${posOverride} z-index:9999;
      padding:.4rem 1rem; border-radius:50px; border:1px solid rgba(255,255,255,.2);
      background:rgba(10,10,20,.75); color:#fff; font-size:.78rem; font-weight:700;
      cursor:pointer; backdrop-filter:blur(10px);
    `;
    btn.addEventListener('click', toggleLang);
    document.body.appendChild(btn);
  }

  // ---- 6. Init ----
  function init() {
    document.documentElement.setAttribute('lang', getLang());
    injectToggleButton();
    applyLang();
    startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init(); // DOM already ready (script loaded late / dynamically)
  }

  window.SAR_LANG = { get: getLang, set: setLang, toggle: toggleLang, apply: applyLang, t };
})();
