**Language:** 🇬🇧 English · [🇵🇱 Polski](./pl/SUPABASE-SETUP.md)

# Setting up Supabase for your Sellf store

Sellf needs a place to store your products, customers, and orders. That place is called **Supabase** — a free service that gives you everything Sellf needs to run. You don't have to install or configure anything technical; Supabase runs on their computers, and Sellf simply talks to it over the internet.

This guide shows you **three ways to set up Supabase**, ordered from easiest (no installing anything, just clicking buttons in your browser) to most technical (using your computer's terminal). Pick the one that matches how comfortable you are with computers.

**All three ways give you exactly the same result** — a working Supabase that Sellf can use. The only difference is how many things you click yourself versus how many a program does for you.

---

## What you'll have when you're done

A Supabase project with five pieces of information you'll paste into Sellf:

1. **Project address** — a web address like `https://abcd1234.supabase.co`
2. **Public key** — a long string starting with `eyJ...` (safe to share, gets used by your customers' browsers)
3. **Private key** — another long string starting with `eyJ...` (**keep this secret** — anyone who has it can read all your store's data)
4. **Project name** — a 16-letter random word (called a "reference")
5. **Database password** — a password you'll create yourself (or one Supabase generates)

You don't need to understand what these mean. You'll just copy them into Sellf's settings and they'll work.

---

## Step 1: Make a Supabase account (do this once, takes 30 seconds)

You only need to do this **one time**. After this, you can create as many Supabase projects as you want without re-registering.

1. Open your browser and go to **https://supabase.com/dashboard**
2. You'll see a page that says "Sign in"
3. Click the big black button that says **"Continue with GitHub"**
   - If you don't have a GitHub account, [make one first](https://github.com/signup) — it's free and takes 1 minute
4. GitHub will ask "Authorize Supabase?" — click **Authorize Supabase**
5. You'll land on your Supabase dashboard (it'll be empty since you have no projects yet)

That's the entire registration. No emails to confirm, no credit card needed, no waiting for approval.

> **Tip:** "GitHub" is just a service for storing code, but Supabase uses it as a quick way to verify who you are. You're not creating any code — you're just using your GitHub username/password to log in to Supabase.

---

## Step 2: Create your Supabase project

Pick **one** of the three options below. Read all three first, then choose the one that fits you best.

### 🟢 Option 1 — Easiest: let Vercel create it for you (no terminal needed)

**Best for:** people who haven't used a terminal before, prefer to click buttons in a browser.

**Time:** about 5 minutes total.

**You will need:** a Vercel account (https://vercel.com — sign in with GitHub, same way as Supabase).

**How it works:** Vercel is the company that will host your Sellf store online. They have a built-in feature that creates a Supabase project for you automatically. You authorize the connection once, click "Create," and Vercel + Supabase handle the rest behind the scenes.

**Step by step:**

1. Open https://vercel.com/dashboard and sign in
2. Click **Add New** (top-right) → **Project**
3. In the search box, type `sellf`
4. Find `jurczykpawel/sellf` in the list and click **Import**
   - If you don't see it, click **Import Third-Party Git Repository** and paste `https://github.com/jurczykpawel/sellf`
5. You'll see a screen asking for "Environment Variables." **Don't fill these in yet** — leave the page open and continue:
6. Open https://vercel.com/dashboard in a **new browser tab** (so you keep the deployment page open)
7. In the new tab, click on the Sellf project you just imported
8. In the project menu, click **Storage** (left sidebar)
9. Click **Connect Database**
10. You'll see a list of database services. Click **Supabase**
11. Click **Continue with Supabase**
12. A small window will pop up asking "Authorize Vercel to access Supabase?" — click **Authorize**
13. Pick:
    - **Project name:** anything, e.g. `my-sellf-store`
    - **Region:** the one closest to where most of your customers live (see the [region table](#which-region-should-i-pick) below)
    - **Database password:** click **"Generate password"** — Supabase will create a strong one for you. **Click the eye icon to reveal it, then copy it into your password manager. Write it down somewhere safe.** You'll need it later if you ever want to change databases.
14. Click **Create**
15. Vercel will say "Setting up your database..." — wait about 2 minutes
16. When it's done, you'll see Supabase listed under Storage with five connected environment variables

You've now created your Supabase project **and** connected it to your Sellf store. Skip to [Step 3: Use what you set up](#step-3-use-what-you-set-up) below.

> **What just happened?** Vercel made an account on Supabase on your behalf (using your authorization), created a Supabase project there, and automatically wrote the five Sellf-needed values into your Vercel project's settings. You'll see the Supabase project in your Supabase dashboard too — it'll show up there because it belongs to your Supabase account.

---

### 🟡 Option 2 — Middle: create Supabase yourself, then copy-paste the values (no terminal needed)

**Best for:** people comfortable with copying long strings between browser tabs.

**Time:** about 8 minutes total.

**You will need:** your Supabase account (from Step 1) and a place where you'll paste the values later (Sellf's deploy form, or [Path 3](#-option-3--most-technical-let-a-script-do-everything-from-your-computer) below).

**Step by step:**

1. Open https://supabase.com/dashboard
2. Click the green **"New project"** button (top-right corner of the dashboard)
3. Fill in:
   - **Name:** something memorable, e.g. `my-sellf-store`
   - **Database Password:** click **"Generate a password"**. When the password appears:
     - **Click the eye icon to make it visible**
     - **Copy it immediately** into your password manager (or paste it into a text file you'll save somewhere safe)
     - You will not be able to see this password again after closing this page (you can reset it, but it's easier to save it now)
   - **Region:** pick the one closest to your customers. See the [region table](#which-region-should-i-pick) below
   - **Pricing Plan:** leave as **Free**
4. Click **"Create new project"** (bottom-right)
5. Supabase will show a screen saying "Setting up project..." — wait about 2 minutes. Don't close the page.
6. When the dashboard loads, look at the URL in your browser. It looks like:
   `https://supabase.com/dashboard/project/abcd1234efgh5678`
   The part after `/project/` (`abcd1234efgh5678` in this example) is your **project reference**. **Write this down too.**
7. In the left sidebar, click the gear icon (**Settings**)
8. Click **API** (in the Settings menu)
9. You'll see a page titled "Project API". It has three pieces of information you need:
   - **Project URL** — looks like `https://abcd1234.supabase.co`. **Copy it.**
   - **Project API keys** section — two long strings:
     - **anon public** — a long string starting with `eyJhbGci...`. **Copy it.** This is the "public key."
     - **service_role** **secret** — another long string starting with `eyJhbGci...`. **Click "Reveal" first**, then copy it. This is the "private key." **Keep this secret. Anyone who has it can read all your store's data.**

You now have everything you need:
- Project URL ✓
- Public key (anon) ✓
- Private key (service_role) ✓
- Project reference (from the URL) ✓
- Database password (you saved it in step 3) ✓

Skip to [Step 3: Use what you set up](#step-3-use-what-you-set-up).

---

### 🔴 Option 3 — Most technical: let a script do everything from your computer

**Best for:** people who have used a terminal/command line before.

**Time:** about 5 minutes total once you've done the one-time setup.

**You will need:** a terminal app (on Mac it's called "Terminal," on Windows it's "PowerShell," on Linux you already know what it is), plus three programs called **CLI tools**.

**One-time setup (only the first time you use this option):**

1. Open your terminal
2. Install three small programs by typing these commands one at a time and pressing Enter:
   ```
   npm install -g vercel supabase
   ```
   (If `npm` isn't installed, install [Node.js](https://nodejs.org/) first — it comes with `npm`.)
3. Install the Stripe tool ([instructions for your operating system](https://docs.stripe.com/stripe-cli#install))
4. Log in to all three by running:
   ```
   vercel login
   supabase login
   stripe login
   ```
   Each will open a browser window asking you to confirm.

**Every time you want a new Sellf store:**

```
git clone https://github.com/jurczykpawel/sellf.git
cd sellf
./scripts/install-vercel.sh
```

The script will ask you for two Stripe keys (you can get them from https://dashboard.stripe.com/test/apikeys — see the deploy guide for details) and then do everything automatically:
- Create a Supabase project for you
- Wait for it to finish setting up
- Get the five Supabase values
- Set up the rest of Sellf
- Print a working web address at the end

You don't have to copy anything between tabs. The script does it all.

If you'd rather have the script reuse an existing Supabase project you already made (via Option 1 or 2), pass the values to it:

```
./scripts/install-vercel.sh \
    --skip-supabase \
    --supabase-url     https://abcd1234.supabase.co \
    --supabase-anon    "<paste public key>" \
    --supabase-svc     "<paste private key>" \
    --supabase-ref     abcd1234 \
    --db-password      "<paste your password>"
```

---

## Step 3: Use what you set up

What you do next depends on which option you picked above:

- **Option 1 (Vercel auto-integration):** open [Vercel/Netlify deploy guide](./DEPLOYMENT-VERCEL-NETLIFY.md) and follow it from **Step 4** onwards (skip the Supabase parts — you've already done them)
- **Option 2 (manual):** open [Vercel/Netlify deploy guide](./DEPLOYMENT-VERCEL-NETLIFY.md) and paste the five values into the deploy form when prompted
- **Option 3 (script):** the script already does everything — your Sellf store is online

---

## Which region should I pick?

Pick the region closest to where most of your customers will be. Choosing the right region makes your Sellf store load 5–10× faster for those customers.

| Where your customers are | Pick this region |
|--------------------------|-------------------|
| Europe | `eu-central-1` Frankfurt |
| United States (East Coast) or globally mixed | `us-east-1` N. Virginia |
| United States (West Coast) | `us-west-1` Oregon |
| Asia (general) | `ap-southeast-1` Singapore |
| Japan / South Korea | `ap-northeast-1` Tokyo |
| Brazil / South America | `sa-east-1` São Paulo |
| Australia / New Zealand | `ap-southeast-2` Sydney |

If you're not sure: pick the country you live in. You can't change the region later without recreating the project, so think about your typical customer.

---

## What you get for free (and what costs money later)

The free Supabase plan is enough for most stores starting out.

| | Free plan | When you'll outgrow it |
|---|---|---|
| **Database size** | 500 MB | A store with 50,000 customers and a year of orders fits easily. Customer-facing data (orders, products, users) is tiny. |
| **File storage** | 1 GB | Only matters if you store your digital products in Supabase. Most operators put product files on cheaper file hosts like Cloudflare R2 or Backblaze B2. |
| **Monthly active users** | 50,000 | "Active" means signed in. Plenty for a typical store. |
| **Number of projects you can have** | 2 active per organization | Most people only ever need one project. If you do testing, you might want a second org (free to make another GitHub login and sign up again). |
| **Inactivity pause** | Pauses after 7 days of zero traffic to the project | Any traffic to your store resets the timer, so for a launched store with even occasional visitors this is rare. |

**When to upgrade to Supabase Pro ($25/month):**

- Your database is approaching 500 MB
- You hit 50,000 monthly active users
- You need automatic daily backups (the free plan only does point-in-time recovery within 7 days)
- You want headroom — the Pro plan also bumps storage to 100 GB and bandwidth limits significantly

You don't need to upgrade to launch. Start free, upgrade when you hit a limit (the Supabase dashboard shows usage graphs so you'll see it coming).

---

## Common questions

### "My Supabase project paused. What do I do?"

If you don't log into your Sellf store for 7 days, Supabase automatically pauses your project to save their costs. Visitors will see errors, no one can sign up, and admins can't log in.

**To wake it up:**
1. Open https://supabase.com/dashboard
2. Find your project (it'll be marked "Paused")
3. Click on it, then click **Restore** at the top
4. Wait about 1 minute

To **prevent** this from happening: either upgrade to Pro, or make sure your Sellf store has at least one visitor per week (any normal traffic counts).

### "What if I forget my database password?"

You don't actually need it most of the time — Sellf doesn't ask for it once you've set everything up. But if you need it to do something special (like move to a different host), you can reset it:

1. Open https://supabase.com/dashboard
2. Click on your project
3. Click the gear icon (Settings) in the left sidebar
4. Click **Database**
5. Find the **Database password** section and click **Reset database password**
6. Save the new password somewhere safe

After resetting, you'll need to update the password in your Sellf settings (the place where you pasted it before) and restart your store.

### "Can I move my Sellf store to a different Supabase project later?"

Yes. You'd:
1. Create a new Supabase project (using any of the three options above)
2. Export the data from the old project (your hosting provider's support can usually help, or run `pg_dump`)
3. Import it into the new one
4. Update your Sellf settings to use the new project's values
5. Restart your store

It's not something you'd do casually but it's not difficult if you need to.

### "I don't want to use a cloud service at all. Can I run Supabase myself?"

Yes, on your own server — see [Coolify deploy guide](./DEPLOYMENT-COOLIFY.md). This is more work but gives you full control over your data. Recommended only if you're already comfortable managing servers.

### "Where do I find the project reference if I missed it?"

Open https://supabase.com/dashboard and click on your project. Look at the address bar in your browser. The URL is something like:

```
https://supabase.com/dashboard/project/abcd1234efgh5678
```

Everything after `/project/` is the project reference (`abcd1234efgh5678` in this example).
