---
title: "Deployment Options"
description: "This page lists every supported way to put Sellf online, ordered from easiest (just clicks in a browser) to most technical (terminal commands on a…"
---

This page lists every supported way to put Sellf online, ordered from easiest (just clicks in a browser) to most technical (terminal commands on a server). All produce a working Sellf store.

## 👋 First time? Start here

**[QUICK-START.md](/quick-start/)** — Click-by-click walkthrough using only your web browser. No terminal needed. Deploys to Vercel + Supabase + Stripe in ~20 minutes. **This is the easiest path for non-technical users.**

## Supabase setup (called by all the deploy guides)

**[SUPABASE-SETUP.md](/supabase-setup/)** — Explains the three ways to set up the database Sellf uses (browser-only, copy-paste, or via script). Read this if you're not sure which Supabase option to pick in any of the guides below.

## Other deployment guides

Pick one based on what you want.

---

### [DEPLOYMENT-VERCEL-NETLIFY.md](/deployment-vercel-netlify/) — Vercel or Netlify (managed cloud)
**Use if you need:**
- The simplest managed path — no server to maintain
- Free tier to start
- Vercel or Netlify hosts the app, Supabase hosts the database

**Requirements:** none on your side, everything in the cloud, ~15-20 min setup

---

### [DEPLOYMENT-COOLIFY.md](/deployment-coolify/) — Coolify (self-hosted)
**Use if you need:**
- Sellf on your own VPS, pulling a published image (no build step)
- Optionally self-host Supabase too, via Coolify's own Supabase template
- Auto TLS + GitHub auto-deploy on push

**Requirements:** 4GB+ RAM VPS (more if self-hosting Supabase alongside Sellf), Coolify installed (free), 10 min setup. Migrations run once per release, not automatically on every restart — see guide.

---

### [DEPLOYMENT-MIKRUS.md](/deployment-mikrus/) — VPS / mikr.us via PM2
**Use if you need:**
- The cheapest path (35 PLN/year on mikr.us)
- Full control of the server
- Lightweight deploy without Docker

**Requirements:** Linux VPS with 1 GB+ RAM, basic terminal skills

---

### [FULL-STACK.md](/full-stack/) — Self-Hosted Supabase + Docker
**Use if you need:**
- Full control over all infrastructure (Sellf's own container plus the official self-hosted Supabase stack)
- Self-hosted Supabase (no cloud dependency)
- GDPR compliance (data residency requirements)
- High traffic (1M+ requests/month)

**Requirements:** 8GB+ RAM, DevOps experience, 2-3 hours setup, ~$50-100/month

---

### [PM2-VPS.md](/pm2-vps/) — Advanced PM2
**Use if you need:**
- Cluster mode (multi-core utilization)
- Zero-downtime deployments
- Advanced monitoring (PM2+, Prometheus, Grafana)
- Auto-scaling, log rotation, CPU/memory profiling

**Requirements:** PM2 expertise, 4GB+ RAM

**Note:** For basic PM2 setup, see [DEPLOYMENT-MIKRUS.md](/deployment-mikrus/).

---

### [DOCKER-SIMPLE.md](/docker-simple/) — Simple Docker
**Use if you:**
- Want to run Sellf's published image via `docker compose` against Supabase Cloud (or your own Supabase)
- Need more detailed explanation than the main guide

---

### [UPSTASH-REDIS.md](/upstash-redis/) — Optional Redis Caching
**Use if you want:**
- 10x faster config queries (50-100ms → 5-10ms)
- 50-70% reduced database load
- Free tier: 10,000 req/day

---

## Verifying a release build

Every GitHub release publishes `sellf-build.tar.gz`, a small manifest
(`sellf-build.manifest`) and an Ed25519 signature of that manifest
(`sellf-build.manifest.sig`) made by the project's release pipeline, plus a plain
`sellf-build.tar.gz.sha256` checksum. The manifest has exactly two lines, and its
version is the release tag without the leading `v`:

```
version=2026.10.0
sha256=<SHA-256 of sellf-build.tar.gz, 64 lowercase hex characters>
```

The built-in self-upgrade (`upgrade.sh`, also used by the in-app update) checks the
signature with the public key built into the version you already run, refuses a
release older than the installed one (versions compare as numbers, so `2026.10.0`
is newer than `2026.9.10`), and checks the archive against the signed hash before
extracting anything. Installing the same version again is a reinstall and goes
through the same checks. A release
with a missing or invalid signature, or an older version, is never installed, and
there is no setting that changes this.

To check a download yourself you only need OpenSSL 1.1.1 or newer:

```bash
V=v2026.10.0   # the release tag you downloaded
for f in sellf-build.tar.gz sellf-build.manifest sellf-build.manifest.sig; do
  curl -fsSLO "https://github.com/jurczykpawel/sellf/releases/download/$V/$f"; done
curl -fsSLO https://raw.githubusercontent.com/jurczykpawel/sellf/main/admin-panel/scripts/release-signing-key.pub.pem

openssl pkeyutl -verify -pubin -inkey release-signing-key.pub.pem -rawin \
  -in sellf-build.manifest -sigfile sellf-build.manifest.sig          # Signature Verified Successfully
grep -qx "sha256=$(sha256sum sellf-build.tar.gz | awk '{print $1}')" sellf-build.manifest \
  && echo "sellf-build.tar.gz: OK"                                    # archive matches the signed hash
grep -x "version=${V#v}" sellf-build.manifest                        # signed version is the tag you asked for
```

### Docker via stackpilot: digest-pinned, signed

A Docker install (via stackpilot) doesn't use the mutable `latest` tag — it pins the image by
**digest** and verifies a signature before pulling anything, the same trust model as the tarball
above. Every release also publishes a signed `sellf-image.manifest` (two lines: `version=` and
`image=ghcr.io/jurczykpawel/sellf@sha256:<digest>`) plus `sellf-image.manifest.sig`, signed with the
same release key. To verify by hand:

```bash
V=v2026.10.0
for f in sellf-image.manifest sellf-image.manifest.sig; do
  curl -fsSLO "https://github.com/jurczykpawel/sellf/releases/download/$V/$f"; done
curl -fsSLO https://raw.githubusercontent.com/jurczykpawel/sellf/main/admin-panel/scripts/release-signing-key.pub.pem

openssl pkeyutl -verify -pubin -inkey release-signing-key.pub.pem -rawin \
  -in sellf-image.manifest -sigfile sellf-image.manifest.sig          # Signature Verified Successfully
grep -x "version=${V#v}" sellf-image.manifest                        # signed version is the tag you asked for

IMAGE_REF="$(grep '^image=' sellf-image.manifest | cut -d= -f2-)"
docker pull "$IMAGE_REF"                                              # pulls by digest, never by a mutable tag
```

---

## Not sure which to pick?

**→ Start with [QUICK-START.md](/quick-start/)** — it's the simplest path and works for most first-time deployments.
