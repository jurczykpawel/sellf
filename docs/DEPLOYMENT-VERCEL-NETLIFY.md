**Language:** 🇬🇧 English · [🇵🇱 Polski](./pl/DEPLOYMENT-VERCEL-NETLIFY.md)

# Deploying Sellf to Vercel or Netlify (one-click)

Time required: **~15 minutes** if you already have GitHub, Supabase, Stripe, and Vercel/Netlify accounts. Add 5–10 minutes per account you need to create.

This guide covers the Vercel/Netlify "Deploy" buttons in the README. For VPS/PM2 deployment, see [DEPLOYMENT-MIKRUS.md](./DEPLOYMENT-MIKRUS.md). For self-hosted Docker, see [FULL-STACK.md](./FULL-STACK.md).

## What you'll have at the end

A live Sellf instance on `https://your-project.vercel.app` (or `.netlify.app`), connected to:
- **Supabase Free** — your database, auth, and storage (500 MB DB, 50k MAU)
- **Stripe test mode** — for processing fake payments (`4242 4242 4242 4242`)
- **Vercel Hobby** or **Netlify Starter** — your hosting (free for personal use)

To switch from test mode to live payments later, you replace `sk_test_…` / `pk_test_…` with `sk_live_…` / `pk_live_…` and create a new webhook on the live Stripe Dashboard.

## Free tier limits

| Service | Tier | Limits | Watch out for |
|---------|------|--------|---------------|
| Vercel Hobby | free | 100 GB bandwidth, 1M function invocations, 4h active CPU, 1M edge requests, 5k image transformations, 1 seat | **Personal, non-commercial use only.** Hard stops (no overages — site returns 503 once you hit a limit). Once your store is a commercial operation, upgrade to Vercel Pro ($20/mo). Full table in [QUICK-START.md](./QUICK-START.md#vercel-hobby-limits-the-free-tier-this-guide-uses). |
| Netlify Starter | free | 100 GB bandwidth, 300 build min/month, 125k function invocations | Plenty for small stores |
| Supabase Free | free | 500 MB DB, 1 GB storage, 50k MAU | Generous for years for a typical small store. Upgrade to Pro ($25/mo) when you approach the DB size or MAU limit, or want automated daily backups. |
| Stripe test mode | free | unlimited | No real money moves until you switch to `sk_live_…` |

---

## Step 1 — Generate four secrets locally (1 min)

Sellf refuses to start in production without these. Run this in your terminal:

```bash
echo "CHECKOUT_BINDING_SECRET=$(openssl rand -base64 32)"
echo "APP_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "LOGINWALL_SECRET=$(openssl rand -hex 32)"
```

Keep the output handy — you'll paste each value into the deploy form in Step 4.

> **Why these?** `CHECKOUT_BINDING_SECRET` signs the HMAC that ties a Stripe checkout session to a specific (user, product) pair, blocking metadata tampering. `APP_ENCRYPTION_KEY` encrypts the Stripe and GUS API keys you store in the admin panel. `LOGINWALL_SECRET` signs the handoff token for the per-product content gating snippet. They never need to change unless you suspect a leak.

## Step 2 — Create a Supabase project (3 min)

You have two paths here. Pick one:

### Path A — Vercel's Supabase integration (Vercel only, saves typing)

After clicking the Deploy button in Step 4 and finishing the deploy, open your project in the Vercel dashboard → **Storage → Connect Database → Supabase**. Vercel will create the Supabase project for you and inject the three env vars automatically (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — Sellf reads all of those names). You still need to grab the **project ref** + **database password** from the Supabase dashboard for Step 6.

If you take this path, skip the 4 env vars for Supabase in Step 4's form and leave them blank — Vercel fills them in after the integration is added.

### Path B — Create the project manually (works on Vercel and Netlify)

1. Go to **https://supabase.com/dashboard** and sign in (GitHub works).
2. Click **New project** → fill in:
   - **Name:** `sellf` (or anything)
   - **Database password:** click "Generate a password" and **save it in a password manager** — you'll need it for Step 6.
   - **Region:** pick one near your users (`eu-central-1` for EU, `us-east-1` for US)
   - **Plan:** Free
3. Wait ~2 minutes for provisioning to finish.
4. In **Settings → API**, copy these three values:
   - `Project URL` → `SUPABASE_URL`
   - `anon` `public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret — it bypasses RLS)
5. Note the **project ref** (the string after `/project/` in the URL, looks like `abcdefghijklmn`). You'll need it for Step 6.

## Step 3 — Create Stripe test API keys (2 min)

1. Go to **https://dashboard.stripe.com/test/apikeys** and sign in (or sign up — no bank account needed for test mode).
2. Make sure the **Test mode** toggle in the top-right is ON.
3. Copy:
   - **Publishable key** (`pk_test_…`) → `STRIPE_PUBLISHABLE_KEY`
   - **Secret key** (`sk_test_…`) → `STRIPE_SECRET_KEY` (click "Reveal" first)
4. Skip the webhook secret for now — you'll create it in Step 7 after the URL exists.

## Step 4 — Click the Deploy button (2 min)

From the [README](../README.md), click **Deploy with Vercel** or **Deploy to Netlify**.

You'll be asked to authorize the platform on your GitHub, choose a project name, and fill in environment variables. Paste:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | from Step 2 |
| `SUPABASE_ANON_KEY` | from Step 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | from Step 2 |
| `STRIPE_SECRET_KEY` | `sk_test_…` from Step 3 |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…` from Step 3 |
| `STRIPE_WEBHOOK_SECRET` | **placeholder** for now: `whsec_REPLACE_AFTER_DEPLOY_xxxxxxxxxxxxxxxxxxxxxxxxxxxx` (must be ≥16 chars or build won't accept it) |
| `SITE_URL` | **best guess** for now: `https://<your-project-name>.vercel.app` or `.netlify.app` — you'll fix it in Step 7 if wrong |
| `CHECKOUT_BINDING_SECRET` | from Step 1 |
| `TRUSTED_PROXY` | literally `true` |
| `APP_ENCRYPTION_KEY` | from Step 1 |
| `LOGINWALL_SECRET` | from Step 1 |

Click **Deploy**. Build takes 3–5 minutes.

> **Heads up:** When the build finishes, the deploy URL on Vercel/Netlify is shown but the app will return **500 errors** on every page. That's expected — the database is empty. Continue to Step 5.

## Step 5 — Note your deploy URL

Copy the URL Vercel/Netlify gives you. Examples:
- `https://sellf-abc123.vercel.app`
- `https://sellf.netlify.app`

You'll use it in Steps 6 and 7.

## Step 6 — Apply database migrations (3 min)

Sellf ships 46 migrations that create 36 tables, 73 RPC functions, and 92 RLS policies. The deploy button doesn't run them — you do, once, from your local machine.

```bash
# In a fresh terminal, anywhere:
git clone https://github.com/jurczykpawel/sellf.git
cd sellf

# Log in to Supabase (opens a browser):
npx supabase login

# Link this checkout to your project (use the project ref from Step 2):
npx supabase link --project-ref <YOUR_PROJECT_REF>
# It will ask for the database password from Step 2.

# Push migrations:
npx supabase db push
```

Expected output: `Applying migration ... done` for each of the 46 migrations. Total time ~1 minute.

> **If you don't want Supabase CLI on your machine:** open https://supabase.com/dashboard/project/<ref>/sql/new, then paste each `.sql` file from `supabase/migrations/` in chronological order and click **Run**. Much slower; CLI is recommended.

After migrations, refresh your deploy URL. The landing page should now load (no more 500). You'll see "Powered by Sellf" — that's your live store.

## Step 7 — Wire up the Stripe webhook (3 min)

1. Go to **https://dashboard.stripe.com/test/webhooks** and click **Add endpoint**.
2. **Endpoint URL:** `https://<YOUR_DEPLOY_URL>/api/webhooks/stripe`
3. **Events to send** — click **Select events** and tick at least:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.trial_will_end`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
4. Click **Add endpoint**.
5. On the endpoint detail page, click **Reveal** under "Signing secret" → copy the `whsec_…` value.
6. Update env vars in your hosting platform:
   - **Vercel:** Dashboard → your project → **Settings → Environment Variables** → edit `STRIPE_WEBHOOK_SECRET` → paste real value. While here, also fix `SITE_URL` to match your real deploy URL if you guessed wrong in Step 4.
   - **Netlify:** Dashboard → your site → **Site settings → Build & deploy → Environment** → same idea.
7. Redeploy: **Deployments** tab → latest deploy → **Redeploy**. ~1 minute.

## Step 8 — Smoke test (2 min)

1. Open `https://<your-deploy-url>/` — the Sellf landing page loads, no 500.
2. Click **Sign up** (or go to `/login`) → enter your email → submit.
3. Check your inbox. Supabase's default SMTP has a few-minute lag and goes to spam often. Click the magic link.
4. You should land on `/dashboard` as **admin** (Sellf makes the first registered user an admin via the `handle_new_user_registration()` trigger).
5. Go to **/admin/products** → **New product** → fill in a test product with `price = 5` USD → save.
6. Click the product slug to open the public page, then **Buy**. Use Stripe's test card: `4242 4242 4242 4242`, any future expiry, any CVC.
7. After payment, you should land on the success page, see the product in **/my-products**, and see the transaction in **/admin/payments**.

If all of that works — you're live. 🎉

---

## Troubleshooting

### Vercel: every page returns 404 right after deploy

If `/`, `/en`, `/api/health` all return `HTTP 404` with `x-vercel-error: NOT_FOUND`, the deploy succeeded but Vercel didn't auto-detect the project as Next.js. Confirm by going to your project's **Settings → Build & Deployment** in the Vercel dashboard — the "Framework Preset" should say `Next.js`. If it says `Other` or is blank, switch it to `Next.js` and redeploy.

(This happens when the project is created from the CLI with `--yes` rather than through the clone URL. The clone URL handles framework detection automatically; CLI sometimes doesn't.)

### Vercel: every page returns 401 with a Vercel SSO login

You're hitting **Vercel Authentication** (formerly "Deployment Protection"), which is on by default for new Hobby-tier projects and blocks anonymous traffic to all `*.vercel.app` URLs. Disable it in **Settings → Deployment Protection → Vercel Authentication → Disabled** (or via CLI: `vercel project protection disable <name> --sso`).

The clone URL flow doesn't enable this for production aliases — but if you create the project via CLI, you'll need to toggle it off explicitly.

### Netlify + Next.js 16

`@netlify/plugin-nextjs@5.15.11` doesn't declare a peer dependency on Next.js, so it's unclear from the manifest whether Next 16 is supported. **Verified to work in practice** (2026-05-26): a clean Netlify deploy of Sellf builds in ~55 seconds and serves all routes correctly. No special configuration needed beyond what's in `netlify.toml`.

If a future Sellf release upgrades Next.js and the plugin breaks, the failure mode is typically a build error referencing missing exports from `next/server` or similar. Either downgrade Sellf temporarily or switch to Vercel until the plugin catches up.

### App crashes immediately after deploy with "Refusing to start: CHECKOUT_BINDING_SECRET is not set"

You skipped Step 1 or left the field blank. Generate the secret and add it via Vercel/Netlify env vars, then redeploy.

### App crashes with "Refusing to start: TRUSTED_PROXY is not 'true'"

Set `TRUSTED_PROXY` to literally `true` (lowercase, no quotes). Vercel and Netlify are both reverse proxies, so this is mandatory.

### Every page shows 500 after Step 4

Step 6 (migrations) not done yet. The app is up but the database is empty. Run `npx supabase db push`.

### Stripe webhook events show "400 Bad Request" in Stripe Dashboard

The `STRIPE_WEBHOOK_SECRET` env var doesn't match the secret on the live webhook endpoint. Re-copy the value from the Stripe Dashboard and update the env var, then redeploy.

### Magic links never arrive in inbox

Supabase free tier uses a low-priority SMTP relay. Two fixes:
- Check spam folder (Gmail aggressively filters)
- In Supabase Dashboard → **Authentication → Email Templates** configure your own SMTP (Resend, SendGrid, Postmark) — recommended for production anyway

### Supabase project pauses after a week

Free tier behavior. Options:
- Upgrade to **Supabase Pro** ($25/month) — recommended if Sellf has live customers
- Keep traffic flowing — a daily ping to any endpoint counts as activity
- Self-host Supabase on your own infrastructure ([FULL-STACK.md](./FULL-STACK.md))

### I want to go live (real payments)

1. In Stripe Dashboard, flip the **Test mode** toggle OFF.
2. Complete account verification (business name, bank account, ID).
3. Generate live API keys (`sk_live_…`, `pk_live_…`).
4. Create a new webhook endpoint pointing to the same `/api/webhooks/stripe` URL, in **live mode**.
5. Update `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` env vars to the live values.
6. Redeploy.

The Supabase database stays the same — test and live payments are tracked side by side in `payment_transactions` (the `livemode` column tells them apart).

---

## Appendix: Fully scripted deploy (for agents / CI)

### Shortest path — use the StackPilot scripts

[StackPilot](https://github.com/jurczykpawel/stackpilot) ships ready-to-run installers that do everything in this guide automatically:

```bash
# Vercel + Supabase Cloud + Stripe test mode
./apps/sellf/install-vercel.sh --repo-path /path/to/sellf

# Netlify + Supabase Cloud + Stripe test mode
./apps/sellf/install-netlify.sh --repo-path /path/to/sellf

# Reuse Vercel's "Connect Database → Supabase" integration:
#   1. In Vercel UI: Storage → Connect Database → Supabase (creates project)
#   2. Note the project URL, anon/service_role keys, project ref, DB password
#   3. Run:
./apps/sellf/install-vercel.sh --repo-path /path/to/sellf \
    --skip-supabase \
    --supabase-url https://<ref>.supabase.co \
    --supabase-anon <jwt> --supabase-svc <jwt> \
    --supabase-ref <ref> --db-password <pwd>
```

Each script prints a live URL + saves credentials to `.env.deploy.<project>` on success.

### Or do it by hand

Below is the same flow expanded as bash commands you can paste one block at a time. Assumes `vercel`, `supabase`, and `stripe` CLIs are installed and logged in.

```bash
set -e

# === Step 1: Generate the four secrets ===
CHECKOUT_BINDING_SECRET=$(openssl rand -base64 32)
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
LOGINWALL_SECRET=$(openssl rand -hex 32)
DB_PASS=$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-24)

# === Step 2: Create the Supabase project ===
ORG_ID=$(supabase orgs list | awk -F'|' '/[a-z]{20}/ {gsub(/^ +| +$/,"",$1); print $1; exit}')
PROJECT_NAME="sellf-$(date +%s)"
supabase projects create "$PROJECT_NAME" --org-id "$ORG_ID" --db-password "$DB_PASS" --region eu-central-1
PROJECT_REF=$(supabase projects list | awk -F'|' -v n="$PROJECT_NAME" '$0 ~ n {gsub(/^ +| +$/,"",$3); print $3; exit}')

# === Step 3: Wait for provisioning + fetch keys ===
for i in 1 2 3 4 5; do
  KEYS=$(supabase projects api-keys --project-ref "$PROJECT_REF" 2>&1)
  echo "$KEYS" | grep -q "anon" && break || sleep 20
done
SB_URL="https://${PROJECT_REF}.supabase.co"
SB_ANON=$(echo "$KEYS" | grep -E '^\s+anon\s+\|' | sed 's/.*| //' | tr -d ' ')
SB_SVC=$(echo "$KEYS"  | grep -E '^\s+service_role\s+\|' | sed 's/.*| //' | tr -d ' ')

# === Step 4: Bring your own Stripe sk_test_ / pk_test_ (CLI can't fetch pk) ===
# Either paste them into env or pull from a known-good test env (see below).
: "${STRIPE_SK:?set STRIPE_SK to your sk_test_...}"
: "${STRIPE_PK:?set STRIPE_PK to your pk_test_...}"

# === Step 5: Create the Vercel project ===
cd admin-panel
vercel project add "$PROJECT_NAME"
vercel link --project "$PROJECT_NAME" --yes

# === Step 5b: CRITICAL — set framework to nextjs ===
# Without this, every URL returns x-vercel-error: NOT_FOUND. The clone URL flow
# does this automatically; the CLI doesn't when --yes is passed.
PROJECT_ID=$(jq -r .projectId .vercel/project.json)
TEAM_ID=$(jq -r .orgId .vercel/project.json)
VTOKEN=$(jq -r .token "$HOME/Library/Application Support/com.vercel.cli/auth.json")
curl -s -X PATCH "https://api.vercel.com/v9/projects/$PROJECT_ID?teamId=$TEAM_ID" \
  -H "Authorization: Bearer $VTOKEN" -H "Content-Type: application/json" \
  -d '{"framework":"nextjs"}' > /dev/null

# === Step 5c: CRITICAL — disable Vercel Authentication on new Hobby projects ===
# Without this, *.vercel.app returns 401 with an SSO cookie. Custom domains are fine.
vercel project protection disable "$PROJECT_NAME" --sso

# === Step 6: Set env vars — MUST use --value flag (NOT pipe-to-stdin) ===
# Piping to stdin silently sets empty values. Always use --value.
# vercel env pull will show sensitive vars as "" — that's a display quirk, not the
# stored value. Trust the deploy, not the pull, for sensitive envs.
SITE_URL="https://${PROJECT_NAME}.vercel.app"
add_env() { vercel env add "$1" production --value "$2" --yes; }

add_env SUPABASE_URL                "$SB_URL"
add_env SUPABASE_ANON_KEY           "$SB_ANON"
add_env SUPABASE_SERVICE_ROLE_KEY   "$SB_SVC"
add_env STRIPE_SECRET_KEY           "$STRIPE_SK"
add_env STRIPE_PUBLISHABLE_KEY      "$STRIPE_PK"
add_env STRIPE_WEBHOOK_SECRET       "whsec_PLACEHOLDER_for_first_deploy_replace_after_xxxxxxxxxx"
add_env SITE_URL                    "$SITE_URL"
add_env CHECKOUT_BINDING_SECRET     "$CHECKOUT_BINDING_SECRET"
add_env TRUSTED_PROXY               "true"
add_env APP_ENCRYPTION_KEY          "$APP_ENCRYPTION_KEY"
add_env LOGINWALL_SECRET            "$LOGINWALL_SECRET"

# === Step 7: First deploy ===
vercel --prod --yes

# === Step 8: Apply database migrations (the deploy can't do this) ===
cd ..
supabase link --project-ref "$PROJECT_REF" --password "$DB_PASS"
supabase db push --password "$DB_PASS" --yes

# === Step 9: Create the Stripe webhook + capture its signing secret ===
WH=$(stripe webhook_endpoints create --url="${SITE_URL}/api/webhooks/stripe" \
  --enabled-events="checkout.session.completed" \
  --enabled-events="checkout.session.async_payment_succeeded" \
  --enabled-events="checkout.session.async_payment_failed" \
  --enabled-events="customer.subscription.created" \
  --enabled-events="customer.subscription.updated" \
  --enabled-events="customer.subscription.deleted" \
  --enabled-events="customer.subscription.trial_will_end" \
  --enabled-events="invoice.paid" --enabled-events="invoice.payment_failed" \
  --enabled-events="payment_intent.succeeded" --enabled-events="payment_intent.payment_failed" \
  --enabled-events="charge.refunded")
WH_SECRET=$(echo "$WH" | jq -r .secret)

# === Step 10: Replace the placeholder webhook secret + redeploy ===
cd admin-panel
yes y | vercel env rm STRIPE_WEBHOOK_SECRET production --yes
vercel env add STRIPE_WEBHOOK_SECRET production --value "$WH_SECRET" --yes
vercel --prod --yes

# === Step 11: Smoke test ===
sleep 5
curl -sf "$SITE_URL/api/health" > /dev/null && echo "✓ /api/health OK"
curl -sf "$SITE_URL/api/runtime-config" | jq -e '.supabaseUrl and .stripePublishableKey' > /dev/null && echo "✓ /api/runtime-config OK"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SITE_URL/api/webhooks/stripe" -d '{}')" = "400" ] && echo "✓ webhook signature validation OK"
```

### Gotchas this script avoids

The first time I tried this end-to-end the deploy died at the homepage with `Missing SUPABASE_URL`. Three things turned out to bite:

1. **`vercel env add KEY production --value "..."`** — the documented `echo "$val" | vercel env add KEY production` pattern can silently set empty values in non-interactive contexts. The `--value` flag is the only reliable way.
2. **`vercel env pull` shows sensitive env vars as `""`** — that's a display quirk, not the stored value. Don't use `pull` output to verify sensitive envs are non-empty.
3. **`framework: null` after `vercel link --yes`** — Vercel didn't auto-detect Next.js, every URL returned 404 from the edge. PATCH `framework: "nextjs"` via API before deploying.

(The clone URL in the README handles items 2 and 3 automatically. Only the CLI path needs them.)

## What about the `.env.example` file?

[`.env.example`](../admin-panel/.env.example) lists every optional env var Sellf supports (~30 of them). The 11 above are the minimum required for a working production deploy. Optional things you might want later:

| Variable | What it adds |
|----------|--------------|
| `ALTCHA_HMAC_KEY` | Self-hosted CAPTCHA on checkout (no Cloudflare needed) — `openssl rand -hex 32` |
| `CLOUDFLARE_TURNSTILE_SITE_KEY` + `CLOUDFLARE_TURNSTILE_SECRET_KEY` | Cloudflare Turnstile CAPTCHA instead of ALTCHA |
| `GUS_API_KEY` | Polish company auto-fill in checkout (PL market only) |
| `OAUTH_PROVIDERS` | Add Google/GitHub/Discord login on top of magic links |
| `SELLF_EMBED_ALLOWED_ORIGINS` | If you embed checkout on external sites, list those domains here |
| `NEXT_PUBLIC_SELLF_ALLOWED_DOWNLOAD_DOMAINS` | If you host product files on your own CDN |

Add them later via the Vercel/Netlify env vars panel — no redeploy needed for runtime envs, just a restart.
