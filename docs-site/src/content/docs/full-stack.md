---
title: "Sellf - Self-Hosted Supabase + Docker"
description: "Full control over your infrastructure: official self-hosted Supabase plus the Sellf container, both on your own server."
---

This guide is for people who want **zero dependency on any cloud database
provider** — data residency requirements (GDPR), an air-gapped/offline
environment, or simply the preference to own the whole stack. Everything runs
in Docker, on a server you control.

**Sellf itself does not bundle Supabase.** You stand up Supabase with its own
official installer (a separate, independently-maintained project that ships
its own updates roughly every two weeks), then point a single small Sellf
container at it. This used to be a single `docker-compose.fullstack.yml` that
tried to bundle both — it's gone (see [Migrating from
`docker-compose.fullstack.yml`](#migrating-from-docker-composefullstackyml)
below if you're on it). Splitting the two means Supabase's own installer keeps
Postgres/GoTrue/PostgREST/Storage patched, and Sellf only has to track its own
image tag.

If you'd rather not run Postgres yourself, use [Supabase
Cloud](/supabase-setup/) with [DEPLOYMENT-COOLIFY.md](/deployment-coolify/) or
[DEPLOYMENT-MIKRUS.md](/deployment-mikrus/) instead — much less to maintain.

## Table of Contents

- [Requirements](#requirements)
- [Part 1 — Self-hosted Supabase](#part-1--self-hosted-supabase)
- [Part 2 — Magic-link email templates](#part-2--magic-link-email-templates)
- [Part 3 — Run Sellf](#part-3--run-sellf)
- [Domain and SSL](#domain-and-ssl)
- [Stripe webhook](#stripe-webhook)
- [First login](#first-login)
- [Updating](#updating)
- [Backup](#backup)
- [Migrating from `docker-compose.fullstack.yml`](#migrating-from-docker-composefullstackyml)
- [Troubleshooting](#troubleshooting)

## Requirements

- A Linux server with Docker + Docker Compose v2, **8 GB+ RAM** recommended
  when Supabase and Sellf run on the same box (Supabase alone is ~6-8
  containers; add Sellf and a reverse proxy)
- A domain (or two — one for Sellf, one for Supabase's API, can be
  subdomains of the same domain) with DNS you can point at the server
- A Stripe account
- Comfortable reading shell scripts and editing `.env` files — this path
  trades convenience for control

## Part 1 — Self-hosted Supabase

Use Supabase's own installer — Sellf does not fork or vendor it, so follow
the upstream docs for anything installer-specific:
<https://supabase.com/docs/guides/self-hosting/docker>.

```bash
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
```

1. **Generate secrets** — the repo ships `./utils/generate-keys.sh` (or
   follow the manual JWT steps in the upstream guide) to fill in
   `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`,
   `DASHBOARD_PASSWORD`, etc. in `.env`.
2. **Set your public URLs** — `API_EXTERNAL_URL`, `SITE_URL`, and
   `SUPABASE_PUBLIC_URL` in `.env` to whatever domain you're pointing at this
   stack (e.g. `https://api.your-shop.example.com`).
3. **Put a reverse proxy in front** (Caddy/nginx/Traefik) terminating TLS and
   forwarding to the gateway container's port (Kong or Envoy, depending on
   the Supabase version you pulled — check `docker compose ps` after step 4).
4. **Start it:**
   ```bash
   docker compose up -d
   docker compose ps   # everything should report healthy after a minute or two
   ```
5. **Run Sellf's migrations against it** — from the Sellf repo, not the
   Supabase one:
   ```bash
   npx supabase db push --db-url "postgresql://postgres:<POSTGRES_PASSWORD>@<supabase-host>:5432/postgres"
   ```
   This is a one-time step per install. Later Sellf releases that ship new
   migrations are applied the same way, or via the in-app updater
   (`admin-panel/scripts/upgrade.sh`) if you're running the standard release
   tarball flow on top.

Supabase's self-hosted stack changes over time (new component versions,
occasionally a new default database major version) — that's an upstream
concern, tracked and upgraded via **their** `update.sh` and any migration
notes in their release changelog, not something Sellf's docs replicate here.

## Part 2 — Magic-link email templates

Sellf's login is a magic link, and `/auth/callback` requires the link to
carry `token_hash` — GoTrue's **default** email templates don't do that.
Without this step, self-hosted login will not work.

Point GoTrue at Sellf's own templates, which it serves as static files at
`/auth-email-templates/*.html` (no server code, no secrets in them):

```env
# In the Supabase stack's .env, alongside SITE_URL etc.:
GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=https://your-shop.example.com/auth-email-templates/magic-link.html
GOTRUE_MAILER_TEMPLATES_CONFIRMATION=https://your-shop.example.com/auth-email-templates/confirmation.html
GOTRUE_MAILER_TEMPLATES_RECOVERY=https://your-shop.example.com/auth-email-templates/recovery.html
GOTRUE_MAILER_TEMPLATES_INVITE=https://your-shop.example.com/auth-email-templates/invite.html
GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE=https://your-shop.example.com/auth-email-templates/email-change.html

# Also required so GoTrue accepts redirects back to your Sellf domain:
GOTRUE_URI_ALLOW_LIST=https://your-shop.example.com/*
```

Restart the Supabase auth container after editing `.env`. See
[`supabase/templates/README.md`](https://github.com/jurczykpawel/sellf/blob/main/supabase/templates/README.md)
in the Sellf repo for the full template reference (also used for Supabase
Cloud, which reads the same HTML through its dashboard/Management API
instead of a URL).

You also need working SMTP configured on the Supabase side
(`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_ADMIN_EMAIL` in its
`.env`) — GoTrue sends the email, Sellf only supplies the template.

## Part 3 — Run Sellf

From the Sellf repo, use the root `docker-compose.yml` (a single container,
pulling the published image — no build step needed):

```bash
git clone https://github.com/jurczykpawel/sellf
cd sellf
cp .env.docker.example .env
```

Fill in `.env`:

```env
SUPABASE_URL=https://api.your-shop.example.com          # the Supabase stack from Part 1
SUPABASE_ANON_KEY=<ANON_KEY from the Supabase .env>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from the Supabase .env>
SITE_URL=https://your-shop.example.com
CHECKOUT_BINDING_SECRET=<openssl rand -base64 32>
APP_ENCRYPTION_KEY=<openssl rand -base64 32>
LOGINWALL_SECRET=<openssl rand -hex 32>
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
```

```bash
docker compose up -d
docker compose ps    # sellf should report healthy within ~30s
```

`docker compose config` refuses to run with any of the required secrets
still blank, with a message telling you which one and how to generate it —
that's intentional, it's cheaper to fail here than after a broken deploy.

## Domain and SSL

Put a reverse proxy in front of the Sellf container the same way you did for
Supabase's gateway — one option:

```
your-shop.example.com {
    reverse_proxy localhost:3000
}
```

(Caddy example; nginx/Traefik/Nginx Proxy Manager work the same way — forward
to whatever host/port you bound in `docker-compose.yml`'s `SELLF_PORT`.)

## Stripe webhook

After first login (see below), go to **Settings → Payments** in the Sellf
admin and click **Register webhook** — Sellf creates the Stripe endpoint,
subscribes to the events it needs, and stores the signing secret encrypted in
the database. No manual Stripe Dashboard step needed.

## First login

1. Open `https://your-shop.example.com/login`
2. Enter your email, click the magic link (see Part 2 if it doesn't arrive
   with a working link)
3. First registered user becomes admin automatically

## Updating

Two independent things to update:

- **Supabase** — follow the upstream project's own `update.sh` /
  upgrade notes for the self-hosted stack. This is entirely outside Sellf's
  release cycle.
- **Sellf** — bump `SELLF_VERSION` in `.env` (or override it at the shell:
  `SELLF_VERSION=2026.10.0 docker compose up -d`) to pull a newer image, then
  run any new migrations with `npx supabase db push --db-url ...` (or the
  in-app updater if you installed via the release tarball elsewhere).

## Backup

Supabase's data lives in its own Postgres container — back it up the same
way regardless of how you run Sellf:

```bash
#!/bin/bash
# Run from the Supabase stack's docker/ directory
BACKUP_DIR=/opt/backups/sellf
mkdir -p "$BACKUP_DIR"
docker compose exec -T db pg_dumpall -U postgres > "$BACKUP_DIR/sellf-$(date +%F).sql"
find "$BACKUP_DIR" -name "*.sql" -mtime +7 -delete
```

Add it to cron (e.g. daily at 2 AM: `0 2 * * * /opt/backups/backup.sh`), and
also back up the `storage_data` volume if you use Supabase Storage for file
delivery.

**Restore:**

```bash
docker compose exec -T db psql -U postgres < /opt/backups/sellf/sellf-2026-09-01.sql
```

## Migrating from `docker-compose.fullstack.yml`

If you have an older Sellf checkout with `docker-compose.fullstack.yml`,
that file is gone starting with this release. It bundled a broken Supabase
setup (the database's own initialization was silently skipped after the
first restart) — anyone running it either already patched it by hand or
never had a working self-hosted install from it in the first place.

1. **Back up first:** `docker exec <your-db-container> pg_dumpall -U postgres > sellf-backup.sql` — plus the `storage_data` volume if used.
2. **Stand up an official Supabase self-hosted stack** (Part 1 above) or
   Supabase Cloud.
3. **Restore your data** into the new Supabase: `psql` the dump into the new
   Postgres (`--schema=public --schema=auth`), then run Sellf's own
   migrations with `npx supabase db push --db-url ...` to make sure the
   schema matches what the new Sellf version expects.
4. **Point Sellf at the new Supabase** — update `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in your `.env`.
   **Keep `APP_ENCRYPTION_KEY` identical to what you had** — it decrypts
   every secret already stored in your database (Stripe keys, webhook
   signing secrets); rotating it makes those unreadable.
5. If a different Supabase project means a different `JWT_SECRET`, existing
   sessions log out — expected, users just sign in again.
6. **Not ready to migrate?** Pin your deployment to Sellf `v2026.9.2` — the
   last release that shipped `docker-compose.fullstack.yml` — until you can.
   You won't get newer Sellf releases on that pin.

## Troubleshooting

### Sellf container is unhealthy / won't start

```bash
docker compose logs sellf
docker compose config   # confirms every required secret is actually set
```

### Magic link email doesn't arrive or the link doesn't log you in

1. Check SMTP is actually configured on the Supabase side
   (`docker compose logs auth` in the Supabase stack)
2. Confirm `GOTRUE_MAILER_TEMPLATES_MAGIC_LINK` (Part 2) is set and the URL
   is publicly reachable — `curl` it from the Supabase server
3. Confirm `GOTRUE_URI_ALLOW_LIST` includes your Sellf domain
4. Check spam folder

### Stripe payments don't work

```bash
docker compose logs sellf | grep -i stripe
```

Confirm the webhook is registered (Settings → Payments in the admin) and
that `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` match the mode (test vs
live) of the checkout you're testing.

### Running low on disk

```bash
docker system df
docker image prune -a
docker volume prune
```

## Security checklist

- [ ] `.env` files (Sellf and Supabase) are not in Git, permissions `600`
- [ ] SSL/HTTPS enabled on both the Sellf domain and the Supabase API domain
- [ ] Firewall allows only 22/80/443
- [ ] `APP_ENCRYPTION_KEY`, `CHECKOUT_BINDING_SECRET`, `LOGINWALL_SECRET` generated with the commands above, not left as placeholders
- [ ] Backups scheduled and tested with an actual restore
- [ ] Supabase Studio (`SUPABASE_PUBLIC_URL`'s dashboard) is not publicly reachable without a password
