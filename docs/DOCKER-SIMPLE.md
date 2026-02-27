# Sellf - Simple Deploy (Using Existing Setup)

**THIS IS THE RECOMMENDED OPTION** if you are already testing `admin-panel/docker-compose.yml` on your server!

## Overview

Are you already using `admin-panel/docker-compose.yml` for testing? Great! You can use the same file in production. This is the simplest solution.

### What Does It Do?

- Runs **only Admin Panel** (1 container)
- Connects to **Supabase Cloud** (or local Supabase)
- Does not require nginx (you use your own reverse proxy)
- Simple, lightweight, proven

## Requirements

- VPS with Docker (min. 2GB RAM)
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

# Clone the project
cd /opt
git clone https://github.com/your-org/sellf.git
cd sellf/admin-panel
```

### 2. Create a Project in Supabase Cloud

1. Go to https://supabase.com
2. Create a new project
3. Save:
   - Project URL: `https://abcdef.supabase.co`
   - anon key: `eyJhbGci...`
   - service_role key: `eyJhbGci...`

### 3. Run Database Migrations

In Supabase Dashboard:

1. Go to **SQL Editor**
2. Copy the contents of `supabase/migrations/20250709000000_initial_schema.sql`
3. Paste and run
4. Repeat for all migrations

### 4. Configure SMTP in Supabase

1. **Settings** → **Authentication** → **SMTP Settings**
2. Enable Custom SMTP
3. Fill in with SendGrid/Mailgun details

### 5. Create the `.env` File

```bash
cd /opt/sellf/admin-panel
nano .env
```

Contents:

```env
# ===========================================
# Sellf - Production (admin-panel/docker-compose.yml)
# ===========================================

# App
APP_ENV=production
PORT=3000
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1

# Supabase Cloud
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# URLs
NEXT_PUBLIC_BASE_URL=https://your-domain.com
NEXT_PUBLIC_SITE_URL=https://your-domain.com
MAIN_DOMAIN=your-domain.com

# Cloudflare Turnstile (CAPTCHA)
NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
CLOUDFLARE_TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

### 6. Create `.stripe` (Optional)

```bash
cp .stripe.example .stripe
nano .stripe
# Fill in as needed
```

### 7. Start Docker

```bash
# Build and start
docker compose up -d

# Check logs
docker compose logs -f

# Check status
docker compose ps
```

It should be running at `http://localhost:3000`

### 8. Configure Reverse Proxy for SSL

#### Option A: Nginx Proxy Manager (Recommended)

If you are already using NPM:

1. Add a **Proxy Host**:
   - Domain: `your-domain.com`
   - Forward Hostname: `localhost` (or server IP)
   - Forward Port: `3000`
   - Websockets: enabled
   - SSL: Request Let's Encrypt Certificate
   - Force SSL: enabled

#### Option B: Caddy

```bash
# Install Caddy
sudo apt install -y caddy

# Configuration
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

### 9. Configure Stripe Webhooks

1. https://dashboard.stripe.com/webhooks
2. Add endpoint: `https://your-domain.com/api/webhooks/stripe`
3. Events:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
4. Copy the **Signing secret**
5. Add to `.env` as `STRIPE_WEBHOOK_SECRET`
6. Restart: `docker compose restart`

### 10. First Login

1. Open: `https://your-domain.com/login`
2. Enter email
3. Check email (magic link)
4. Click the link
5. First account = automatically admin!

## Done!

Your application is running in production using the same setup as for testing!

## Monitoring

```bash
# Check logs
docker compose logs -f

# Check resource usage
docker stats

# Check status
docker compose ps

# Test API
curl https://your-domain.com/api/runtime-config
```

## Updating

```bash
cd /opt/sellf/admin-panel

# Stop
docker compose down

# Pull changes
git pull

# Rebuild
docker compose build --no-cache

# Start
docker compose up -d

# Check logs
docker compose logs -f
```

## Troubleshooting

### Problem: Container does not start

```bash
# Check logs in detail
docker compose logs admin-panel

# Check if .env is correct
cat .env | grep SUPABASE_URL

# Restart
docker compose restart
```

### Problem: Cannot log in

1. Check SMTP in Supabase Dashboard
2. Check Auth logs in Supabase
3. Check spam folder
4. Check `GOTRUE_URI_ALLOW_LIST` in Supabase Settings

### Problem: Stripe webhook is not working

```bash
# Test endpoint
curl -X POST https://your-domain.com/api/webhooks/stripe

# Check logs
docker compose logs admin-panel | grep stripe

# Check webhook secret in .env
grep STRIPE_WEBHOOK_SECRET .env
```

### Problem: 502 Bad Gateway

1. Check if the container is running: `docker compose ps`
2. Check if port 3000 is available: `netstat -tlnp | grep 3000`
3. Check reverse proxy config

## File Structure

```
/opt/sellf/
├── admin-panel/
│   ├── docker-compose.yml  ← THIS IS THE FILE YOU USE
│   ├── .env                ← Your production configuration
│   ├── .stripe             ← Optional Stripe configuration
│   ├── Dockerfile          ← Automatically used by docker-compose
│   └── src/
├── supabase/
│   └── migrations/         ← Migrations (run in Supabase Cloud)
└── ...
```

### About the Dockerfile

Your `admin-panel/Dockerfile` is **correct and does not require changes**!

**How it works:**
- Next.js standalone reads `NEXT_PUBLIC_*` variables at runtime from `.env`
- NO build args needed - variables are passed when the container starts
- If you change `.env`, just `docker compose restart` (no rebuild needed!)

**Node 20 vs Node 18:**
- Dockerfile uses Node 20 (latest LTS) - this is good!
- If you have issues, you can switch back to Node 18 by changing the first line:
  ```dockerfile
  FROM node:18-alpine AS base
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

- **VPS** (2GB RAM): ~$5-10
- **Supabase Cloud Free**: $0 (up to 500MB database)
- **Stripe**: 0% + 2.9% + $0.30 per transaction
- **Domain**: ~$1/month

**Total**: ~$6-11/month

## Advantages of This Approach

- **Simplest** - you use what you already know
- **Proven** - you are already testing this locally
- **Lightweight** - only 1 container
- **Cheap** - minimal resources
- **Easy to update** - git pull + rebuild
- **Supabase Cloud** - automatic backups and monitoring

## Other Deployment Options

If you need more control:

- **`docker-compose.fullstack.yml`**: Full self-hosted stack (11 containers)
  - For enterprise, compliance (GDPR data residency), high traffic
  - See: **`DEPLOYMENT.md`**

- **`DOCKER-COMPOSE-GUIDE.md`**: Comparison of all deployment options

---

**Questions? Open an issue on GitHub!**
