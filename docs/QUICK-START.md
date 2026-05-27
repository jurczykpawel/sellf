**Language:** 🇬🇧 English · [🇵🇱 Polski](./pl/QUICK-START.md)

# Putting your Sellf store online — easiest way

> ## 🏆 Easiest method (this guide)
>
> - **What:** Vercel one-click button + Vercel's built-in Supabase database
> - **Skills needed:** none — only a web browser
> - **Setup time:** ~20 minutes
> - **Cost to start:** **$0/month**
> - **Cost once you're a real commercial store:** **$20/month** for Vercel Pro (Hobby is technically personal/non-commercial use), **+$25/month** for Supabase Pro when you outgrow the free database (typically takes 3+ years for a small store)
> - **Stripe fee** (every path): ~2.9% + $0.30 per transaction
>
> **Best for:** anyone who hasn't put software on a server before. If that's you, stop reading the green box below and just follow this guide.
>
> ## 💰 Cheapest method (requires a terminal)
>
> - **What:** Sellf on a [mikr.us](https://mikr.us/?r=pavvel) VPS (35 PLN/year ≈ $9/year) + free Supabase
> - **Skills needed:** comfort with SSH, copy-pasting Linux commands, running a script in your terminal
> - **Setup time:** ~45 minutes
> - **Cost to start:** **~$1/month** (just the mikr.us subscription; free Supabase covers the database)
> - **Cost when your store outgrows the free Supabase limits:** ~$25/month (Supabase Pro)
> - **Stripe fee** (every path): same ~2.9% + $0.30 per transaction
>
> **Best for:** people already used to Linux servers who want to minimize monthly costs. Trade-off: more responsibility, you maintain the server, no fancy dashboard.
>
> **Want full instructions for the cheapest path?** See [DEPLOYMENT-MIKRUS.md](./DEPLOYMENT-MIKRUS.md). Or for the slightly-more-expensive but full-control [Coolify](./DEPLOYMENT-COOLIFY.md) option (~$9/month on Hetzner, comes with a nice dashboard).
>
> ## When do you actually have to upgrade?
>
> The free Supabase plan covers a typical small Sellf store for **years**, not months. You don't need to upgrade just because you have customers — the free plan is generous. You upgrade when you hit one of these real limits:
>
> | Limit (free tier) | Rough rule of thumb — when this matters |
> |-------------------|------------------------------------------|
> | **500 MB database** | A store with ~50,000 customers and a year of orders is comfortably under this. Most stores take 3–4 years to fill 500 MB. |
> | **1 GB file storage** | Only matters if you upload your product files into Supabase. Most operators host product downloads on cheaper file hosts (Cloudflare R2, Backblaze B2) and never touch this limit. |
> | **50,000 monthly active users** | "Active" = signed in. Plenty of room for a store with tens of thousands of returning customers. |
> | **2 projects per organization** | One project per store. If you want a separate test store, that's the second slot. |
> | **No automated backups (only 7-day point-in-time recovery)** | When losing your data would be a business-ending event, the daily backups Pro provides are worth $25/month. |
>
> Practical answer: **start free**, upgrade the day one of those limits actually bites you. Both Vercel and Supabase show you usage graphs in their dashboards so you'll see it coming weeks ahead.
>
> ---
>
> **Not sure which to pick?** If you've never SSHed into a server, the easiest method is the right answer — when (and only when) you actually hit a Supabase limit, the $25/month upgrade buys you years more headroom. You can always migrate to a cheaper path later; the data and store stay the same.

This guide walks you through that easiest path: **everything in your web browser, no programs to install, no terminal**.

**Total time:** about 20 minutes (most of it waiting).

**What you'll have at the end:** a working store at a web address like `https://your-store.vercel.app`, where you can add products and accept payments.

**What this costs:** $0 to start. Everything used here has a free plan that's enough for your first months. When your store has paying customers, you'll likely upgrade Supabase to its $25/month plan — explained at the end.

---

## Quick overview: what's connected to what

Your Sellf store has three parts working together:

1. **The store software** (Sellf itself) — runs on a service called **Vercel**. This is what your customers see when they visit your store.
2. **The data** (products, orders, customers) — stored on a service called **Supabase**. Sellf reads and writes data here.
3. **Payment processing** — handled by **Stripe**. When a customer pays, Stripe takes their card details and sends the money to your bank account.

You'll create one account on each of these three services. Each account is free.

---

## Before you start

Make sure you have:

- A web browser (Chrome, Firefox, Safari, Edge — any modern one)
- An email address you can check
- About 20 minutes
- A password manager or a place to safely write down passwords (very important — you'll create several)

That's it. You don't need to install anything on your computer.

---

## Step 1: Create a GitHub account (1 minute)

GitHub is a service that stores software. We'll use it as a "passport" to log into the other services (Vercel and Supabase both let you sign in with GitHub, which saves time).

1. Open https://github.com/signup
2. Enter your email address, click **Continue**
3. Create a password, click **Continue**
4. Pick a username (anything available), click **Continue**
5. Solve the "are you human?" puzzle
6. Click **Create account**
7. GitHub will email you a code. Open your email, copy the code, paste it back into the GitHub page

Done. You now have a GitHub account. **You don't need to do anything technical on GitHub** — you'll only use it to sign in to other services.

> **If you already have a GitHub account, skip this step.**

---

## Step 2: Create a Vercel account (1 minute)

Vercel is where your Sellf store will live on the internet.

1. Open https://vercel.com/signup
2. Click **Continue with GitHub**
3. GitHub will ask "Authorize Vercel?" — click **Authorize Vercel**
4. Vercel asks for a username (it suggests one based on your GitHub name) — keep the suggestion or change it, click **Continue**
5. Pick **Hobby** (free) when asked about plan — click **Continue**
6. Skip any "invite teammates" or "first project" prompts — you'll get there in a moment

Done. You have a Vercel account.

---

## Step 3: Copy the Sellf code into your Vercel account (3 minutes)

You're not going to do any programming. This just makes a personal copy of Sellf in your Vercel.

1. Open this special link: [https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjurczykpawel%2Fsellf&root-directory=admin-panel&env=CHECKOUT_BINDING_SECRET,TRUSTED_PROXY,APP_ENCRYPTION_KEY,LOGINWALL_SECRET,STRIPE_SECRET_KEY,STRIPE_PUBLISHABLE_KEY,STRIPE_WEBHOOK_SECRET,SITE_URL&project-name=sellf&repository-name=sellf](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjurczykpawel%2Fsellf&root-directory=admin-panel&env=CHECKOUT_BINDING_SECRET,TRUSTED_PROXY,APP_ENCRYPTION_KEY,LOGINWALL_SECRET,STRIPE_SECRET_KEY,STRIPE_PUBLISHABLE_KEY,STRIPE_WEBHOOK_SECRET,SITE_URL&project-name=sellf&repository-name=sellf)

   (You'll see why we're using this special link in a moment — it does some setup automatically.)

2. Vercel asks you to authorize GitHub access. Click **Install** or **Authorize**.
3. Vercel will copy the Sellf code into your GitHub account (you'll see "Creating Git Repository...") — wait about 30 seconds
4. You'll land on a page titled "Configure Project" with a form
5. **STOP HERE** and don't fill in anything yet. **Leave this tab open**, you'll come back to it. We need to set up your database first.

> **What just happened?** Vercel made a personal copy ("fork" in tech-speak) of the Sellf source code in your own GitHub account, and is now waiting for you to provide some settings before actually putting it online. We're going to fill those settings step by step.

---

## Step 4: Add a database to your project (5 minutes)

The "Configure Project" form is waiting for you. We're going to add a database **before** filling the form, because adding the database fills in some of the form's values automatically.

1. **Open a new browser tab** (don't close the "Configure Project" tab — you'll come back to it)
2. In the new tab, open https://vercel.com/dashboard
3. You'll see your Sellf project listed. Click on it.
4. In the menu on the left, click **Storage**
5. Click the button **Create Database**
6. You'll see a list of database options. Click **Supabase**
7. Click **Continue with Supabase**

   - **If this is the first time you're using Supabase:** a Supabase signup page opens. Click **Continue with GitHub**, then click **Authorize Supabase**. You're now signed up for Supabase.
   - **If you already have a Supabase account:** sign in.

8. Vercel asks for the database setup:
   - **Display Name:** type `sellf-database` (or anything you remember)
   - **Region:** pick the one closest to where most of your customers will live:
     - Europe → **eu-central-1 Frankfurt**
     - USA East coast → **us-east-1 N. Virginia**
     - USA West coast → **us-west-1 Oregon**
     - Asia → **ap-southeast-1 Singapore**
     - Australia → **ap-southeast-2 Sydney**
     - South America → **sa-east-1 São Paulo**
   - **Database Password:** click **Generate Password**. Then click the **eye icon** to reveal the password. **Copy this password into your password manager**. Write a note: "Sellf database password — Supabase."
9. Click **Create**
10. Wait about 2 minutes while Supabase prepares your database. You'll see "Connecting your database..."
11. When it's ready, you'll see a green checkmark and a button **Connect Project**. Click it.
12. **Continue when ready** — Vercel will save the database connection in your project automatically.

> **What just happened?** Vercel created a database for you on Supabase, and saved the address and access keys directly into your Sellf project. You don't need to copy anything yourself.

---

## Step 5: Get your payment processing keys (5 minutes)

Now we need to set up Stripe so your store can accept payments.

We'll start in "test mode" first — this lets you pretend-process payments with fake card numbers so you can make sure everything works before going live. You can switch to real payments later by changing one setting.

1. **Open a new browser tab**
2. Go to https://dashboard.stripe.com/register
3. Fill in:
   - **Email:** your real email address
   - **Full name:** your name
   - **Country:** the country your business is in
   - **Password:** create a strong one, **save it in your password manager**
4. Click **Create account**
5. Stripe will email you a verification link. Open your email, click the link
6. Back on Stripe, you'll land on the dashboard. Look at the **top-right corner** — there's a toggle that says **"Activate payments"** or shows your account name. **Make sure "Test mode" is ON** (there's a toggle switch labeled "Test mode" — it should be highlighted in orange/red color)
7. In the left menu, click **Developers**
8. Click **API keys** in the submenu
9. You'll see two keys on the page:
   - **Publishable key** — starts with `pk_test_...`. Click the copy icon next to it. **Paste it into a temporary text file** — you'll need it in a moment.
   - **Secret key** — starts with `sk_test_...`. Click **Reveal test key**, then copy. **Paste this into your text file too**. Label this one "Stripe secret key — KEEP SECRET."

You now have both Stripe keys. Don't close the Stripe tab — we'll come back to it later.

> **What is "Test mode"?** Stripe Test mode lets you pretend to process payments using fake card numbers (like `4242 4242 4242 4242`). No real money moves. This is exactly how Sellf is set up out of the box. When you're ready to take real money, you'll go through Stripe's "Activate" process (they verify your business identity) and then switch to "Live mode" keys. We'll cover that at the end.

---

## Step 6: Generate four security keys (2 minutes)

Sellf needs four random "secret" values to keep your store secure. These are like very long random passwords. We'll use a free website to generate them.

1. **Open a new browser tab**
2. Go to https://www.random.org/strings/
3. On the page:
   - **Number of strings:** type `4`
   - **Length of each string:** type `40`
   - **Characters to use:** check **Alphabetic characters (uppercase only)** AND **Numeric digits** (uncheck others)
   - **Make each string unique:** check **Yes**
4. Click **Get Strings**
5. You'll see 4 random strings, one per line. Copy each one into your text file with these labels:
   - First string → label "CHECKOUT_BINDING_SECRET"
   - Second string → label "APP_ENCRYPTION_KEY"
   - Third string → label "LOGINWALL_SECRET"
   - Fourth string → label "(spare — not used)"

> **Why do I need these?** Sellf uses these random values to digitally sign things (like making sure a payment receipt is genuine and not tampered with). They're like a unique identifier for your store. You generate them once and never need to look at them again. **Don't share them with anyone.**

---

## Step 7: Fill in your Sellf project's settings (3 minutes)

Now we go back to the "Configure Project" tab in Vercel (the one you left open in Step 3).

1. Go back to the Vercel "Configure Project" tab
2. If the page expired, no problem — go to https://vercel.com/dashboard, click your Sellf project, then click **Settings** → **Environment Variables**
3. You'll see a list of empty fields like `CHECKOUT_BINDING_SECRET`, `STRIPE_SECRET_KEY`, etc.
4. Fill them in by **copying values from your text file** (from previous steps):

   | Field name | What to paste |
   |---|---|
   | `CHECKOUT_BINDING_SECRET` | The first random string from random.org |
   | `TRUSTED_PROXY` | The word `true` (just that, four letters, lowercase) |
   | `APP_ENCRYPTION_KEY` | The second random string from random.org |
   | `LOGINWALL_SECRET` | The third random string from random.org |
   | `STRIPE_SECRET_KEY` | The Stripe key starting with `sk_test_...` |
   | `STRIPE_PUBLISHABLE_KEY` | The Stripe key starting with `pk_test_...` |
   | `STRIPE_WEBHOOK_SECRET` | Type exactly: `whsec_PLACEHOLDER_will_replace_after_first_deploy_xx` — we'll fix this in Step 9 |
   | `SITE_URL` | Type: `https://sellf-` + your-Vercel-username + `.vercel.app` — you can also leave it blank for now |

   (The Supabase settings are already filled in — Vercel added them in Step 4.)

5. Click the big **Deploy** button at the bottom
6. Vercel will start putting your store online. You'll see a progress screen. **This takes about 3-5 minutes** — go grab a coffee.

---

## Step 8: Wait, then visit your store (5 minutes)

1. When the deployment finishes, you'll see a celebration animation and a screen showing your project
2. Click the **Visit** button (or click the project name → **Domains** → the `*.vercel.app` URL)
3. You should see the Sellf homepage at an address like `https://sellf-yourname.vercel.app`
4. **Write down or bookmark this address** — this is your store

If you see a "500" error: don't panic. Sometimes the first visit fails because the database is still being set up. Refresh the page after 30 seconds. If it still fails, see the **Troubleshooting** section below.

---

## Step 9: Connect Stripe payments (5 minutes)

Right now, your store is online but Stripe doesn't know about it yet. We need to tell Stripe where to send payment notifications.

1. Open https://dashboard.stripe.com/test/webhooks
2. Click **Add endpoint** (top-right)
3. In the **Endpoint URL** field, type:
   `https://YOUR-STORE-URL.vercel.app/api/webhooks/stripe`
   (Replace `YOUR-STORE-URL` with your actual store URL from Step 8 — make sure you're using your domain, ending with `/api/webhooks/stripe`)
4. In the **Description** field (optional), type: `Sellf payment notifications`
5. Click **Select events** and check these boxes (just these, no need for others):
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `customer.subscription.created` (only if you'll sell subscriptions)
   - `customer.subscription.updated` (only if you'll sell subscriptions)
   - `customer.subscription.deleted` (only if you'll sell subscriptions)
   - `invoice.paid` (only if you'll sell subscriptions)
   - `invoice.payment_failed` (only if you'll sell subscriptions)
6. Click **Add events**
7. Click **Add endpoint** at the bottom
8. You're now on a page showing the new webhook. Look for **Signing secret** — click **Reveal**. You'll see a value starting with `whsec_...`
9. **Copy this value** to your text file

Now go back to your Vercel project and update the placeholder:

10. Open https://vercel.com/dashboard, click your Sellf project
11. Click **Settings** → **Environment Variables**
12. Find `STRIPE_WEBHOOK_SECRET` in the list, click the three dots → **Edit**
13. Paste the real `whsec_...` value (replacing the placeholder you typed in Step 7)
14. Click **Save**
15. Now redeploy: go to **Deployments** tab, find the most recent one, click the three dots → **Redeploy**
16. Wait 2 minutes for the redeploy

---

## Step 10: Test that payments work (2 minutes)

1. Open your store URL in your browser
2. **You become the admin automatically** — the very first person who signs up on a new Sellf store gets admin powers. Click **Sign up** (or **Login**), enter your email, and follow the magic link from your inbox.

   - **Don't see the magic link email?** Check your spam folder. Supabase's free email service sometimes lands there. After your first successful magic-link login, you can set up a better email service in Sellf settings.

3. You're now in the admin dashboard. Try creating a test product:
   - Click **Products** → **New product**
   - Title: "Test product"
   - Price: $5
   - Click **Save**
4. Visit your product's public page (click the slug link)
5. Click **Buy**
6. On the Stripe payment page, use the fake test card:
   - **Card number:** `4242 4242 4242 4242`
   - **Expiration:** any future date (e.g., `12/30`)
   - **CVC:** any 3 digits (e.g., `123`)
   - **ZIP:** any (e.g., `12345`)
7. Click **Pay**
8. You should land on a "Success" page

Now go check that Stripe received the payment:

9. Open https://dashboard.stripe.com/test/payments
10. You should see your test payment listed

You should also see it in your admin dashboard:

11. Back at your store, click **Admin → Payments**
12. Your test payment appears here too

🎉 Your store is fully working. Add real products, share the link with the world, and start selling.

---

## Going live: switching from test mode to real payments

When you're ready to take real money:

1. In Stripe, click **Activate payments** (top-right)
2. Fill in business details: business name, address, bank account, identity verification
3. Wait for Stripe to approve (usually a few minutes for personal accounts, a few hours for businesses)
4. Once approved, you'll see new "Live" API keys in https://dashboard.stripe.com/apikeys (not test). They start with `pk_live_...` and `sk_live_...`
5. Make a new webhook (same way as Step 9, but in the **Live** webhooks page at https://dashboard.stripe.com/webhooks). You'll get a new `whsec_...` for live mode.
6. Update three settings in Vercel (Settings → Environment Variables):
   - `STRIPE_SECRET_KEY` → your `sk_live_...`
   - `STRIPE_PUBLISHABLE_KEY` → your `pk_live_...`
   - `STRIPE_WEBHOOK_SECRET` → the new `whsec_...` from the live webhook
7. Redeploy (Deployments → most recent → three dots → Redeploy)

You're now accepting real money. Real customers pay with real cards, the money lands in your bank account on Stripe's normal schedule.

---

## What it costs as you grow

The free plan covers most small Sellf stores for years. Here's when you'll likely pay something:

| When | What to upgrade | Why | Cost |
|---|---|---|---|
| Day 1 (you're here) | Nothing | Free plans cover starting out | $0/month |
| First paying customer | Nothing yet | Free plan still works | $0/month |
| Your database approaches 500 MB | **Supabase Pro** ($25/mo) | More database room (8 GB) + automated daily backups | $25/month |
| You hit 50,000 monthly active users | **Supabase Pro** ($25/mo) | Higher MAU limit | $25/month |
| You hit a Vercel Hobby limit (see table below) | **Vercel Pro** ($20/mo + usage) | Higher limits + commercial use allowed | $20/month + overages |

### Vercel Hobby limits (the free tier this guide uses)

Vercel Hobby is generous but has hard stops — when you hit a limit your store returns 503 until the next billing cycle (no automatic overage billing).

| Resource | Free monthly limit | What it covers for a Sellf store |
|----------|---------------------|----------------------------------|
| **Fast Data Transfer** (bandwidth) | 100 GB | Each page view costs ~200–500 KB → 100 GB covers ~200,000 monthly visits |
| **Function Invocations** | 1,000,000 | One per page load + a few per webhook → covers 50–200k visits |
| **Active CPU** | 4 hours | Total compute time across all functions; Sellf uses very little per request |
| **Edge Requests** | 1,000,000 | Cached static assets — covers ~50k unique visits per month |
| **Image Transformations** | 5,000 | Product images scaled on the fly |
| **Build Memory** | 360 GB-hrs | Essentially unlimited for Sellf |
| **Deployments** | unlimited | Redeploy as often as you want |
| **Team members** | 1 seat | Solo operation only |

### Vercel Hobby is for personal use, not commercial

This is the part Vercel buries: **the Hobby plan is "for personal, non-commercial use."** Strictly speaking, running a store that takes money from customers is commercial use and should be on Pro.

In practice Vercel rarely flags small commercial sites — you can experiment, launch, validate. But once you have real customers and steady revenue, you should upgrade to Pro both for legal compliance and to avoid hitting hard limits during a busy day.

So realistically: **$0 while you're validating, $20/month once you're a real commercial store** (Vercel Pro), **$45/month if you also outgrow Supabase Free** (Supabase Pro on top).

For a typical small digital store the 500 MB database covers 3–4 years of growth. You don't need to budget for $45/month from day one — start free, upgrade Vercel when revenue justifies it, upgrade Supabase when usage graphs in the dashboard show you closing in on a limit.

Stripe takes a per-transaction fee (~2.9% + $0.30 in most countries) — see https://stripe.com/pricing for your country.

## All deployment options by cost

This guide uses **the easiest path** (Vercel + Vercel's built-in Supabase). There are cheaper options if you're willing to use a terminal and manage a server yourself. Here's the full landscape:

| Path | Monthly cost (after you have customers) | Setup time | Technical skill needed | Best for |
|------|----------------------------------------|------------|------------------------|----------|
| **Vercel + Vercel-Supabase (this guide)** | **$0/mo on free tier, $25/mo once you outgrow Supabase Free** | ~20 min | 🟢 None — browser only | **First-time store owners, non-technical users.** This is the recommended path. |
| [Netlify + Supabase](./DEPLOYMENT-VERCEL-NETLIFY.md) | Same as Vercel: $0 → $25/mo | ~20 min | 🟢 None — browser only | Same as Vercel, just a different host |
| [Coolify Cloud + Hetzner VPS](./DEPLOYMENT-COOLIFY.md) | **~$14/mo** ($5 Coolify Cloud + $9 Hetzner CX32) — Supabase runs on the same VPS for free | ~30 min | 🟡 Basic — copy SSH key into a VPS | Full control + managed Coolify dashboard. No separate database bill, ever. |
| [Coolify self-hosted + Hetzner VPS](./DEPLOYMENT-COOLIFY.md) | **~$9/mo** ($9 Hetzner CX32, everything else free) — Supabase runs on the same VPS for free | ~45 min | 🟡 Basic — SSH commands, a couple of secrets | Full control, lowest reasonable cost. No separate database bill, ever. |
| [mikr.us VPS + Supabase Free](./DEPLOYMENT-MIKRUS.md) | **~$1/mo** on free tier, ~$25/mo once you outgrow Supabase Free | ~45 min | 🔴 Intermediate — SSH, terminal, PM2 | Cheapest option for technically comfortable people |

**Stripe per-transaction fee** (~2.9% + $0.30) is the same on every path — it's how Stripe makes money. Pick the path that matches your skill level; Stripe doesn't care.

**Recommended for non-technical users:** **stay with this guide**. Vercel + Vercel-Supabase is $25/month more expensive than mikr.us, but if you're not comfortable with terminals and Linux, the $25/month buys you peace of mind. You can always migrate to a cheaper path later — it's not a one-way door.

**Recommended for someone comfortable with servers:** **Coolify self-hosted on Hetzner** for ~$9/month. Best balance of cost, control, and convenience. See [DEPLOYMENT-COOLIFY.md](./DEPLOYMENT-COOLIFY.md).

---

## Common problems

### "I see a 500 error when I visit my store"

Most common cause: the database isn't fully set up yet. Wait 1 minute and refresh.

If that doesn't fix it:
1. Go to https://supabase.com/dashboard
2. Click your project (the one called `sellf-database` from Step 4)
3. Look at the top — if it says "Paused," click **Restore**
4. Wait 1 minute, then refresh your store

### "I never received the magic link email"

1. Check spam/junk folder
2. Some email providers (Gmail, Yahoo) delay or block emails from Supabase's default sender. Wait 5 minutes.
3. If still nothing: go to your store's admin (you'll need to sign up the regular way once), then **Settings → Email** to set up a proper email service (SendGrid, Postmark, or Resend — all have free plans)

### "I can't log in — it says my session expired"

Clear your browser cookies for your store URL, then try signing in again.

### "How do I add a custom domain like mystore.com?"

1. Buy a domain (Namecheap, Google Domains, Cloudflare — any registrar)
2. In Vercel, open your Sellf project → **Settings** → **Domains** → **Add**
3. Type your domain (e.g., `mystore.com`) and click **Add**
4. Vercel shows DNS records to add — go to your domain registrar and add them
5. Wait 5-30 minutes for the domain to start working
6. Update `SITE_URL` in your Sellf environment variables to your new domain

### "How do I update Sellf to the newest version?"

1. Open your store's project on Vercel
2. Go to **Deployments** tab
3. Click **Redeploy** on the most recent deployment

Vercel will pull the latest Sellf code from your GitHub copy. If new updates have been released since you set up, they'll be included.

### "I want to delete my store and start over"

1. Vercel: project → **Settings** → **General** → scroll to bottom → **Delete Project**
2. Supabase: dashboard → your project → **Settings** → **General** → **Delete project**
3. Stripe: webhooks page → delete the endpoint

That undoes everything in 1 minute. No charges.

---

## Other ways to put Sellf online (slightly more technical)

If you want more control or fewer monthly costs, here are the alternatives:

- **[Netlify deploy guide](./DEPLOYMENT-VERCEL-NETLIFY.md)** — same difficulty as Vercel, just a different hosting company. Pick this if you prefer Netlify's interface.
- **[Coolify deploy guide](./DEPLOYMENT-COOLIFY.md)** — host Sellf on your own server (rent one for ~$5-10/month). More work to set up but cheaper long-term and gives you full control. **Requires basic comfort with Linux servers.**
- **[VPS / mikr.us deploy guide](./DEPLOYMENT-MIKRUS.md)** — runs on a $9/year cheap server. **Requires using your computer's terminal and typing commands.** For people who want to learn the technical side.
- **[Detailed reference for Vercel/Netlify](./DEPLOYMENT-VERCEL-NETLIFY.md)** — same as this guide but with deeper technical detail, command-line shortcuts, and step-by-step automation for developers.

If you're not sure which to pick, **stay with this guide (Vercel)** — it's by far the simplest and you can always switch later.
