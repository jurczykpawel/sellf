**Language:** 🇬🇧 English · [🇵🇱 Polski](./pl/QUICK-START.md)

# Putting your Sellf store online — easiest way

> **Cost story up front:** you can start for **$0/month** (Vercel + free Supabase Cloud) and most small stores stay free for years. If you'd rather have the app on your own server, that's typically **around $5/month** for a cheap VPS — Supabase still stays on its free cloud tier handling the database. The only time you'd pay more is at real scale, covered later.
>
> ## 🏆 Easiest method (this guide)
>
> - **What:** Vercel one-click button + Vercel's built-in Supabase database (Supabase Cloud free tier)
> - **Skills needed:** none — only a web browser
> - **Setup time:** ~20 minutes
> - **Cost:** **$0/month** to start, and most small Sellf stores stay $0/month for years (Vercel's free Hobby tier + Supabase's free tier have generous limits — details further down)
> - **Stripe fee** (every path): ~2.9% + $0.30 per transaction
>
> **Best for:** anyone who hasn't put software on a server before. If that's you, stop reading the green box below and just follow this guide.
>
> ## 💰 Own-VPS path (requires a terminal)
>
> - **What:** Sellf app on your own cheap VPS, with Supabase still hosted on its free cloud tier handling the database. Sellf alone runs in ~500 MB RAM so a basic VPS is plenty.
> - **Skills needed:** comfort with SSH, copy-pasting Linux commands, running a script in your terminal
> - **Setup time:** ~45 minutes
> - **Cost:** typically **~$5/month** (Hetzner CAX11, DigitalOcean basic droplet, etc.) for the VPS; Supabase stays $0 on the free cloud tier. Goes as low as **~$1/month** with [mikr.us](https://mikr.us/?r=pavvel) (35 PLN/year, 384 MB RAM — fits Sellf comfortably).
> - **Stripe fee** (every path): same ~2.9% + $0.30 per transaction
>
> **Best for:** people already used to Linux servers who want their app on their own infrastructure without the cost of running a full Supabase stack yourself.
>
> **Want full instructions?** See [DEPLOYMENT-MIKRUS.md](./DEPLOYMENT-MIKRUS.md) for the rock-bottom mikr.us setup. If you'd rather also self-host Supabase on the same machine (so no Supabase Cloud at all), that's a separate path requiring 8 GB+ RAM (~$9/month on Hetzner CX32) — see [DEPLOYMENT-COOLIFY.md](./DEPLOYMENT-COOLIFY.md).
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
> **Not sure which to pick?** If you've never SSHed into a server, the easiest method (this guide) is the right answer — your store can stay $0/month for years, and even at scale the upgrade costs are modest. You can always migrate to your own VPS later if you want to cut costs further; the data and store stay the same.

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

1. Open this special link: [https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjurczykpawel%2Fsellf&root-directory=admin-panel&env=CHECKOUT_BINDING_SECRET,TRUSTED_PROXY,APP_ENCRYPTION_KEY,LOGINWALL_SECRET,STRIPE_SECRET_KEY,STRIPE_PUBLISHABLE_KEY,SITE_URL&project-name=sellf&repository-name=sellf](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjurczykpawel%2Fsellf&root-directory=admin-panel&env=CHECKOUT_BINDING_SECRET,TRUSTED_PROXY,APP_ENCRYPTION_KEY,LOGINWALL_SECRET,STRIPE_SECRET_KEY,STRIPE_PUBLISHABLE_KEY,SITE_URL&project-name=sellf&repository-name=sellf)

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

## Step 9: Connect Stripe payments (1 minute, 1 click)

Your store is online but Stripe doesn't know how to send it payment notifications yet. Sellf will do this for you with one click — no Stripe Dashboard hopping.

1. Open your store URL (the `*.vercel.app` address from Step 8)
2. Click **Sign up** or **Login** → enter your email → submit
3. Check your inbox (and spam folder — Supabase's free SMTP often lands there). Click the magic link
4. You're now on the admin dashboard. **The first person who signs up automatically becomes admin** — that's you.
5. Click **Settings** in the left menu (or go to `/dashboard/settings`)
6. Open the **Payments** tab
7. Find the **Stripe Webhook** card. Click **Register webhook**
8. That's it. Sellf calls Stripe for you: creates the webhook endpoint pointing at your store, subscribes to every event it needs, and saves the signing secret encrypted in your database.

> **What just happened?** No copy-paste, no Dashboard hopping, no env-var editing. Sellf stores the signing secret in your Supabase DB instead of an env var, so this works the moment you click the button.

---

## Step 10: Test that payments work (2 minutes)

You're already signed in as admin from Step 9 — now verify a real payment goes through end-to-end.

1. In the admin dashboard, create a test product:
   - Click **Products** → **New product**
   - Title: "Test product"
   - Price: $5
   - Click **Save**
2. Visit your product's public page (click the slug link)
3. Click **Buy**
4. On the Stripe payment page, use the fake test card:
   - **Card number:** `4242 4242 4242 4242`
   - **Expiration:** any future date (e.g., `12/30`)
   - **CVC:** any 3 digits (e.g., `123`)
   - **ZIP:** any (e.g., `12345`)
5. Click **Pay**
6. You should land on a "Success" page

Now go check that Stripe received the payment:

7. Open https://dashboard.stripe.com/test/payments
8. You should see your test payment listed

You should also see it in your admin dashboard:

9. Back at your store, click **Admin → Payments**
10. Your test payment appears here too (the webhook you registered in Step 9 is what writes this row)

🎉 Your store is fully working. Add real products, share the link with the world, and start selling.

---

## Going live: switching from test mode to real payments

When you're ready to take real money:

1. In Stripe, click **Activate payments** (top-right)
2. Fill in business details: business name, address, bank account, identity verification
3. Wait for Stripe to approve (usually a few minutes for personal accounts, a few hours for businesses)
4. Once approved, you'll see new "Live" API keys in https://dashboard.stripe.com/apikeys (not test). They start with `pk_live_...` and `sk_live_...`
5. Update two settings in Vercel (Settings → Environment Variables):
   - `STRIPE_SECRET_KEY` → your `sk_live_...`
   - `STRIPE_PUBLISHABLE_KEY` → your `pk_live_...`
6. Redeploy (Deployments → most recent → three dots → Redeploy)
7. Back in your store admin → **Settings → Payments** → click **Register webhook** again. Sellf creates a fresh webhook on Stripe's live endpoint and stores the new signing secret in your DB — same one-click flow as test mode.

You're now accepting real money. Real customers pay with real cards, the money lands in your bank account on Stripe's normal schedule.

---

## What it costs as you grow

Short version: **most small Sellf stores stay at $0/month for years.** You'd only pay something when you outgrow specific limits — and the upgrade costs are modest even then.

| Where you are | Typical monthly cost | What's covered |
|---------------|---------------------|----------------|
| Day 1, testing the store | **$0** | Vercel Hobby + Supabase Free both have generous quotas |
| First paying customers | **$0** | Free tier still fits — a store with hundreds of customers/month is nowhere near any limit |
| Established store, modest traffic | **$0** | The Vercel Hobby and Supabase Free limits cover most small digital stores for 3–4 years |
| Database fills up (~500 MB) | **$25/mo** (Supabase Pro) | More database room (8 GB) + automated daily backups |
| You hit a Vercel Hobby resource limit (rare; see table below) | **+$20/mo** (Vercel Pro) | Higher quotas, no hard stops |
| Want to switch the app to your own VPS to cap Vercel costs | **~$5/mo** | Sellf app on a cheap VPS; Supabase stays on its free cloud tier — see [DEPLOYMENT-MIKRUS.md](./DEPLOYMENT-MIKRUS.md) |
| Want everything self-hosted (no Supabase Cloud at all) | **~$9/mo** | 8 GB VPS running Sellf + a self-hosted Supabase stack — see [DEPLOYMENT-COOLIFY.md](./DEPLOYMENT-COOLIFY.md) |

So in plain English: **$0 to start, $0 for most small stores for years, around $5/month if you'd rather own the server, and $25–45/month only if you grow enough to need Supabase Pro and/or Vercel Pro.**

### Vercel Hobby — what's in the free tier and when does it hard-stop

Vercel Hobby is generous, but unlike "pay for what you use" plans it has hard stops — when you hit a limit your store returns 503 until the next billing cycle. The good news: for a typical Sellf store these limits cover **50,000–200,000 visits per month** before you need to think about Vercel Pro.

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

### Heads-up: Vercel Hobby is officially "personal, non-commercial"

Vercel's terms say Hobby is "for personal, non-commercial use." Strictly speaking, a store that accepts customer payments is commercial.

In practice Vercel rarely flags small commercial sites and many indie store operators happily run on Hobby for years. If your traffic is small and your conscience or your legal team wants you on Pro, the upgrade is $20/month. If you want to sidestep the question entirely, the own-VPS path (around $5/month) has no such restriction.

### Stripe per-transaction fee (every path)

Stripe takes ~2.9% + $0.30 per transaction (rates vary by country — see https://stripe.com/pricing). This is the same on every deployment path.

## All deployment options by cost

This guide uses **the easiest path** (Vercel + Supabase Cloud, both free). Here's how the alternatives compare:

| Path | Typical monthly cost | Setup time | Technical skill | Best for |
|------|---------------------|------------|------------------|----------|
| **Vercel + Supabase Cloud (this guide)** | **$0**, stays free for most small stores for years | ~20 min | 🟢 None — browser only | First-time store owners, non-technical users. The recommended path. |
| [Netlify + Supabase Cloud](./DEPLOYMENT-VERCEL-NETLIFY.md) | Same as Vercel: $0 | ~20 min | 🟢 None — browser only | Same as Vercel, just a different host |
| [Cheap VPS + Supabase Cloud](./DEPLOYMENT-MIKRUS.md) | **~$5/mo** for the VPS (Hetzner CAX11, DO basic, etc.); Supabase stays $0 on the free cloud tier | ~45 min | 🟡 Basic — SSH, run a script | Want the app on your own infrastructure but happy keeping the database managed |
| [mikr.us + Supabase Cloud](./DEPLOYMENT-MIKRUS.md) | **~$1/mo** (35 PLN/year mikr.us 1.0); Supabase $0 | ~45 min | 🔴 Intermediate — SSH, PM2 | Absolute cheapest if your time is free |
| [Coolify Cloud + Hetzner](./DEPLOYMENT-COOLIFY.md) | **~$14/mo** ($5 Coolify Cloud + $9 Hetzner CX32). Lets you self-host the Supabase stack on the same VPS — no Supabase Cloud needed | ~30 min | 🟡 Basic — copy SSH key into a VPS | Full control + managed Coolify dashboard, no Supabase Cloud bill ever |
| [Coolify self-hosted + Hetzner](./DEPLOYMENT-COOLIFY.md) | **~$9/mo** (Hetzner CX32, everything else free). Self-hosts the whole stack including Supabase | ~45 min | 🟡 Basic — SSH, a couple of secrets | Full control, no Supabase Cloud bill ever |

**Stripe per-transaction fee** (~2.9% + $0.30) is the same on every path.

**Recommended for non-technical users:** **stay with this guide**. $0/month, and it stays $0 for most small stores for years. You can always migrate to your own VPS later if you want to cut costs further — it's not a one-way door.

**Recommended for someone comfortable with servers and wanting their own infrastructure:** the **~$5/mo VPS + Supabase Cloud free** path. Best balance of cost vs. effort: you keep the managed database, and the app on a cheap VPS gives you full control over the runtime. If you also want to ditch Supabase Cloud entirely, **Coolify self-hosted on Hetzner CX32 (~$9/mo)** runs the whole stack on one box.

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
