# SAR — She AI Restaurant
## সম্পূর্ণ ডেপ্লয়মেন্ট গাইড | MindMax Enterprises

---

## ফাইল তালিকা

### HTML পেজ (Netlify)
| ফাইল | উদ্দেশ্য |
|------|---------|
| index.html | ল্যান্ডিং পেজ |
| login.html | লগইন |
| register.html | নিবন্ধন |
| dashboard.html | কাস্টমার ড্যাশবোর্ড |
| menu.html | SAR থেরাপিউটিক মেনু (১০৫ রেসিপি) |
| metrics.html | ২৫০ স্বাস্থ্য মেট্রিক্স ফর্ম |
| order.html | অর্ডার ম্যানেজমেন্ট |
| payment.html | পেমেন্ট (ShurjoPay) |
| receipt.html | রিসিট ও পুষ্টি তথ্য |
| track.html | অর্ডার ট্র্যাকিং |
| profile.html | প্রোফাইল সম্পাদনা |
| kitchen.html | কিচেন ডিসপ্লে (স্টাফ) |
| admin.html | অ্যাডমিন প্যানেল |
| sar-portal.html | SAR ক্লিনিক্যাল পোর্টাল |

### PWA ফাইল
| ফাইল | উদ্দেশ্য |
|------|---------|
| manifest.json | PWA ম্যানিফেস্ট |
| service-worker.js | অফলাইন সাপোর্ট, ক্যাশিং, পুশ নোটিফিকেশন |

### Supabase Edge Functions
| ফাংশন | উদ্দেশ্য |
|--------|---------|
| analyze-customer | Claude AI দিয়ে স্বাস্থ্য বিশ্লেষণ |
| send-whatsapp | Twilio WhatsApp মেসেজ |
| send-email | Resend ইমেইল |
| generate-receipt | রিসিট তৈরি ও সংরক্ষণ |
| daily-report | দৈনিক রিপোর্ট (pm 11:00 PM) |
| voice-to-order | ভয়েস অর্ডার পার্সিং |

---

## পরিবেশ পরিবর্তনশীল (Environment Variables)

### Netlify (Site Settings → Environment Variables)
```
SUPABASE_URL=https://xlkrggspepnysbouatec.supabase.co
SUPABASE_ANON_KEY=<anon key>
```

### Supabase Edge Functions (Project Settings → Secrets)
```
SUPABASE_URL=https://xlkrggspepnysbouatec.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
CLAUDE_API_KEY=<your Claude API key>
TWILIO_ACCOUNT_SID=<twilio SID>
TWILIO_AUTH_TOKEN=<twilio auth token>
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
RESEND_API_KEY=<resend API key>
```

---

## ডেপ্লয়মেন্ট স্টেপ

### ১. Netlify Deploy
```bash
# Netlify CLI ব্যবহার করুন
npm install -g netlify-cli
netlify login
netlify deploy --prod --dir=. --site=<site-id>
```

অথবা GitHub এর সাথে সংযুক্ত করুন:
1. GitHub রিপোতে পুশ করুন
2. Netlify → New site from Git
3. Build command: (কিছু নেই)
4. Publish directory: `.` (root)

### ২. PWA সক্রিয় করুন
প্রতিটি HTML পেজের `<head>`-এ যোগ করুন:
```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#E91E8C">
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .then(r => console.log('SW registered'))
      .catch(e => console.error('SW error:', e));
  }
</script>
```

### ৩. Supabase Edge Functions Deploy
```bash
# Supabase CLI ইনস্টল
npm install -g supabase

# লগইন
supabase login

# প্রজেক্ট লিঙ্ক
supabase link --project-ref xlkrggspepnysbouatec

# প্রতিটি ফাংশন ডেপ্লয়
supabase functions deploy analyze-customer
supabase functions deploy send-whatsapp
supabase functions deploy send-email
supabase functions deploy generate-receipt
supabase functions deploy daily-report
supabase functions deploy voice-to-order

# সিক্রেট সেট করুন
supabase secrets set CLAUDE_API_KEY=sk-ant-...
supabase secrets set TWILIO_ACCOUNT_SID=AC...
supabase secrets set TWILIO_AUTH_TOKEN=...
supabase secrets set RESEND_API_KEY=re_...
```

### ৪. দৈনিক রিপোর্ট Cron সেট করুন
Supabase SQL Editor-এ রান করুন:
```sql
SELECT cron.schedule(
  'sar-daily-report',
  '0 17 * * *',
  $$
    SELECT net.http_post(
      url := 'https://xlkrggspepnysbouatec.supabase.co/functions/v1/daily-report',
      headers := '{"Authorization": "Bearer SERVICE_ROLE_KEY", "Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    )
  $$
);
```

### ৫. PWA আইকন তৈরি
https://www.pwabuilder.com/imageGenerator এ যান এবং SAR লোগো আপলোড করে সব সাইজের আইকন ডাউনলোড করুন।
`icons/` ফোল্ডারে রাখুন।

---

## অ্যাডমিন লগইন
- URL: `/admin.html`
- ইউজার: `tutul`
- পাসওয়ার্ড: `aimthm@2008`

## SAR পোর্টাল লগইন
- URL: `/sar-portal.html`
- ডায়েটিশিয়ান: `sar_dietitian` / `sar2024`
- নিউট্রিশনিস্ট: `sar_nutrition` / `sar2024`

---

## যোগাযোগ
- ইমেইল: mindmaxltd@gmail.com
- ফোন: 01346098892
- ওয়েবসাইট: mindmaxbd.xyz

**MindMax Enterprises — Powering Bangladesh's AI Future 🚀**
