---
title: "Sellf - Simple Deploy (Docker + Supabase Cloud)"
description: "Run the published Sellf image with docker compose against Supabase Cloud (or your own Supabase). One container, no build step."
---

**Use this** if you want Docker without self-hosting Supabase — Sellf runs
from the published image, Supabase Cloud (or your own Supabase project)
hosts the database.

## Overview

### What Does It Do?

- Runs **only the Sellf container** (1 container), pulling
  `ghcr.io/jurczykpawel/sellf` — no build step on your server
- Connects to **Supabase Cloud** (or a self-hosted Supabase, see
  [full-stack.md](/full-stack/))
- Does not require nginx (you use your own reverse proxy)
- Simple, lightweight

## Requirements

- VPS with Docker (min. 1 GB RAM)
- Reverse proxy for SSL (Nginx Proxy Manager, Caddy, Traefik)
- Supabase Cloud account (free)
- Stripe account
- Domain

## Step by Step

### 1. Prepare the Server

```bash
# If you don't have Docker yet
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Clone the project (only needed for docker-compose.yml + optional migrations)
cd /opt
git clone https://github.com/jurczykpawel/sellf.git
cd sellf
```

### 2. Create a Project in Supabase Cloud

1. Go to https://supabase.com
2. Create a new project
3. Save:
   - Project URL: `https://abcdef.supabase.co`
   - anon key: `eyJhbGci...`
   - service_role key: `eyJhbGci...`

### 3. Run Database Migrations

Easiest from your own machine with the Supabase CLI:

```bash
npx supabase db push --db-url "postgresql://postgres:<password>@db.abcdef.supabase.co:5432/postgres"
```

Or paste each file under `supabase/migrations/` into the Supabase Dashboard's
**SQL Editor**, in filename order, if you don't have the CLI available.

### 4. Configure SMTP + magic-link templates in Supabase

1. **Settings → Authentication → SMTP Settings** — enable Custom SMTP, fill
   in with SendGrid/Mailgun/etc.
2. **Settings → Authentication → Email Templates** — paste the templates
   from `supabase/templates/*.html` in the Sellf repo (they're what make the
   magic-link URL carry `token_hash`, which `/auth/callback` requires). See
   `supabase/templates/README.md` for the full reference.

### 5. Create the `.env` File

```bash
cp .env.docker.example .env
nano .env
```

Fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`SITE_URL`, the three generated secrets, and your Stripe keys — see the
comments in `.env.docker.example` for exact commands.

**How captcha and magic links work:** the app verifies your captcha provider (ALTCHA or Turnstile) itself before sending any login email; Supabase's own captcha setting is a separate, independent lock on direct calls to its `/auth/v1` endpoints — enable it too when you have a Turnstile account, and verify it with `admin-panel/scripts/verify-auth-captcha.sh <supabase_url> <anon_key>`.

### 6. Start Docker

```bash
docker compose up -d
docker compose logs -f
docker compose ps
```

It should be running at `http://localhost:3000` (or whatever `SELLF_PORT` you set).

### 7. Configure Reverse Proxy for SSL

#### Option A: Nginx Proxy Manager (Recommended)

If you are already using NPM:

1. Add a **Proxy Host**:
   - Domain: `your-domain.com`
   - Forward Hostname: `localhost` (or server IP)
   - Forward Port: `3000` (or your `SELLF_PORT`)
   - Websockets: enabled
   - SSL: Request Let's Encrypt Certificate
   - Force SSL: enabled

#### Option B: Caddy

```bash
sudo apt install -y caddy
sudo nano /etc/caddy/Caddyfile
```

Contents:
```
your-domain.com, www.your-domain.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl restart caddy
```

### 8. Configure Stripe Webhooks

**Easiest path — register from the Sellf admin (after Step 9 below):**

After your first login as admin, open **Settings → Payments** in the Sellf admin. Two cards: paste your Stripe `pk_…` and `sk_…` into the API keys card, then click **Register webhook** in the second card. Sellf creates the endpoint on Stripe for you, subscribes to all the events, and stores the signing secret encrypted in your Supabase DB. No Dashboard hopping, no env-var edits.

**Env-config path** — only needed if you can't (or don't want to) click in the admin (e.g. CI-driven Docker deploys):

1. https://dashboard.stripe.com/webhooks
2. Add endpoint: `https://your-domain.com/api/webhooks/stripe`
3. Events: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `payment_intent.succeeded`, `charge.refunded`, `refund.created`, `refund.updated`, `charge.dispute.created`, `customer.subscription.{created,updated,deleted,trial_will_end,paused,resumed}`, `invoice.{paid,upcoming,payment_succeeded,payment_failed,payment_action_required}`
4. Copy the **Signing secret**
5. Add to `.env` as `STRIPE_WEBHOOK_SECRET`
6. Restart: `docker compose restart`

### 9. First Login

1. Open: `https://your-domain.com/login`
2. Enter email
3. Check email (magic link)
4. Click the link
5. First account = automatically admin!

## Done!

## Monitoring

```bash
docker compose logs -f
docker stats
docker compose ps
curl https://your-domain.com/api/runtime-config
```

## Updating

```bash
cd /opt/sellf

# Bump the version, then:
docker compose pull
docker compose up -d

# Run any new migrations (see Step 3), then check logs:
docker compose logs -f
```

## Troubleshooting

### Problem: Container does not start

```bash
docker compose logs sellf
docker compose config    # confirms every required secret is actually set
cat .env | grep SUPABASE_URL
docker compose restart
```

### Problem: Cannot log in

1. Check SMTP in Supabase Dashboard
2. Check Auth logs in Supabase
3. Check spam folder
4. Check `GOTRUE_URI_ALLOW_LIST` in Supabase Settings
5. Check the magic-link email template actually carries `token_hash` (Step 4)

### Problem: Stripe webhook is not working

```bash
curl -X POST https://your-domain.com/api/webhooks/stripe
docker compose logs sellf | grep stripe
grep STRIPE_WEBHOOK_SECRET .env
```

### Problem: 502 Bad Gateway

1. Check if the container is running: `docker compose ps`
2. Check if the port is available: `netstat -tlnp | grep 3000`
3. Check reverse proxy config

## File Structure

```
/opt/sellf/
├── docker-compose.yml      ← THIS IS THE FILE YOU USE
├── .env                    ← Your production configuration
└── supabase/
    ├── migrations/         ← Migrations (run against Supabase Cloud)
    └── templates/          ← Magic-link email templates (Step 4)
```

## Security

Check before starting:

- [ ] `.env` has permissions 600: `chmod 600 .env`
- [ ] `.env` is NOT in Git
- [ ] SSL/HTTPS is working
- [ ] Firewall is configured (only 22, 80, 443)
- [ ] Passwords are long and random
- [ ] Stripe webhooks have a secret
- [ ] Supabase backups are enabled (automatic in Cloud)

## Monthly Costs

- **VPS** (1-2GB RAM): ~$5-10
- **Supabase Cloud Free**: $0 (up to 500MB database)
- **Stripe**: 0% + 2.9% + $0.30 per transaction
- **Domain**: ~$1/month

**Total**: ~$6-11/month

## Advantages of This Approach

- **Simplest Docker path** — no build step, pulls a signed, published image
- **Lightweight** — only 1 container
- **Cheap** — minimal resources
- **Easy to update** — `docker compose pull && docker compose up -d`
- **Supabase Cloud** — automatic backups and monitoring

## Other Deployment Options

If you need more control:

- **[full-stack.md](/full-stack/)**: Self-hosted Supabase too (official installer), same Sellf container
- **[deployment.md](/deployment/)**: Comparison of all deployment options

---

**Questions? Open an issue on GitHub!**
