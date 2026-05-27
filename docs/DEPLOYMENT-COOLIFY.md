# Deploying Sellf to Coolify (self-hosted, true one-click)

Coolify is a self-hosted PaaS (think Vercel/Heroku, but on your own VPS). It can run Sellf alongside its **own** Supabase instance from a single Docker Compose file — no external Supabase account, no manual Stripe webhook chicken-egg dance, no per-deploy env var data entry.

This is the path closest to "click and it works" for Sellf.

Time required: **~10 minutes** once Coolify is installed.

## When this is the right choice

Pick Coolify if:
- You have a VPS with **8 GB+ RAM**. The build itself needs ~3 GB free for `bun run build` on Next.js 16 with Turbopack; on a 4 GB VPS Coolify + Postgres + Redis already eat ~1 GB, leaving the build to OOM. Verified 2026-05-27: 4 GB Hetzner CX22 OOM-kills the build; 8 GB Hetzner CX32 builds in ~8 minutes and serves successfully.
- You want everything on your own infrastructure (no Supabase Cloud, no Vercel)
- You're OK self-hosting Postgres (and your own backups)
- You want a real "deploy and forget" — Coolify handles auto-renew TLS, updates, restarts

Pick Vercel/Netlify ([DEPLOYMENT-VERCEL-NETLIFY.md](./DEPLOYMENT-VERCEL-NETLIFY.md)) if:
- You want free-tier hosting (Coolify needs your own VPS, ~$5–10/mo minimum)
- You prefer managed Supabase (Coolify runs your Supabase but you own its uptime)

Pick PM2/mikr.us ([DEPLOYMENT-MIKRUS.md](./DEPLOYMENT-MIKRUS.md)) if:
- You want the smallest possible footprint (Sellf alone, ~500 MB RAM, $9/year VPS)
- You already use Supabase Cloud separately

## Step 1 — Install Coolify

If you don't already have Coolify on a VPS, install it on Debian/Ubuntu:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

After install, open `http://<your-vps-ip>:8000` and complete the first-run wizard (admin email + password). Add your VPS as a "server" in Coolify's UI.

Full Coolify install docs: https://coolify.io/docs/installation

## Step 2 — Create the application

In Coolify dashboard:

1. **Projects → New Project** → name it `sellf`
2. Inside the project, **New Resource → Public Repository**
3. Paste:
   - **Git Repository:** `https://github.com/jurczykpawel/sellf`
   - **Branch:** `main`
   - **Build Pack:** `Docker Compose`
   - **Compose File Location:** `docker-compose.fullstack.yml`
4. Click **Continue**

## Step 3 — Set environment variables

Coolify will read the compose file and ask for env vars referenced in it. You'll need to fill in:

### Generated locally (run in your terminal first)

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-24)"
echo "JWT_SECRET=$(openssl rand -base64 32)"
echo "ANON_KEY=<generate via supabase JWT signing tool, see Step 3.1>"
echo "SERVICE_ROLE_KEY=<same>"
echo "CHECKOUT_BINDING_SECRET=$(openssl rand -base64 32)"
echo "APP_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "LOGINWALL_SECRET=$(openssl rand -hex 32)"
```

### Step 3.1 — Generate Supabase JWT keys

Self-hosted Supabase needs an `ANON_KEY` and `SERVICE_ROLE_KEY` signed with your `JWT_SECRET`. Use Supabase's online tool: https://supabase.com/docs/guides/self-hosting#api-keys (the page has a built-in generator). Or run locally:

```bash
JWT_SECRET="<your value from above>"
# anon key:
docker run --rm -i node:20-alpine sh -c "npm i -g jsonwebtoken-cli && jwt encode --secret '$JWT_SECRET' '{\"role\": \"anon\", \"iss\": \"supabase\"}'"
# service_role key:
docker run --rm -i node:20-alpine sh -c "npm i -g jsonwebtoken-cli && jwt encode --secret '$JWT_SECRET' '{\"role\": \"service_role\", \"iss\": \"supabase\"}'"
```

### Pasted into Coolify

```
POSTGRES_PASSWORD=<from step 3>
JWT_SECRET=<from step 3>
ANON_KEY=<from step 3.1>
SERVICE_ROLE_KEY=<from step 3.1>
SUPABASE_URL=http://kong:8000              # internal Docker network
SUPABASE_ANON_KEY=<same as ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<same as SERVICE_ROLE_KEY>
SITE_URL=https://<your-coolify-app-domain>
STRIPE_SECRET_KEY=sk_test_…                # or sk_live_… for production
STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_WEBHOOK_SECRET=whsec_PLACEHOLDER     # replace in Step 5
CHECKOUT_BINDING_SECRET=<from step 3>
APP_ENCRYPTION_KEY=<from step 3>
LOGINWALL_SECRET=<from step 3>
TRUSTED_PROXY=true
```

## Step 4 — Deploy

Click **Deploy** in Coolify. First deploy takes 5–10 minutes (it builds Sellf's Next.js bundle and pulls Supabase images). Coolify shows live build logs.

**No separate migration step** — `docker-compose.fullstack.yml` mounts `./supabase/migrations` into the Postgres container's `/docker-entrypoint-initdb.d`, so migrations run automatically on first boot. This is the main reason Coolify is closer to true one-click than Vercel/Netlify.

## Step 5 — Stripe webhook

After deploy, your app is at `https://<your-coolify-app-domain>`. Set up the webhook the same way as the Vercel/Netlify guide:

1. https://dashboard.stripe.com/test/webhooks → **Add endpoint**
2. **URL:** `https://<your-domain>/api/webhooks/stripe`
3. **Events:** see [DEPLOYMENT-VERCEL-NETLIFY.md Step 7](./DEPLOYMENT-VERCEL-NETLIFY.md#step-7--wire-up-the-stripe-webhook-3-min)
4. Copy the `whsec_…` signing secret
5. In Coolify: **Environment Variables → STRIPE_WEBHOOK_SECRET** → paste the real value → **Save**
6. **Restart** the application from Coolify dashboard

## Step 6 — Custom domain + TLS

In Coolify dashboard:
1. Open your Sellf application
2. **Domains → Add Domain** → enter your custom domain (e.g. `shop.example.com`)
3. Point your DNS A record at the Coolify VPS IP
4. Coolify auto-provisions a Let's Encrypt cert in ~30 seconds

**Update `SITE_URL`** env var to match the new domain, restart.

## Backup

Coolify can't see inside the Sellf Supabase. Set up your own backups:

```bash
# In Coolify dashboard → your project → Backups
# OR via cron on the VPS:
0 3 * * * docker exec sellf-db pg_dumpall -U postgres > /backups/sellf-$(date +%F).sql
```

For S3-compatible offsite backups, see [vault/brands/_shared/infra/INDEX.md](https://github.com/jurczykpawel/) for the backup-host-restic.sh pattern.

## Update Sellf

In Coolify dashboard:
1. Open your Sellf app
2. **Deployments → Redeploy** — pulls latest `main` from GitHub, rebuilds
3. Migrations in newer Sellf versions run automatically on container restart (idempotent)

If you want auto-deploy on every `git push` to `main`, enable **Webhooks → GitHub** in Coolify project settings.

## Troubleshooting

### Postgres container restarts in a loop

Symptom: `sellf-db` container keeps restarting, logs say `FATAL: password authentication failed`.

Cause: `POSTGRES_PASSWORD` env var was changed after the first boot. Postgres data dir was initialized with the old password; the new password can't authenticate.

Fix: stop the stack, `docker volume rm sellf_postgres_data`, redeploy. **Destroys all data** — make sure you have a backup if you're past first-deploy.

### Kong API gateway returns 404 on every request

Cause: missing or invalid `supabase/kong.yml` file in the repo. The compose mounts it read-only.

Fix: check the file exists at the path `docker-compose.fullstack.yml` expects (`./supabase/kong.yml`).

### "Service quota exceeded" from Coolify

Coolify free tier allows N resources per server. Check the Coolify pricing page — if you're over, either delete unused resources or upgrade.

### Build OOM-kills `bun` on a 4 GB VPS

Symptom: Coolify shows the deploy as "in progress" but the build container disappears with no error in the UI logs. `dmesg` on the host shows:

```
Out of memory: Killed process <pid> (bun) total-vm:76GB ...
```

Cause: Next.js 16 + Turbopack + `bun run build` peaks around 3 GB resident, and Coolify's own services + Postgres + Redis already use ~1 GB. A 4 GB VPS doesn't fit.

Fix: upgrade to **8 GB+** (Hetzner CX32, Contabo VPS 200, Linode g6-standard-2, etc.) and redeploy. Or build the image elsewhere and let Coolify just pull it (see "Build server" in Coolify settings).

### Stripe webhooks return 400 "Missing signature"

Same issue as the Vercel/Netlify guide — `STRIPE_WEBHOOK_SECRET` env var doesn't match the Stripe Dashboard's signing secret. Re-copy and restart the container.

---

## Why this isn't published as a "Coolify Template" yet

Coolify supports one-click templates from a marketplace. Sellf doesn't have one yet because:

- The fullstack compose file uses Supabase images that need JWT-signed keys (Step 3.1) — Coolify's template format doesn't have native support for "generate this JWT, sign with that other generated value." You'd still need the manual JWT step.
- Supabase Self-Hosted is a moving target (auth/realtime/storage versions change). The fullstack compose pins to known-good versions; a template would need maintenance.

If someone wants to contribute a Coolify template that bundles a JWT-signing init container, it would be welcome — open an issue.
