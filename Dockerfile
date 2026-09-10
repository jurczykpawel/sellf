# =============================================================================
# Sellf - Production Dockerfile
# =============================================================================
# Build context: repo root (not admin-panel/)
#
# Usage:
#   docker build -t sellf .
#   docker run -p 3000:3000 --env-file .env sellf
# =============================================================================

# Pinned to the same Bun as CI (setup-bun in build-release.yml). The floating `1-alpine`
# tag moved to 1.4.x, which rejects this bun.lock (--frozen-lockfile, overrides check).
FROM oven/bun:1.3.14-alpine AS base

# --- Dependencies ---
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app/admin-panel
COPY admin-panel/package.json admin-panel/bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts

# --- Build ---
FROM base AS builder
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

RUN bun run build

# --- Production ---
FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

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

CMD ["bun", "server.js"]
