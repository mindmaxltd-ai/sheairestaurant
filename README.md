# SAR — Meal Score (সিকিউর সেটআপ)

ভোর ৬টার AI-চালিত দৈনিক মিল স্কোর পেজ। **কোনো key HTML-এ নেই** — সব Supabase + Claude কল Netlify Function দিয়ে যায়।

## ফাইল

```
your-repo/
├─ meal-score.html              ← পেজ (কোনো key নেই)
└─ netlify/
   └─ functions/
      └─ sar.js                 ← একমাত্র proxy; key এখানে env var থেকে আসে
```

দুটোই GitHub repo-তে রাখুন, Netlify অটো-ডিপ্লয় করবে। ফাংশন পাওয়া যাবে `/.netlify/functions/sar`-এ (HTML সেটাই কল করে)।

## Netlify environment variables (Site settings → Environment variables)

| নাম | মান |
|---|---|
| `SUPABASE_URL` | `https://xlkrggspepnysbouatec.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → **service_role** key (গোপন, শুধু সার্ভারে) |
| `CLAUDE_API_KEY` | আপনার Anthropic (Claude) key (ঐচ্ছিক — না দিলে built-in local ইঞ্জিন চলবে) |

> **service_role key কখনো HTML/GitHub-এ রাখবেন না।** এটা শুধু Netlify env var-এ থাকে, ব্রাউজারে কখনো যায় না। তাই RLS নিয়ে আলাদা দুশ্চিন্তার দরকার নেই — ব্রাউজার কখনো Supabase সরাসরি কল করছে না।

## কীভাবে কাজ করে (৪টি পয়েন্ট)

1. **কোর্স প্রতি ৳৮৫** — প্রতি বেলায় কমপক্ষে ২, সর্বোচ্চ ৪ কোর্স; সব দামে **৫% ভ্যাট**।
2. **রোগ-বিভাগ অটো-ডিটেক্ট** — `customer_metrics` থেকে: `sar_category_interest` → `pregnancy_status` → `diabetes_type` → `fatty_liver_grade` → `ibs_type` → BMI≥25 হলে স্থূলতা। উপরে ট্যাব দিয়ে নিজেও বদলানো যায় (টেস্টের জন্য)। আগে শুধু ডায়াবেটিস দেখাচ্ছিল কারণ metrics ফাঁকা থাকলে ডিফল্ট DM হতো — এখন ট্যাব আছে ও metrics ঠিক থাকলে OB/FL-এ যাবে।
3. **সব ডেটা Supabase-এ** — মেনু পড়ে `menu_items` থেকে, মেট্রিক্স `customer_metrics` থেকে, মিল স্কোর লেখে `ai_analysis`-এ, অর্ডার লেখে `orders` + `order_items`-এ (আগের স্কিমা; `items_json`, `total_amount`, `tax` কলাম ব্যবহার করেছে)।
4. **ব্যক্তিগত পরিমাণ** — BMI, মুড (stress), কার্যকলাপ, আবহাওয়া দিয়ে প্রতি বেলার kcal আলাদা; কার্ডে "🤖 আপনার জন্য +X kcal" দেখায়।

## কলাম নাম মিলিয়ে নিন

আপনার আসল টেবিলে কলাম নাম একটু আলাদা হলে `netlify/functions/sar.js`-এর ভেতর ঠিক করুন:
- `orders`: এখন `items_json`, `subtotal`, `tax`, `total_amount`, `status`, `order_type`, `payment_status`, `special_instructions` ব্যবহার করছে।
- `order_items`: `order_id`, `menu_item_id`, `menu_name_bn`, `quantity`, `unit_price`, `special_note`, `nutrition_json`।
- `ai_analysis`: `customer_id`, `analysis_type`, `category`, `meal_score`, `daily_kcal`, `daily_protein`, `focus`, `result_json` — এই কলামগুলো না থাকলে Supabase SQL Editor-এ যোগ করুন:

```sql
alter table ai_analysis
  add column if not exists analysis_type text,
  add column if not exists category      text,
  add column if not exists meal_score    int,
  add column if not exists daily_kcal    int,
  add column if not exists daily_protein int,
  add column if not exists focus         text,
  add column if not exists result_json   jsonb;
```

## লোকাল টেস্ট (ঐচ্ছিক)

```
npm i -g netlify-cli
netlify dev      # env var গুলো Netlify থেকে টেনে এনে localhost-এ চালায়
```

দ্রষ্টব্য: "মিল স্কোর" ও থেরাপিউটিক দাবি যেন চিকিৎসা পরামর্শ হিসেবে উপস্থাপিত না হয় — পেজে disclaimer আছে।
