# AGENTS.md

## Cursor Cloud specific instructions

### What this project is
SAR ("She AI Revolution" / She AI Restaurant) is a **static multi-page PWA** (flat `*.html` files in the repo root, plus `angeli-widget.js`, `service-worker.js`, `manifest.json`) served alongside **Netlify serverless functions** in `netlify/functions/`. There is **no build step, no automated test suite, and no lint config**.

### Running the app (development)
- Run with the Netlify CLI dev server from the repo root: `npx netlify dev --offline` (serves on `http://localhost:8888`). `--offline` avoids the Netlify account/site prompt — required here since the VM is not logged in to Netlify.
- `netlify-cli` is a **local devDependency** (installed by `npm install`). Invoke it via `npx netlify` or `./node_modules/.bin/netlify`; there is no global install.
- `netlify dev` serves the static HTML from the repo root and the functions at `http://localhost:8888/.netlify/functions/<name>`. Most functions expose a `GET` status endpoint (e.g. `GET /.netlify/functions/sar`) that reports which env vars are `set` vs `MISSING` without leaking values.

### Backend / data (important)
- The frontend talks **directly to a hosted Supabase project** (`https://xlkrggspepnysbouatec.supabase.co`) using an **anon key hardcoded in the HTML pages**. So login, the menu, metrics reads, and account creation work against live Supabase **without any local secrets** — the VM just needs outbound internet.
- The Netlify functions (`sar`, `payment`, `send-otp`, `angeli`, `analyze`, `daily-report`, etc.) are a secure proxy and need server-only secrets that are **not present in this environment**: `SUPABASE_SERVICE_KEY`, `CLAUDE_API_KEY`/`ANTHROPIC_API_KEY`, `SSLC_STORE_ID`/`SSLC_STORE_PWD`, `SMS_API_KEY`, `RESEND_API_KEY`, `TWILIO_*`, `OPENWEATHER_API_KEY`. Without them those endpoints return `MISSING`/errors, but **core frontend flows still work** because they bypass the functions.
- Gotcha: the **registration UI cannot be completed end-to-end** without secrets — step 2 of `register.html` requires phone OTP verification via the `send-otp` function, which needs `SMS_API_KEY`. To exercise auth without that secret, seed a customer row via the Supabase REST API (the same `POST /rest/v1/customers` insert `register.html` uses with the anon key) and then log in via `login.html`. Passwords are stored as plain base64 of the password (`btoa`), not a real hash.

### No lint / test / build
There are no lint, test, or build commands defined (`package.json` has no `scripts`). Verification is manual via `netlify dev` + the browser.
