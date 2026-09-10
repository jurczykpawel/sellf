# =============================================================================
# Sellf - Production Dockerfile
# =============================================================================
# Build context: repo root (not admin-panel/)
#
# Usage:
#   docker build -t sellf .
#   docker run -p 3000:3000 --env-file .env sellf
# =============================================================================

# Bun installs dependencies only (bun.lock). Pinned to the same Bun as CI (setup-bun in
# build-release.yml): the floating tag moved to 1.4.x, which rejects this bun.lock under
# --frozen-lockfile. Debian-based so native modules match the Node stages below.
FROM oven/bun:1.3.14-slim AS deps
WORKDIR /app/admin-panel
COPY admin-panel/package.json admin-panel/bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts

# Next.js builds and runs on Node, as in CI (build job) and on production (PM2 --interpreter
# node). In oven/bun images `node` is a Bun shim, and Bun 1.3.14 segfaults at the end of
# `next build` with Next 16.3.
FROM node:22-slim AS node-base

# --- Build ---
FROM node-base AS builder
WORKDIR /app
# Copy root package.json (Next.js uses it for file tracing)
COPY package.json ./
WORKDIR /app/admin-panel
COPY --from=deps /app/admin-panel/node_modules ./node_modules
COPY admin-panel/ .
# .stripe file for build-time Stripe config defaults
RUN if [ ! -f .stripe ]; then cp .stripe.example .stripe 2>/dev/null || true; fi

ARG NEXT_TELEMETRY_DISABLED=1
ENV NEXT_TELEMETRY_DISABLED=${NEXT_TELEMETRY_DISABLED}

# Placeholder values for NEXT_PUBLIC_* — real values loaded at runtime via /api/runtime-config
ENV NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key \
    NEXT_PUBLIC_SITE_URL=https://placeholder.example.com \
    NEXT_PUBLIC_BASE_URL=https://placeholder.example.com \
    NEXT_PUBLIC_APP_URL=https://placeholder.example.com

RUN node node_modules/next/dist/bin/next build

# --- Production ---
FROM node-base AS runner
WORKDIR /app

RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin nextjs

# Standalone output — server.js lands at /app/server.js
COPY --from=builder --chown=nextjs:nodejs /app/admin-panel/.next/standalone ./

# Static assets — server.js expects them at .next/static relative to itself
COPY --from=builder --chown=nextjs:nodejs /app/admin-panel/.next/static ./.next/static

# Public files — server.js expects them at ./public
COPY --from=builder --chown=nextjs:nodejs /app/admin-panel/public ./public

# Supabase migrations (for upgrade system)
COPY supabase/migrations ./supabase/migrations/
COPY supabase/templates ./supabase/templates/

USER nextjs

EXPOSE 3000
ENV PORT=3000 HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
