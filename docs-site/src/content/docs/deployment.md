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

### [DEPLOYMENT-COOLIFY.md](/deployment-coolify/) — Coolify (one-click self-hosted)
**Use if you need:**
- Closest to "true one-click" — migrations run automatically
- Self-hosted full stack (Sellf + Supabase) on your own VPS
- Auto TLS + GitHub auto-deploy on push

**Requirements:** 8GB+ RAM VPS (4 GB is enough at runtime but the build OOMs — see guide), Coolify installed (free), 10 min setup

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
- Full control over all infrastructure (11 Docker containers)
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
- Want Docker + Supabase Cloud
- Need more detailed explanation than the main guide

---

### [UPSTASH-REDIS.md](/upstash-redis/) — Optional Redis Caching
**Use if you want:**
- 10x faster config queries (50-100ms → 5-10ms)
- 50-70% reduced database load
- Free tier: 10,000 req/day

---

## Not sure which to pick?

**→ Start with [QUICK-START.md](/quick-start/)** — it's the simplest path and works for most first-time deployments.
