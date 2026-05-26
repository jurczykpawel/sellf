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
| Vercel Hobby | free | 100 GB bandwidth, 100 GB-h functions | Commercial use OK for personal projects |
| Netlify Starter | free | 100 GB bandwidth, 300 build min/month, 125k function invocations | Plenty for small stores |
| Supabase Free | free | 500 MB DB, 1 GB storage, 50k MAU | **Project pauses after 7 days of inactivity** — keep traffic flowing or upgrade to Pro for production |
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

### Build fails on Netlify with "Cannot find @netlify/plugin-nextjs version that supports Next.js 16"

Sellf uses Next.js 16. The Netlify Next plugin officially supports up to 15.x at the time of writing. You have two options:

- **Switch to Vercel** — first-party Next.js support, no compatibility risk
- **Wait for plugin update** — `@netlify/plugin-nextjs` has historically caught up with new Next.js majors within a few weeks. Check https://github.com/netlify/next-runtime-minimal/releases.

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
