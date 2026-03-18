# AGENTS.md — Sellf AI Coding Agent Guide

This file provides comprehensive guidance for AI coding agents (Claude Code, Gemini, etc.) working with the Sellf repository.

## Project Overview

Sellf is a professional content access control and monetization platform built on Next.js, Supabase, and Stripe. It consists of three main components:

1. **Client-side SDK** (`sellf.js`): JavaScript library for content protection
2. **Admin Panel** (`admin-panel/`): Next.js 16 dashboard for product/user management
3. **Database Layer** (`supabase/`): PostgreSQL with Row Level Security (RLS)

**Technical Stack:**
- **Framework:** Next.js 16 (App Router, Turbopack), React 19
- **Database:** Supabase (PostgreSQL + RLS)
- **Payment:** Stripe SDK v20
- **Runtime:** Bun (use `bun` not `npm`)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS v4
- **Internationalization:** next-intl v4 (English/Polish)

The system implements page-level, element-level, and toggle-based content protection with integrated payment processing, magic link authentication, and freemium licensing.

## Quick Start

### Local Development Environment

Requires **Docker** running (Supabase uses containers).

#### Start from scratch

```bash
# 1. Start local Supabase (from repo root — where supabase/ directory lives)
npx supabase start

# 2. Reset database (runs all migrations + seed.sql)
npx supabase db reset

# 3. Install deps & start dev server (from admin-panel/)
cd admin-panel
bun install
bun run dev                # http://localhost:3000
```

#### Local service URLs

| Service          | URL                              |
|------------------|----------------------------------|
| Admin Panel      | `http://localhost:3000`          |
| Supabase API     | `http://127.0.0.1:54321`        |
| PostgreSQL       | `127.0.0.1:54322` (user: postgres, pass: postgres) |
| Supabase Studio  | `http://127.0.0.1:54323`        |
| Inbucket (email) | `http://127.0.0.1:54324`        |
| Test Pages       | `http://localhost:3002` (auto-started by Playwright) |

## Build / Lint / Test Commands

### Admin panel (primary app — run from admin-panel/)

```bash
bun run build          # Next.js production build
bun run lint           # ESLint (next/core-web-vitals + next/typescript)
bun run typecheck      # tsc --noEmit
```

### MCP server (run from mcp-server/)

```bash
bun run build          # tsc
bun run typecheck      # tsc --noEmit
```

### Unit tests (Vitest) — admin-panel/

```bash
bun run test:unit                          # Run all unit tests
bun run test:unit:watch                    # Watch mode
bun run test:unit:coverage                 # With coverage report
bunx vitest run tests/unit/lib/constants.test.ts   # Single unit test file
bunx vitest run -t "test name pattern"     # Single test by name
```

### API integration tests (Vitest, separate config) — admin-panel/

```bash
bun run test:api                           # Requires running dev server
bun run test:api:watch
bunx vitest run --config vitest.config.api.ts tests/api/products.test.ts  # Single file
```

### E2E tests (Playwright) — admin-panel/

```bash
bun run test                               # All Playwright tests
bun run test:ui                            # Playwright UI mode
bun run test:smoke                         # Smoke tests only (2 workers)
bunx playwright test tests/checkout-payment-e2e.spec.ts   # Single spec file
bunx playwright test -g "test name"        # Single test by title
```

### Combined shortcuts — admin-panel/

```bash
bun run t              # vitest unit + smoke E2E
bun run tt             # vitest unit only
bun run ttt            # all Playwright E2E
bun run tttt           # supabase db reset + all Playwright E2E
```

### Test file naming conventions

- `*.test.ts` — Vitest unit/integration tests (in `tests/unit/`, `tests/api/`, `tests/config/`)
- `*.spec.ts` — Playwright E2E tests (in `tests/` root and `tests/smoke/`)

### Database reset + run all tests (one-liner from admin-panel/)

```bash
bun run tttt       # = cd .. && npx supabase db reset && cd admin-panel && playwright test
```

## Architecture Overview

### Three-Tier Architecture

**1. Client SDK (sellf.js)**
- ~1700 lines of vanilla JavaScript
- Dynamically loaded via `/api/sellf?domain=...`
- Key classes: `CacheManager`, `LicenseManager`, `SessionManager`, `AccessControl`, `Sellf`
- Implements three protection modes: page, element, hybrid
- Features: caching (5min TTL), batch access checking, cross-domain sessions, license verification

**2. Admin Panel (Next.js 16 + App Router)**
- TypeScript strict mode
- App Router with internationalization (English/Polish via next-intl)
- Key routes:
  - Public: `/`, `/p/[slug]` (product pages), `/login`, `/terms`, `/privacy`
  - Protected: `/dashboard`, `/my-products`
  - Admin: `/admin/products`, `/admin/users`, `/admin/payments`, `/admin/analytics`
- API endpoints: `/api/sellf`, `/api/access`, `/api/runtime-config`, `/api/create-embedded-checkout`, `/api/verify-payment`

**3. Database (PostgreSQL + Supabase)**
- Core tables: `products`, `user_product_access`, `payment_transactions`, `guest_purchases`, `rate_limits`, `audit_log`
- All tables have RLS policies
- Database functions for access control: `check_user_product_access()`, `batch_check_user_product_access()`, `grant_free_product_access()`
- Triggers: `handle_new_user_registration()` (first user → admin, claim guest purchases)
- Scheduled jobs: Rate limit cleanup (hourly via pg_cron)

### Data Flow Patterns

**Purchase Flow:**
1. User visits product page → clicks Purchase
2. `/api/create-embedded-checkout` creates Stripe session
3. User completes payment → Stripe webhook → `/api/webhooks/stripe`
4. Payment recorded in `payment_transactions`
5. If guest: `guest_purchases` created; if authenticated: `user_product_access` granted
6. User redirected with `session_id` → `/api/verify-payment` confirms access

**Access Check Flow:**
1. `sellf.js` loads → detects protection mode
2. Gets Supabase session → batch checks access via `/api/access`
3. API calls `batch_check_user_product_access()` with RLS enforcement
4. Results cached (5min TTL) → DOM modified based on access

**Magic Link Authentication:**
1. User enters email → `/api/auth/magic-link`
2. Supabase sends email (captured by Inbucket locally)
3. User clicks link → redirected to `/#access_token=...`
4. `SessionManager.handleSessionFromUrl()` parses hash
5. `supabase.auth.setSession()` → session stored in HTTP-only cookies
6. User redirected to dashboard

### Cross-Domain Architecture

Sellf supports protecting content across multiple domains:

- **Main Domain** (`MAIN_DOMAIN` env var): Hosts admin panel and API
- **Protected Domains**: Load `sellf.js` and make credentialed requests to main domain
- **Session Sharing**: Auth shared via CORS + `credentials: 'include'` on API endpoints
- **Security**: X-Requested-With and X-Sellf-Origin headers for verification

## Critical Security Patterns

**SECURITY IS THE TOP PRIORITY.** Every change must consider security implications.

### Database Security

1. **RLS Policies Required**: Every table MUST have Row Level Security policies
2. **Never Trust Client Input**: All database functions validate and sanitize inputs
3. **Use auth.uid()**: Never pass user IDs as parameters; always use `auth.uid()` in functions
4. **Rate Limiting**: All public functions enforce rate limits via `check_rate_limit()`
5. **Parameterized Queries**: Use prepared statements, never string concatenation
6. **Idempotency**: Payment processing uses unique constraints on `session_id` + `stripe_payment_intent_id`

### Rate Limiting Anti-Spoofing

**CRITICAL**: The rate limiting system (`check_rate_limit()` function) implements multi-layer anti-spoofing:
- **ONLY uses `inet_client_addr()`** (TCP connection IP from server)
- **NEVER trusts client headers** (x-forwarded-for, x-real-ip can be spoofed)
- Fallback to `pg_backend_pid()` + timestamp bucket if IP unavailable
- Global anonymous rate limiting as final protection layer

When modifying rate limiting, you MUST maintain this security model.

### Injection Prevention

Prevent ALL injection attack vectors:
- SQL Injection: Use Supabase client with parameterized queries
- XSS: Sanitize all user inputs and outputs
- Command Injection: Never execute system commands with user data
- Header Injection: Validate HTTP headers
- Log Injection: Sanitize logged data

### API Security

- All admin endpoints check authentication via middleware
- Input validation using `admin-panel/src/lib/validations/`
- CORS configured for cross-domain access with credentials
- Error messages never expose sensitive data

### Supabase Security & Admin Views

**Problem:** Admin views (e.g., `user_access_stats`) were marked as `UNRESTRICTED` in Supabase, exposing sensitive data to public API access because they were defined as `SECURITY DEFINER` without RLS or restricted permissions.

**Solution:**
- **Revoke Public Access:** Explicitly `REVOKE ALL` from `anon` and `authenticated` roles for admin views.
- **Service Role Access:** Grant `SELECT` strictly to `service_role`.
- **Internal Security Checks:** Add `WHERE (SELECT public.is_admin())` inside views as a defense-in-depth measure.
- **Security Invoker:** Prefer `security_invoker = on` where possible, but for admin views aggregating data across users (which normal users can't see), use `service_role` bypassing RLS in the API layer instead.

### API Architecture: Service Role Pattern

**Pattern:** For administrative actions (e.g., granting access, viewing global stats), do NOT rely on the authenticated user's client.

**Implementation:**
- Use a dedicated `createAdminClient()` helper that uses `SUPABASE_SERVICE_ROLE_KEY`.
- **CRITICAL:** Always verify admin privileges (e.g., `requireAdminApi()`) *before* initializing or using the admin client.
- This separates "Authentication" (who is calling?) from "Authorization/Data Access" (using system privileges to fetch data).

## Code Conventions

### Imports — strict ordering

1. Framework directive: `'use server'` or `'use client'` (first line, before imports)
2. Framework/platform: `next/...`, `react`, `next-intl`
3. Third-party: `zod`, `stripe`, `lucide-react`, `@supabase/*`, `@stripe/*`
4. Internal modules via path alias: `@/lib/...`, `@/hooks/...`, `@/components/...`, `@/types/...`
5. Type-only imports: `import type { Foo } from '...'` — always separate from value imports
6. Relative imports last: `./components/Foo`

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { PaymentConfigActionResult } from '@/types/payment-config';
```

### Path alias

`@/` maps to `admin-panel/src/`. Always use `@/` for intra-project imports — never relative `../`.

### TypeScript

- **`interface`** for object shapes: `interface PaymentMethodConfig { ... }`
- **`type`** for unions, aliases, mapped types: `type ConfigMode = 'automatic' | 'custom'`
- **Generics** for result wrappers: `PaymentConfigActionResult<T = void>`
- Suffix conventions: `...Input` (input DTOs), `...Result` (return types), `...Config` (configuration), `...Info` (display metadata)
- Prefer explicit return types on exported functions
- Use `import type` for type-only imports — never mix type and value imports

### Naming Conventions

| What                  | Convention           | Example                                  |
|-----------------------|----------------------|------------------------------------------|
| Files (lib/utils)     | kebab-case           | `payment-method-configs.ts`              |
| Files (components)    | PascalCase           | `PaymentMethodSettings.tsx`              |
| Files (hooks)         | camelCase, `use`     | `useProducts.ts`                         |
| Files (routes)        | Next.js convention   | `page.tsx`, `route.ts`, `layout.tsx`     |
| Interfaces/Types      | PascalCase           | `PaymentMethodConfig`                    |
| Functions             | camelCase, verb-first| `getProducts`, `validateEmail`           |
| Boolean fns           | `is`/`has` prefix    | `isValidStripePMCId`                     |
| Constants             | SCREAMING_SNAKE_CASE | `CACHE_TTL_HOURS`, `KNOWN_PAYMENT_METHODS`|
| React state           | `[val, setVal]`      | `[loading, setLoading]`                  |
| Components            | PascalCase, default export for pages | `export default function CheckoutPage` |
| Database              | snake_case           | `user_product_access`                    |
| API Routes            | kebab-case           | `/api/runtime-config`                    |

### React Patterns

- **Functional components only** — no class components
- **Server Components** by default (async functions, no directive needed)
- **Client Components** require `'use client'` directive at the top
- Use `useState` with explicit generic when type is not inferable: `useState<ConfigMode>('automatic')`
- Use `useEffect` with `[]` deps for initial data loads
- Use React `cache()` for server-side request deduplication
- Custom hooks: `use` prefix, return typed result interface

### Server Actions

- File starts with `'use server'`
- Validate all inputs with **Zod** schemas defined in the same file or imported from `@/lib/validations/`
- **Never throw** — return result objects: `{ success: boolean; data?: T; error?: string }`
- Call `revalidatePath()` after mutations
- Always create Supabase client via `await createClient()` from `@/lib/supabase/server`

### API Routes

- Export named HTTP handlers: `export async function POST(request: NextRequest)`
- Pattern: auth check → rate limit → parse input → validate → business logic → JSON response
- Return `NextResponse.json({ error: '...' }, { status: 4xx })` for errors
- Rate limit via `checkRateLimit()` from `@/lib/rate-limiting`

### Error Handling

- **Server actions / lib functions**: return `{ success: false, error: '...' }` — never throw
- **API routes**: `NextResponse.json({ error: '...' }, { status: code })`
- **Hooks / non-critical**: `console.error(...)` and return empty/default value
- **Console logging**: bracket-prefixed tags: `console.error('[functionName] Error:', error)`
- **Error extraction**: always `error instanceof Error ? error.message : 'Unknown error'`
- **MCP server / CLI**: `console.error(msg); process.exit(1)` for fatal errors

### Authentication Patterns

Use `createClient()` from appropriate Supabase client:
- Browser: `@/lib/supabase/client`
- Server Components: `@/lib/supabase/server`
- Middleware: `@/lib/supabase/middleware`
- API Routes: `@/lib/supabase/server`

### Documentation Style

- JSDoc block comments at the top of each file with `@see` references to related files/migrations
- Section separators in large files: `// ===== SECTION NAME =====`
- Security annotations in component headers when relevant

## Development Guidelines

### When Making Changes

1. **Security First**: Every change must consider security implications
2. **Test RLS Policies**: Changes to database schema require testing RLS policies
3. **Validate Inputs**: All user inputs must be validated client-side AND server-side
4. **Rate Limiting**: New public endpoints must enforce rate limits
5. **Audit Logging**: Admin actions should be logged to `audit_log` table
6. **TypeScript Strict**: All TypeScript must pass strict mode checks
7. **Error Handling**: Never expose sensitive information in error messages
8. **No Workarounds**: NEVER implement quick fixes or workarounds just to make something work. Always find and fix the root cause. Follow best practices and maintain code quality. Update dependencies when needed instead of patching around issues.

### When Adding Features

1. **Database First**: Design schema with RLS policies before implementing
2. **API Security**: Protect endpoints with authentication checks
3. **Documentation**: Update AGENTS.md if architecture changes
4. **Internationalization**: Add translations to both `en.json` and `pl.json`
5. **Performance**: Consider caching strategies for expensive operations

### When Fixing Bugs

1. **Root Cause**: Understand the root cause before fixing
2. **Security Impact**: Check if bug has security implications
3. **Test Coverage**: Ensure fix doesn't break existing functionality
4. **Audit Trail**: Check audit logs if bug relates to admin actions

### Database Migrations

When creating new migrations:
```bash
npx supabase migration new descriptive_name
```

Migration checklist:
- [ ] RLS enabled + at least one explicit policy per table (see Security Rules #1)
- [ ] Grants: explicit per-table REVOKE/GRANT, never blanket (see Security Rules #5)
- [ ] Admin checks use `(select public.is_admin())` not inline EXISTS (see Security Rules #2)
- [ ] Service role checks use `(select auth.role())` not current_setting (see Security Rules #3)
- [ ] SECURITY DEFINER functions have `SET search_path = ''` (see Security Rules #4)
- [ ] INSERT policies validate ownership, never `WITH CHECK (true)` (see Security Rules #6)
- [ ] Functions defined BEFORE policies that reference them (see Security Rules #8)
- [ ] Utility functions: REVOKE EXECUTE from anon/authenticated (see Security Rules #7)
- [ ] Test policies with different user roles
- [ ] Add indexes for foreign keys and frequently queried columns
- [ ] Validate all constraints and checks
- [ ] Test with `npx supabase db reset`
- [ ] Add realistic sample data to `supabase/seed.sql`
- [ ] Verify new migrations using `docker exec` SQL queries

### TypeScript Type Generation

After schema changes, regenerate types:
```bash
npx supabase gen types typescript --local > admin-panel/src/types/database.ts
```

This ensures type safety between database and TypeScript code.

### Database Management (SQL)

To execute SQL queries directly on the local database, use `docker exec` with the project-specific container name.

1. **Find the container name**: `docker ps` (look for `supabase_db_<project_name>`)
2. **Execute SQL**:
   ```bash
   docker exec -i supabase_db_sellf psql -U postgres -c "SELECT * FROM users;"
   ```
   *Replace `supabase_db_sellf` with your actual container name if different.*

**CRITICAL MANDATES for DB Changes:**
- **Representative Data**: Always add realistic sample data to `supabase/seed.sql` whenever the schema changes.
- **Verification**: Always test new migrations or functions using the `docker exec` method described above before finalizing.

## Key Implementation Details

### Dynamic Configuration System

**SellfGenerator** (`admin-panel/src/lib/sellf-generator.ts`):
- Reads `sellf.js` and injects configuration at runtime
- Template replacement: `{{SUPABASE_URL}}`, `{{SUPABASE_ANON_KEY}}`, etc.
- Hash-based caching with 5-minute TTL
- Production: minification + optional obfuscation
- Version tracking via `BUILD_HASH`

**RuntimeConfig API** (`/api/runtime-config`):
- Exposes safe client-side config (Supabase URL, Stripe publishable key, etc.)
- Used by admin panel frontend
- Cached for 5 minutes

### Guest Checkout to Registered User Flow

1. Guest purchases product → stored in `payment_transactions` with email
2. `guest_purchases` table links email to purchase
3. User later registers with same email
4. `handle_new_user_registration()` trigger automatically claims purchases
5. Access granted via `user_product_access` table

This pattern allows purchasing before account creation, critical for conversion optimization.

### First User Admin Assignment

- `handle_new_user_registration()` trigger checks if user is first
- Uses advisory lock to prevent race conditions
- First user automatically gets `is_admin = true` in `user_metadata`
- Admin status cached in session for performance

### Original Content Preservation

Before modifying DOM, `sellf.js` stores:
```javascript
document.body.setAttribute('data-original-content', document.body.innerHTML)
```

This allows:
- Restoration on access grant or errors
- Prevention of flash of protected content (FOPC)
- Graceful degradation when API fails

### Freemium Licensing Model

- **Free Tier**: Full features + "Powered by Sellf" watermark
- **Pro Tier**: Watermark removal via domain licensing
- **Domain Fingerprinting**: Combines protocol, hostname, port, userAgent, platform
- **Anti-Tampering**: MutationObserver + periodic checks prevent watermark removal
- License verification via `/api/license/verify` with fallback endpoints

### Temporal Access Control

Products can have:
- `available_from`, `available_until`: Publication windows
- `auto_grant_duration_days`: Automatic expiration for free products

User access can have:
- `access_expires_at`: Individual expiration
- `access_duration_days`: Track access duration

All enforced at database level in RLS policies and access check functions.

### Stable Versions & Known Issues

- **Supabase CLI**: 2.70.5 (run via `npx supabase`) — pin via `npx supabase@2.70.5` if needed

## Troubleshooting

### Database Connection Issues
- Ensure Supabase is running: `npx supabase status`
- Check `supabase/config.toml` for correct ports
- Verify `.env.local` has correct `SUPABASE_URL` and keys

### Magic Link Not Working Locally
- Check Inbucket at http://127.0.0.1:54324 for captured emails
- Verify `additional_redirect_urls` in `supabase/config.toml`
- Check browser console for auth errors

### Access Control Not Working
- Open browser DevTools → Console for sellf.js logs
- Verify product slug matches database
- Check RLS policies in Supabase Studio
- Confirm user has active session

### CORS Issues with Cross-Domain Access
- Verify `MAIN_DOMAIN` environment variable
- Check CORS headers in `/api/access` route
- Ensure `credentials: 'include'` in fetch requests

### Testing Complex Flows (Playwright)
- **Magic Links:** Use `Mailpit` API to capture emails and extract tokens programmatically
- **Consent Banners (Klaro):** Banners block UI interactions in tests. Use a helper (e.g., `acceptAllCookies`) to inject the consent cookie *before* navigation to bypass the banner
- **Race Conditions:** When testing high-concurrency scenarios (like multiple signups), ensuring DB triggers use transaction-level locks (`pg_advisory_xact_lock`) prevents "tuple concurrently updated" errors

## File Structure Context

```
sellf/
├── sellf.js                  # Core SDK (dynamically served by /api/sellf)
├── index.html                     # Main landing page
├── templates/                     # 12+ pre-built HTML product pages
├── themes/                        # CSS themes (dark.css, light.css)
├── examples/                      # Demo implementations (1-12 numbered examples)
├── layouts/                       # Layout templates
├── supabase/
│   ├── config.toml                # Supabase local dev config
│   ├── migrations/                # SQL migrations (timestamped)
│   │   ├── 20250101000000_*.sql   # Core schema + RLS
│   │   └── 20250102000000_*.sql   # Payment system
│   └── seed.sql                   # Sample data
└── admin-panel/
    ├── next.config.ts
    └── src/
        ├── app/
        │   ├── [locale]/          # Internationalized routes (en, pl)
        │   │   ├── page.tsx       # Landing page
        │   │   ├── dashboard/     # User dashboard
        │   │   ├── my-products/   # User's purchased products
        │   │   ├── admin/         # Admin-only section
        │   │   │   ├── products/  # Product CRUD
        │   │   │   ├── users/     # User management
        │   │   │   ├── payments/  # Payment tracking
        │   │   │   └── analytics/ # Business metrics
        │   │   ├── p/[slug]/      # Dynamic product pages
        │   │   ├── login/         # Magic link auth
        │   │   └── auth/          # Auth callback handling
        │   └── api/
        │       ├── sellf/route.ts       # Dynamic SDK generation
        │       ├── access/route.ts           # Access verification
        │       ├── runtime-config/route.ts   # Client config
        │       ├── create-embedded-checkout/route.ts
        │       ├── verify-payment/route.ts
        │       ├── validate-email/route.ts
        │       ├── webhooks/stripe/route.ts
        │       └── admin/                    # Admin API endpoints
        ├── components/
        │   ├── ui/                # Reusable UI components
        │   ├── DashboardLayout.tsx
        │   ├── LoginForm.tsx
        │   ├── ProductFormModal.tsx
        │   └── ...
        ├── lib/
        │   ├── actions/           # Server actions
        │   ├── api/               # API utilities
        │   ├── payment/           # Payment processing logic
        │   ├── services/          # Business logic
        │   ├── stripe/            # Stripe integration
        │   ├── supabase/          # Supabase clients
        │   │   ├── client.ts      # Browser client
        │   │   ├── server.ts      # Server component client
        │   │   └── middleware.ts  # Middleware client
        │   ├── validations/       # Input validation schemas
        │   ├── sellf-generator.ts
        │   ├── config-generator.ts
        │   ├── js-processor.ts    # Minification/obfuscation
        │   ├── rate-limiting.ts
        │   ├── timezone.ts
        │   ├── logger.ts
        │   └── constants.ts
        ├── contexts/              # React contexts
        ├── types/
        │   └── database.ts        # Generated Supabase types
        ├── messages/              # i18n message files
        │   ├── en.json
        │   └── pl.json
        └── middleware.ts          # Next.js middleware (auth + i18n)
```

## Key Dependencies

Next.js 16 (Turbopack), React 19, Zod v4, Stripe SDK v20, next-intl v4,
Supabase (@supabase/ssr + supabase-js), Tailwind CSS v4, Playwright (E2E), Vitest (unit).
Runtime & package manager: **Bun** (use `bun` not `npm`).

## Environment Variables

**Admin Panel** (`.env.local` in `admin-panel/`):
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# URLs
NEXT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
MAIN_DOMAIN=localhost:3000

# Cloudflare Turnstile (CAPTCHA)
NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY=...
CLOUDFLARE_TURNSTILE_SECRET_KEY=...
```

## CI/CD & Release Flow

### Creating a release

Releases are manual. CI builds the `sellf-build.tar.gz` artifact automatically.

**Versioning: CalVer `YYYY.M.patch`** (e.g. `2026.3.0`, `2026.3.1`). Year + month of release + patch counter within that month. No semver — Sellf is an end-user product, not a library.

**Before creating a release, bump the version in all these files:**

| File | Field | Example |
|------|-------|---------|
| `package.json` (root) | `"version"` | `"2026.3.0"` |
| `admin-panel/package.json` | `"version"` | `"2026.3.0"` |
| `README.md` | version badge URL | `version-2026.3.0-blue` |

**Before creating a release, always run tests:**

```bash
cd admin-panel
bun tt              # vitest unit tests — MUST pass before every release
```

Then commit, push, and create the release:

```bash
git add -A && git commit -m "chore: bump version to 2026.3.0"
git push

# Create release → CI builds tar.gz and attaches to release
gh release create v2026.3.0 --title "Sellf v2026.3.0" --notes "Changelog"

# Or trigger build without release tag
gh workflow run build-release.yml -f version=v2026.3.0
```

### CI pipeline (`.github/workflows/build-release.yml`)

Triggered by: `release created` event or `workflow_dispatch`.

Steps: `bun install --frozen-lockfile` → `bun run typecheck` → `bun run build` → package tar.gz → upload to GitHub Release.

The tar.gz contains: `.next/` (with `standalone/admin-panel/server.js`), `package.json`, `public/`, `supabase/migrations/`, `supabase/templates/`.

**Important:** The standalone output has a nested `admin-panel/` directory inside `.next/standalone/` because the CI builds from `admin-panel/` with a parent `package.json` at repo root. Next.js file tracing detects the parent and creates this nested structure.

### Deploying to server (mikrus-toolbox)

Deploy scripts live in a separate repo: `jurczykpawel/mikrus-toolbox`.

```bash
# Fresh install
./local/deploy.sh sellf --ssh=mikrus --domain=example.com

# Update (downloads latest release from GitHub automatically)
./local/deploy.sh sellf --ssh=mikrus --update

# Update with local build file (when no release exists yet)
./local/deploy.sh sellf --ssh=mikrus --update --build-file=~/sellf-build.tar.gz

# Restart only (after .env.local changes, no file update)
./local/deploy.sh sellf --ssh=mikrus --update --restart
```

### Server instances

| Instance | Directory | PM2 name | Port |
|----------|-----------|----------|------|
| Production (TSA) | `/opt/stacks/sellf-tsa/` | `sellf-tsa` | 3333 |
| Demo | `/opt/stacks/sellf-demo/` | `sellf-demo` | 3334 |

## Deployment Policy

**CRITICAL**: Deployment to the remote server (e.g., "mikrus") is **RESTRICTED**.
- All development and testing must be performed **LOCALLY**.
- No automatic deployments or manual deployments to remote servers should be initiated by the AI.
- Only the **USER** decides when the application is ready for deployment after verifying all features locally.

## Documentation and File Management

### File Management Guidelines

**IMPORTANT: Avoid creating new .md files unnecessarily!**

When documenting changes or adding information:

1. **Update Existing Files First**: Before creating a new .md file, check if the information belongs in an existing file
2. **Core Documentation Files**:
   - `README.md` - Main project documentation
   - `AGENTS.md` - AI assistant instructions (this file)
   - `deployment/advanced/DOCKER-SIMPLE.md` - Simple Docker deployment guide
   - `docs/DEPLOYMENT-MIKRUS.md` - Main deployment guide (VPS/PM2)
   - `templates/README.md` - Template customization guide
3. **When to Create New Files**:
   - Only when information doesn't fit naturally in core docs
   - When creating a substantial, standalone guide (>1000 words)
   - When documenting a separate, independent feature/module
4. **When NOT to Create New Files**:
   - For small feature explanations (add to README.md)
   - For deployment notes (add to appropriate DEPLOYMENT file)
   - For architecture notes (add to AGENTS.md)
   - For quick tips or FAQs (add to README.md)

**Principle**: Keep documentation lean and consolidated. Less is more!

## Security Checklist for Code Review

When reviewing or writing code, verify:

- [ ] RLS policies exist for all new tables
- [ ] Database functions use `auth.uid()`, not parameters
- [ ] All user inputs are validated and sanitized
- [ ] API endpoints check authentication where needed
- [ ] Rate limiting is enforced on public endpoints
- [ ] Error messages don't expose sensitive data
- [ ] Parameterized queries used (no string concatenation)
- [ ] CORS configured correctly for cross-domain features
- [ ] Secrets never committed to repository
- [ ] Audit logging for admin actions

## Supabase/PostgreSQL Security Rules

**These rules are mandatory.** Every SQL migration and every TypeScript file touching
Supabase must follow them. They exist because past audits found recurring violations.

### SQL Migrations

#### 1. New tables: RLS + explicit policies + least-privilege grants

Every new table MUST have all three. Zero-policy tables with RLS enabled are a time bomb.

```sql
-- CORRECT pattern for a new table:
CREATE TABLE seller_main.my_table (...);
ALTER TABLE seller_main.my_table ENABLE ROW LEVEL SECURITY;

-- Explicit policies (even if service_role-only)
CREATE POLICY "Service role full access" ON seller_main.my_table
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admin read" ON seller_main.my_table
  FOR SELECT TO authenticated USING ((select public.is_admin()));

-- Explicit grants (NEVER rely on default privileges)
REVOKE ALL ON seller_main.my_table FROM anon, authenticated;
GRANT SELECT ON seller_main.my_table TO authenticated;
GRANT ALL ON seller_main.my_table TO service_role;
```

#### 2. Admin checks in RLS policies: use `(select public.is_admin())`

NEVER use inline `EXISTS (SELECT 1 FROM admin_users ...)` in CREATE POLICY.
The `is_admin()` function is SECURITY DEFINER — it works for anon without granting
access to `admin_users` table. The `(select ...)` wrapper enables Postgres initPlan
caching (evaluated once per statement, not per row).

```sql
-- WRONG:
USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))

-- CORRECT:
USING ((select public.is_admin()))
```

#### 3. Service role checks in RLS: use `(select auth.role())`

NEVER use `current_setting('role', true)`. It can be manipulated via `SET role` in
direct DB connections. `auth.role()` reads from the JWT which cannot be forged.

```sql
-- WRONG:
USING (current_setting('role', true) = 'service_role')

-- CORRECT:
USING ((select auth.role()) = 'service_role')
```

#### 4. SECURITY DEFINER functions: always SET search_path = ''

Every PL/pgSQL function with SECURITY DEFINER MUST have `SET search_path = ''`
and qualify all table references as `schema.table`.

```sql
CREATE OR REPLACE FUNCTION my_function()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''      -- MANDATORY
AS $$ ... $$;
```

#### 5. Grants: explicit per-table, never blanket

NEVER use `GRANT ALL ON ALL TABLES IN SCHEMA ... TO anon/authenticated`.
Grant the minimum required per table. Use `ALTER DEFAULT PRIVILEGES` sparingly
and only for `service_role`.

```sql
-- WRONG:
GRANT ALL ON ALL TABLES IN SCHEMA seller_main TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA seller_main
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- CORRECT: explicit per-table
GRANT SELECT ON seller_main.products TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON seller_main.user_product_access TO authenticated;
GRANT ALL ON seller_main.products TO service_role;
-- Default privileges only for service_role:
ALTER DEFAULT PRIVILEGES IN SCHEMA seller_main
  GRANT ALL ON TABLES TO service_role;
```

#### 6. INSERT policies: always validate ownership

NEVER use `WITH CHECK (true)` on public/authenticated INSERT policies.
Always validate that the inserter owns the data they're inserting.

```sql
-- WRONG:
CREATE POLICY "Anyone can insert" ON consent_logs
  FOR INSERT WITH CHECK (true);

-- CORRECT:
CREATE POLICY "Users insert own records" ON consent_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));
```

#### 7. Third-party functions: REVOKE from anon/authenticated

Any utility function not needed by end users (clone_schema, pg_get_tabledef, etc.)
MUST have execute privileges revoked from anon and authenticated.

```sql
REVOKE EXECUTE ON FUNCTION public.clone_schema FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.clone_schema TO service_role;
```

#### 8. Function/policy ordering in migrations

If a migration defines a function AND policies that reference it, the function
MUST be defined BEFORE the policies. PostgreSQL executes statements sequentially.

### TypeScript / API Routes

#### 9. Admin client: use createAdminClient(), never raw createClient with service key

```typescript
// WRONG:
const supabase = createClient(getSupabaseUrl(), getSupabaseServiceKey());

// CORRECT:
import { createAdminClient } from '@/lib/supabase/admin';
const supabase = createAdminClient();
```

#### 10. Schema validation: validate schema names before creating Supabase clients

Any function that creates a Supabase client with a dynamic schema MUST validate
the schema name with `isValidSellerSchema()`.

#### 11. Rate limiting: use client IP for anonymous users, never shared bucket

```typescript
// WRONG:
const identifier = userId || 'anonymous';

// CORRECT:
const identifier = userId || request.headers.get('x-forwarded-for') || 'unknown';
```

#### 12. External HTTP requests: block redirects for SSRF protection

Any `fetch()` to user-supplied URLs MUST use `redirect: 'error'`.

```typescript
const response = await fetch(webhookUrl, {
  method: 'POST',
  redirect: 'error',  // MANDATORY — prevents redirect-based SSRF
  body: JSON.stringify(payload),
});
```

#### 13. Environment variables: throw on missing, never fallback to dummy values

```typescript
// WRONG:
const key = process.env.SUPABASE_ANON_KEY || 'dummy-key-for-build';

// CORRECT:
const key = process.env.SUPABASE_ANON_KEY;
if (!key) throw new Error('Missing SUPABASE_ANON_KEY');
```

## Core Mandates

**MANDATORY: Before starting any coding task, read `vault/brands/_shared/reference/coding-standards.md` and follow ALL rules defined there.** This includes: zero tolerance for broken things, cleanup after changes, DRY, KISS, SOLID, opportunistic refactoring, think-before-you-code, security-first (OWASP Top 10), and code quality standards.

In addition to the shared coding standards, the following Sellf-specific mandates apply:

- **Proactiveness:** Fulfill the user's request thoroughly. When adding features or fixing bugs, this includes adding tests to ensure quality. Consider all created files, especially tests, to be permanent artifacts unless the user says otherwise.
- **Confirm Ambiguity/Expansion:** Do not take significant actions beyond the clear scope of the request without confirming with the user. If asked *how* to do something, explain first, don't just do it.
- **Explaining Changes:** After completing a code modification or file operation *do not* provide summaries unless asked.
- **Do Not revert changes:** Do not revert changes to the codebase unless asked to do so by the user. Only revert changes made by you if they have resulted in an error or if the user has explicitly asked you to revert the changes.

## Primary Workflows

### Software Engineering Tasks

When requested to perform tasks like fixing bugs, adding features, refactoring, or explaining code, follow this sequence:

1. **Understand & Strategize:** Think about the user's request and the relevant codebase context. When the task involves **complex refactoring, codebase exploration or system-wide analysis**, your **first and primary tool** must be 'codebase_investigator'. Use it to build a comprehensive understanding of the code, its structure, and dependencies. For **simple, targeted searches** (like finding a specific function name, file path, or variable declaration), you should use 'search_file_content' or 'glob' directly.

2. **Plan:** Build a coherent and grounded (based on the understanding in step 1) plan for how you intend to resolve the user's task. If 'codebase_investigator' was used, do not ignore the output of 'codebase_investigator', you must use it as the foundation of your plan. Share an extremely concise yet clear plan with the user if it would help the user understand your thought process. As part of the plan, you should use an iterative development process that includes writing unit tests to verify your changes. Use output logs or debug statements as part of this process to arrive at a solution.

3. **Test First (TDD):** Before writing implementation, write a failing test that defines the expected behavior. Run it - it must fail (RED). This applies to new features, bug fixes, and refactors. For bug fixes, the test reproduces the bug. For features, the test defines the acceptance criteria. See `vault/brands/_shared/reference/coding-standards.md` for the full TDD workflow.

4. **Implement (GREEN):** Write the minimum code to make the test pass. Nothing more. Then refactor if needed while keeping tests green.

5. **Verify (Tests):** Run the full test suite (`bun run test:unit`), not just the new test. Scan ALL output for failures, flaky tests, and warnings. Fix everything.

6. **Verify (Standards):** VERY IMPORTANT: After making ANY code changes, execute the project-specific build, linting and type-checking commands (e.g., `tsc`, `bun run lint`, `bun run build`) to ensure code quality and adherence to standards.
   - **Compilations Check:** ALWAYS run `bun run build` (or equivalent) to verify there are no compilation errors before finishing the task.
   - **Database Changes:** If you modified the database schema (migrations), you MUST regenerate TypeScript types (`npx supabase gen types typescript --local > admin-panel/src/types/database.ts`) and run a build check (`bun run build`) to ensure type safety is maintained.

7. **Finalize:** After all verification passes, consider the task complete. Do not remove or revert any changes or created files (like tests). Await the user's next instruction.

## Operational Mandates

- **Test-Driven Development:** Follow the TDD workflow (RED -> GREEN -> REFACTOR) as defined in `vault/brands/_shared/reference/coding-standards.md`. Tests come BEFORE implementation, not after.
- **Pre-Commit Verification:** Always perform a `git diff` after file modifications to verify that the changes match the intended plan and that no excessive content was accidentally deleted. Additionally, always run the full test suite (`bun run test` or equivalent) and a production build (`bun run build`) before committing changes to ensure no regressions or type errors are introduced.

## Important Notes

- **Local-First Development**: All work is currently focused on local development and testing.
- **Strict Deployment**: No remote deployments (e.g., to "mikrus") are allowed without explicit user instruction after local verification.
- **Production vs Local**: Configuration generation behaves differently (minification, obfuscation).
- **First Run**: First user to register automatically becomes admin.
- **Guest Purchases**: Purchases made before registration are auto-claimed on signup.
- **Rate Limits**: Aggressive rate limiting on public functions; adjust if needed for testing.
- **Caching**: 5-minute TTL on access checks; clear cache when testing access changes.
- **Locales**: Only English (en) and Polish (pl) are configured.
