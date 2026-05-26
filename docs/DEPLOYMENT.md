# Deployment Options

Most users should use the main **[Deployment Guide](./DEPLOYMENT-MIKRUS.md)** — it covers VPS setup with PM2 and gets you running in under 30 minutes.

The guides below are for **advanced use cases**:

---

### [DEPLOYMENT-COOLIFY.md](./DEPLOYMENT-COOLIFY.md) — Coolify (one-click self-hosted)
**Use if you need:**
- Closest to "true one-click" — migrations run automatically
- Self-hosted full stack (Sellf + Supabase) on your own VPS
- Auto TLS + GitHub auto-deploy on push

**Requirements:** 4GB+ RAM VPS, Coolify installed (free), 10 min setup

---

### [FULL-STACK.md](./FULL-STACK.md) — Self-Hosted Supabase + Docker
**Use if you need:**
- Full control over all infrastructure (11 Docker containers)
- Self-hosted Supabase (no cloud dependency)
- GDPR compliance (data residency requirements)
- High traffic (1M+ requests/month)

**Requirements:** 8GB+ RAM, DevOps experience, 2-3 hours setup, ~$50-100/month

---

### [PM2-VPS.md](./PM2-VPS.md) — Advanced PM2
**Use if you need:**
- Cluster mode (multi-core utilization)
- Zero-downtime deployments
- Advanced monitoring (PM2+, Prometheus, Grafana)
- Auto-scaling, log rotation, CPU/memory profiling

**Requirements:** PM2 expertise, 4GB+ RAM

**Note:** For basic PM2 setup, see the main [Deployment Guide](./DEPLOYMENT-MIKRUS.md).

---

### [DOCKER-SIMPLE.md](./DOCKER-SIMPLE.md) — Simple Docker
**Use if you:**
- Want Docker + Supabase Cloud
- Need more detailed explanation than the main guide

---

### [UPSTASH-REDIS.md](./UPSTASH-REDIS.md) — Optional Redis Caching
**Use if you want:**
- 10x faster config queries (50-100ms → 5-10ms)
- 50-70% reduced database load
- Free tier: 10,000 req/day

---

## Not sure which to pick?

**→ Start with the [Deployment Guide](./DEPLOYMENT-MIKRUS.md)** — it works for 90% of users.
