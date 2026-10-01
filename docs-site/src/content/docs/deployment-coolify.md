---
title: "Deploying Sellf to Coolify"
description: "Coolify is a PaaS for managing applications on your own servers. It comes in two flavors:"
---

Coolify is a [PaaS](https://en.wikipedia.org/wiki/Platform_as_a_service) for managing applications on your own servers. It comes in two flavors:

| | Coolify Self-Hosted | Coolify Cloud |
|---|---|---|
| Where the Coolify dashboard runs | On your own VPS | On Coolify's servers |
| Where your Sellf store runs | On your own VPS (same machine as Coolify, or a separate one) | On your own VPS (you connect it to the Cloud dashboard) |
| Cost | Free forever | $5/mo for 2 servers + $3/mo per extra server |
| You manage | Coolify itself + your apps + your servers | Just your apps + your servers (Coolify auto-updates itself) |
| Backups, alerts, auto-update | DIY | Included |
| Best for | DIY tinkerers, complete control, zero recurring cost | People who want managed Coolify but still own their data and hardware |

**Key point common to both:** your Sellf store always runs on a VPS that **you** rent (Hetzner, DigitalOcean, Contabo, etc.). Coolify Cloud doesn't host your apps — it only hosts the control panel. So both options require you to have a server with enough RAM (see Requirements below).

This guide covers both modes. Pick one and follow only the steps for that mode where they differ.

## Why pick Coolify at all?

Pick Coolify if:
- You want everything on your own infrastructure (no Supabase Cloud, no Vercel)
- You're OK with self-hosting Postgres (and your own backups, on self-hosted Coolify)
- You want "deploy and forget" — Coolify handles auto-renew TLS, automatic redeploys on `git push`, container restarts
- You have (or are willing to rent) a VPS with **4 GB+ RAM**. Sellf itself runs from a **published image** (`ghcr.io/jurczykpawel/sellf`) — Coolify pulls it, it doesn't build it, so there's no local Next.js build to OOM. Supabase's own containers are the bulk of the RAM footprint; budget accordingly if you self-host it alongside Sellf.

Pick **Coolify Cloud** if you want all that AND you'd rather not run the Coolify dashboard yourself (auto-updates, backups, email alerts handled for you, ~$5/mo).

Pick **Coolify Self-Hosted** if you want zero recurring software bills (you still pay your VPS provider) AND you're comfortable maintaining the Coolify management UI yourself (`docker compose pull && restart` once a month).

Don't pick Coolify if any of these fit you better:

- **You want free-tier hosting:** Coolify still needs your own VPS, ~$5–10/mo minimum. See [DEPLOYMENT-VERCEL-NETLIFY.md](/deployment-vercel-netlify/) — Vercel + Supabase Cloud both have free tiers.
- **You want the smallest possible footprint:** see [DEPLOYMENT-MIKRUS.md](/deployment-mikrus/) — Sellf alone runs on a $9/year mikr.us VPS without Docker.

## Shortest path — use the StackPilot installer

[StackPilot's `install-coolify.sh`](https://github.com/jurczykpawel/stackpilot/blob/main/apps/sellf/install-coolify.sh) automates this entire guide (it targets Supabase Cloud, not a self-hosted Supabase — see "Self-hosting Supabase too" below if you want both on Coolify). Two invocation styles depending on which Coolify flavor you use:

**Self-hosted Coolify (default):**

```bash
./apps/sellf/install-coolify.sh \
    --ssh-host <vps-alias> \
    --repo-path /path/to/sellf
```

The script installs Coolify on the target (if absent), registers an admin user, generates an API token, creates the application, sets all the env vars, applies database migrations, and creates the Stripe webhook.

**Coolify Cloud:**

```bash
./apps/sellf/install-coolify.sh \
    --coolify-cloud \
    --coolify-token <your-api-token> \
    --server-uuid   <uuid-of-server-already-added-to-cloud> \
    --repo-path /path/to/sellf
```

For Cloud, you've already done the one-time setup in Coolify Cloud (sign in, add your server, generate an API token). The script then just creates the project + app + env vars + Stripe webhook against `https://app.coolify.io/api/v1/...`.

If you prefer the manual flow, or want to self-host Supabase too (not just Sellf), follow the steps below.

## Step 1 — Get Coolify running

### Mode A: Self-hosted (install Coolify on your VPS)

If you don't already have Coolify on a VPS, install it on Debian/Ubuntu:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

After install, open `http://<your-vps-ip>:8000` and complete the first-run wizard (admin email + password). The wizard already adds the host VPS as your first "server" automatically.

Full Coolify install docs: https://coolify.io/docs/installation

### Mode B: Coolify Cloud (sign up + connect a server)

1. Sign up at https://app.coolify.io
2. Pick a plan ($5/mo for 2 servers is enough for one Sellf instance + room to grow)
3. In the Cloud dashboard, click **Servers → New Server**
4. Coolify will give you an SSH public key. Add it to your VPS's `~/.ssh/authorized_keys` (Coolify Cloud needs to SSH into your VPS to deploy apps there)
5. Enter your VPS's IP address in the form and click **Validate**
6. Once validation passes, your server is ready for deployments

For the rest of this guide, the Coolify dashboard URL is `https://app.coolify.io` (Cloud) instead of `http://<your-vps-ip>:8000` (Self-Hosted). All other steps work identically — same UI, same API.

## Step 2 — Get a Supabase project

Sellf needs a Supabase project to talk to. Two options on Coolify:

**Option A — Supabase Cloud (simplest):** create a free project at
https://supabase.com and skip to Step 3. No extra resource inside Coolify.

**Option B — Self-host Supabase on the same Coolify instance:**

1. **Projects → New Project** → name it `sellf` (or reuse an existing project)
2. Inside the project, **New Resource → Service → Supabase** — this is
   Coolify's own one-click template for the official Supabase self-hosted
   stack. Its magic `SERVICE_*` variables auto-generate the JWT secret and
   the `anon`/`service_role` keys for you — no manual JWT signing step.
3. Deploy it, then open the resource's **Environment Variables** tab and
   copy the generated `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   (Coolify may label these `SERVICE_SUPABASEANON_KEY` /
   `SERVICE_SUPABASESERVICE_KEY` — check the exact names on your Coolify
   version), and the public URL Coolify assigned it
   (`SERVICE_URL_SUPABASEKONG` or similar).
4. **Set up the magic-link email templates** before going further — GoTrue's
   default templates don't carry the `token_hash` Sellf's `/auth/callback`
   requires. Add to the Supabase resource's env vars:
   ```env
   GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=https://<your-sellf-domain>/auth-email-templates/magic-link.html
   GOTRUE_MAILER_TEMPLATES_CONFIRMATION=https://<your-sellf-domain>/auth-email-templates/confirmation.html
   GOTRUE_MAILER_TEMPLATES_RECOVERY=https://<your-sellf-domain>/auth-email-templates/recovery.html
   GOTRUE_MAILER_TEMPLATES_INVITE=https://<your-sellf-domain>/auth-email-templates/invite.html
   GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE=https://<your-sellf-domain>/auth-email-templates/email-change.html
   GOTRUE_URI_ALLOW_LIST=https://<your-sellf-domain>/*
   ```
   (These templates ship with Sellf and are served as static files by the
   Sellf container itself — see [full-stack.md](/full-stack/#part-2--magic-link-email-templates)
   for the full explanation.) Also configure SMTP on this resource if you
   haven't already (Coolify's Supabase template exposes the usual
   `SMTP_*` variables).
5. Coolify's Supabase template can lag a couple of months behind upstream
   Supabase releases — that's Coolify's own template, maintained by the
   Coolify team, not something Sellf controls.

## Step 3 — Deploy Sellf

1. Inside the same project: **New Resource → Docker Compose**
2. Point it at the Sellf repo's root `docker-compose.yml`:
   - **Git Repository:** `https://github.com/jurczykpawel/sellf`
   - **Branch:** `main`
   - **Compose File Location:** `docker-compose.yml`
3. Fill in the environment variables Coolify reads from the compose file:
   ```env
   SUPABASE_URL=<the Supabase URL from Step 2>
   SUPABASE_ANON_KEY=<from Step 2>
   SUPABASE_SERVICE_ROLE_KEY=<from Step 2>
   # Only needed if SUPABASE_URL above is Coolify's internal network address
   # rather than a public one:
   # PUBLIC_SUPABASE_URL=<a public URL that reaches the same Supabase gateway>
   SITE_URL=https://<your-coolify-app-domain>
   CHECKOUT_BINDING_SECRET=<openssl rand -base64 32>
   APP_ENCRYPTION_KEY=<openssl rand -base64 32>
   LOGINWALL_SECRET=<openssl rand -hex 32>
   STRIPE_SECRET_KEY=sk_test_…                # or sk_live_… for production
   STRIPE_PUBLISHABLE_KEY=pk_test_…
   # STRIPE_WEBHOOK_SECRET — leave unset; you'll register the webhook from
   # the Sellf admin in Step 5 and the signing secret will land in the DB.
   ```
4. Click **Deploy**. Coolify pulls the published image — no build step, so
   this takes well under a minute once the image layers are cached.
5. **Run migrations once** — this is a manual step, not automatic on
   restart. From your own machine (with `supabase` CLI installed) or a shell
   inside the Sellf container:
   ```bash
   npx supabase db push --db-url "postgresql://postgres:<password>@<supabase-host>:5432/postgres"
   ```
   Do this again any time you upgrade Sellf to a version with new
   migrations, before or right after redeploying.

## Step 4 — Sign up + register Stripe webhook (1 min, 1 click)

After deploy, your app is at `https://<your-coolify-app-domain>`.

1. Open the URL → sign up with your email → click the magic link from your inbox. **The first registered user automatically becomes admin.**
2. In the admin, go to **Settings → Payments** (or `/dashboard/settings`).
3. **API keys card:** paste your Stripe Publishable Key and Secret Key. Saved encrypted to your Supabase DB.
4. **Stripe Webhook card:** click **Register webhook**. Sellf calls Stripe for you — creates the endpoint pointing at `https://<your-domain>/api/webhooks/stripe`, subscribes to all the events it needs, and stores the signing secret encrypted in `stripe_configurations`. No Stripe Dashboard hopping, no env var dance.

> **Env-config alt:** If you'd rather keep secrets in Coolify env vars (e.g. for CI-driven redeploys), use the legacy flow — create the webhook manually at https://dashboard.stripe.com/test/webhooks, paste the `whsec_…` into Coolify's `STRIPE_WEBHOOK_SECRET`, restart. Same outcome.

## Step 5 — Custom domain + TLS

In Coolify dashboard:
1. Open your Sellf application
2. **Domains → Add Domain** → enter your custom domain (e.g. `shop.example.com`)
3. Point your DNS A record at the Coolify VPS IP
4. Coolify auto-provisions a Let's Encrypt cert in ~30 seconds

**Update `SITE_URL`** env var to match the new domain, restart.

## Backup

If you self-hosted Supabase on Coolify (Step 2, Option B), Coolify can't see
inside its Postgres by default — set up your own backups:

```bash
# In Coolify dashboard → your Supabase resource → Backups (if the template exposes it)
# OR via cron on the VPS, targeting that resource's db container:
0 3 * * * docker exec <supabase-db-container> pg_dumpall -U postgres > /backups/sellf-$(date +%F).sql
```

If you used Supabase Cloud (Step 2, Option A), backups are handled for you.

## Update Sellf

In Coolify dashboard:
1. Open your Sellf app
2. **Deployments → Redeploy** — pulls the image tag configured in
   `docker-compose.yml` (bump `SELLF_VERSION` first if you want a newer
   release) and restarts the container
3. **Run any new migrations manually** (see Step 3.5) — Sellf does not run
   migrations automatically on restart

If you want auto-deploy on every `git push` to `main`, enable **Webhooks → GitHub** in Coolify project settings (this only affects the Sellf resource's own repo pointer, not the Supabase resource).

## Troubleshooting

### Postgres container restarts in a loop

Symptom: the Supabase resource's db container keeps restarting, logs say `FATAL: password authentication failed`.

Cause: the Postgres password env var was changed after the first boot. Postgres data dir was initialized with the old password; the new password can't authenticate.

Fix: stop the resource, remove its Postgres volume, redeploy. **Destroys all data** — make sure you have a backup if you're past first-deploy.

### Sellf can't reach Supabase / 500s on every page

Cause: `SUPABASE_URL` points at an address the Sellf container can't actually resolve (e.g. a Coolify-internal hostname that only exists on a different Docker network), or the anon/service-role keys don't match the Supabase project you're pointing at.

Fix: from a shell inside the Sellf container, `curl $SUPABASE_URL/rest/v1/` — a `401`/`200` means the network path works and the issue is the keys; a connection error means the URL itself is wrong. If browsers also need to reach a different (public) address than the server does, set `PUBLIC_SUPABASE_URL` (Step 3).

### "Service quota exceeded" from Coolify

Coolify free tier allows N resources per server. Check the Coolify pricing page — if you're over, either delete unused resources or upgrade.

### Stripe webhooks return 400 "Missing signature"

Same issue as the Vercel/Netlify guide — `STRIPE_WEBHOOK_SECRET` env var doesn't match the Stripe Dashboard's signing secret. Re-copy and restart the container.

---

## Why this isn't published as a "Coolify Template" yet

Coolify supports one-click templates from a marketplace for a single app.
Sellf's own image is trivially template-able (it's one container, one
compose file, a handful of env vars) — the harder part is that a *complete*
one-click experience needs a second resource (Supabase) wired together with
the first, and Coolify's template format doesn't yet have a clean way to
express "deploy resource A, then feed its generated output into resource
B's env vars" across two separate template definitions. Until that exists,
this guide's two manual resources (Step 2 + Step 3) is the practical path.

If someone wants to contribute a combined template or a Coolify "compose
group" that wires the two together, it would be welcome — open an issue.
