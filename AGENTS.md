# AGENTS.md — Sellf AI Coding Agent Guide

This file provides comprehensive guidance for AI coding agents (Claude Code, Gemini, etc.) working with the Sellf repository.

## Project Overview

Sellf is a self-hostable monetization platform built on Next.js, Supabase, and Stripe. It consists of two main components:

1. **Admin Panel** (`admin-panel/`): Next.js 16 dashboard for product/user management and checkout
2. **Database Layer** (`supabase/`): PostgreSQL with Row Level Security (RLS)

Sellers ship a small loader snippet (`/embed/v1/checkout.js`) on their own pages to render the Stripe Embedded Checkout for a Sellf product.

**Technical Stack:**
- **Framework:** Next.js 16 (App Router, Turbopack), React 19
- **Database:** Supabase (PostgreSQL + RLS)
- **Payment:** Stripe SDK v20
- **Runtime:** Bun (use `bun` not `npm`)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS v4
- **Internationalization:** next-intl v4 (English/Polish)

The system handles product CRUD, Stripe-backed payments (Embedded Checkout + webhook reconciliation), magic-link authentication, and a tier-based license registry that gates a small set of Pro-only admin features.

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
bun run test:api                           # Requires running dev server on :3777
bun run test:api:watch
bun run test:api:auto                      # Auto-starts dev server, runs suite, cleans up
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
bun run ttt            # API integration + all Playwright E2E
bun run tttt           # supabase db reset + API integration + all Playwright E2E
```

### Test file naming conventions

- `*.test.ts` — Vitest unit/integration tests (in `tests/unit/`, `tests/api/`, `tests/config/`)
- `*.spec.ts` — Playwright E2E tests (in `tests/` root and `tests/smoke/`)

### Database reset + run all tests (one-liner from admin-panel/)

```bash
bun run tttt       # = cd .. && npx supabase db reset && cd admin-panel && playwright test
```

## Architecture Overview

### Two-Tier Architecture

**1. Admin Panel (Next.js 16 + App Router)**
- TypeScript strict mode
- App Router with internationalization (English/Polish via next-intl)
- Key routes:
  - Public: `/`, `/p/[slug]` (product pages), `/login`, `/terms`, `/privacy`
  - Protected: `/dashboard`, `/my-products`
  - Admin: `/admin/products`, `/admin/users`, `/admin/payments`, `/admin/analytics`
- API endpoints: `/api/runtime-config`, `/api/create-embedded-checkout`, `/api/verify-payment`, `/api/webhooks/stripe`, `/api/embed/checkout-session`, `/api/embed/free-access`, `/embed/v1/checkout.js`, `/api/auth/magic-link`
- Public v1 API (API key auth, `PRODUCTS_READ`/`PRODUCTS_WRITE` scopes):
  - `GET /api/v1/products` — cursor pagination, accepts `?search=`, `?status=`, `?sort_by=`, `?embed=categories,tags` (opt-in), `?category=<uuid-or-slug>` and `?tag=<uuid-or-slug>` (CSV, AND-intersection; auto-detect UUID vs slug)
  - `GET/POST /api/v1/products` and `GET/PATCH/DELETE /api/v1/products/:id` accept `categories: string[]` and `tags: string[]` (UUID arrays, max 50; PATCH uses replace semantics; partial junction failures surface as `_warnings` with HTTP 207)
  - `GET/POST /api/v1/tags` and `GET/PATCH/DELETE /api/v1/tags/:id` — full CRUD for tag dictionary; slug regex `^[a-zA-Z0-9_-]+$`

**2. Database (PostgreSQL + Supabase)**
- Core tables: `products`, `user_product_access`, `payment_transactions`, `guest_purchases`, `rate_limits`, `audit_log`
- All tables have RLS policies
- Database functions for access control: `check_user_product_access()`, `batch_check_user_product_access()`, `grant_free_product_access()`
- Triggers: `handle_new_user_registration()` (first user → admin, claim guest purchases)
- Scheduled jobs: Rate limit cleanup (hourly via pg_cron)

### Data Flow Patterns

**Purchase Flow (on the admin panel):**
1. Buyer visits `/p/[slug]` → clicks Purchase
2. `/api/create-embedded-checkout` creates a Stripe session
3. Buyer completes payment in Stripe Embedded Checkout
4. Stripe webhook → `/api/webhooks/stripe` records the transaction
5. Guest payments land in `guest_purchases`; authenticated buyers get a row in `user_product_access`
6. Buyer redirected with `session_id` → `/api/verify-payment` confirms access

**Embedded Checkout (on a seller's external page):**
1. Seller pastes the `<script src=".../embed/v1/checkout.js" data-...>` snippet
2. Loader fetches `/api/embed/checkout-session` for paid products (anonymous, captcha-gated)
3. Stripe Embedded Checkout renders inline; payment hits the same webhook path
4. Free products go through `/api/embed/free-access` (captcha + magic link)

**Magic Link Authentication:**
1. Browser calls `sendMagicLinkRequest()` → `POST /api/auth/magic-link` with the captcha token. Browsers never call Supabase's OTP endpoint directly.
2. The route calls `requestMagicLink()` (`src/lib/auth/magic-link/request.ts`), which checks an IP-scoped rate limit, verifies the captcha via `verifyCaptchaToken()` (ALTCHA payloads are single-use — see below), validates the email, and builds the redirect URL.
3. `requestMagicLink()` calls `sendTrustedMagicLink()` (same module), which enforces a per-email rate limit and then calls `deliverMagicLink()` (`src/lib/auth/magic-link/deliver.ts`) — the only place in the codebase that calls `auth.signInWithOtp`, using the service-role client. Supabase Auth skips its own captcha check for service-role callers, so every caller of `deliverMagicLink()` must go through captcha verification (`requestMagicLink`) or an already-proven trust signal such as a completed Stripe payment (`sendTrustedMagicLink` called directly).
4. Server-side callers that already trust their own gate (`/api/embed/free-access` uses `requestMagicLink()` since it is still a public, unauthenticated form; the post-checkout `payment-status` page uses `sendTrustedMagicLink()` directly, since access there is already proven by a verified Stripe session) never call `deliverMagicLink()` themselves — an ESLint rule restricts that import to `request.ts`.
5. The email link carries `token_hash` (custom templates), not `{{ .ConfirmationURL }}` — it works from any device without a PKCE cookie. Locally captured by Mailpit; in production sent by the configured SMTP.
6. User clicks the link → `/auth/callback` calls `verifyOtp({ token_hash, type })` → session stored in cookies.
7. User redirected to the configured destination: an explicit `redirect_to` if the link carried one (product/checkout flows), otherwise the callback's own role-based default (admins → `/dashboard`, everyone else → `/my-products`) — a plain login link deliberately omits `redirect_to` so this applies.

Supabase Auth's own captcha setting (`security_captcha_enabled` in the dashboard, or `GOTRUE_SECURITY_CAPTCHA_*` if self-hosting GoTrue) is independent of the above — it only affects direct calls to `/auth/v1`, which this app no longer makes from the browser. Keep it enabled where available as defense in depth; verify with `scripts/verify-auth-captcha.sh`.

A solved ALTCHA payload is consumed exactly once: `verifyCaptchaToken()` records it in `public.captcha_nonces` (keyed by a hash of the payload's signature) and rejects a second use, so the payload can't be replayed for the rest of its validity window.

## Critical Security Patterns

**SECURITY IS THE TOP PRIORITY.** Every change must consider security implications.

### Database Security

1. **RLS Policies Required**: Every table MUST have Row Level Security policies
2. **Never Trust Client Input**: All database functions validate and sanitize inputs
3. **Use auth.uid()**: Never pass user IDs as parameters; always use `auth.uid()` in functions
4. **Rate Limiting**: All public functions enforce rate limits via `check_rate_limit()`
5. **Parameterized Queries**: Use prepared statements, never string concatenation
6. **Idempotency**: Payment processing uses unique constraints on `session_id` + `stripe_payment_intent_id`

### Magic-Link Delivery Gate

`signInWithOtp` may only be called from `src/lib/auth/magic-link/deliver.ts` (`deliverMagicLink()`) — every other call site is a lint error (`eslint.config.mjs`, `no-restricted-syntax`). `deliverMagicLink()` itself may only be imported from `src/lib/auth/magic-link/request.ts` (`no-restricted-imports`) — every server call site goes through `requestMagicLink()` (captcha + IP/email rate limits) or `sendTrustedMagicLink()` (per-email rate limit only, for callers that already proved trust another way, e.g. a verified Stripe payment). Browsers request a magic link via `sendMagicLinkRequest()` → `POST /api/auth/magic-link` → `requestMagicLink()`. See "Magic Link Authentication" above.

### Rate Limiting Layers

Two layers, each responsible for different callers:

- **Application (`src/lib/rate-limiting.ts`, `check_application_rate_limit`)** — the only layer that
  can tell storefront visitors apart. Keys: `user:<id>` for signed-in users, otherwise the client IP
  from `extractTrustedClientIp()` (forwarded headers are trusted only with `TRUSTED_PROXY=true`, which
  production requires). Routes that call database functions for anonymous visitors apply their limits
  here and then call the function with the service client.
- **Database (`check_rate_limit()` inside SECURITY DEFINER functions)** — guards direct PostgREST RPC use:
  - no request JWT (triggers fired by the auth server, cron) or `service_role` → not counted
    (the server already applied the application layer);
  - signed-in user → bucket per `auth.uid()`;
  - anonymous → ONE shared bucket per function. The database only sees the PostgREST connection,
    so `inet_client_addr()` cannot identify visitors; this bucket is a ceiling on direct anonymous
    RPC use, not a per-visitor limit. Never route legitimate anonymous traffic through it — call the
    function server-side instead.
  - `identifier_param` → bucket per caller-supplied key (include the caller in the key, e.g.
    `verify_coupon` uses code + user id or e-mail).

When modifying rate limiting, keep each caller in exactly one of these buckets.

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

### Runtime Configuration

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

- `handle_new_user_registration()` trigger promotes a new registrant only when nobody else exists yet in `auth.users` — i.e. only the very first user of the whole installation. Once that user exists (or has since been removed from `admin_users`), no later registration auto-promotes anyone else.
- Uses an advisory lock to prevent race conditions
- Admin status is a row in `public.admin_users` (checked via `public.is_admin()`), not a `user_metadata` flag; admin status is cached in session for performance
- **Restoring an admin manually** (e.g. the last admin was removed by mistake): insert a row for that user as the service role — `INSERT INTO public.admin_users (user_id) VALUES ('<user-uuid>');` via `docker exec -i supabase_db_sellf psql -U postgres` locally, or the Supabase SQL editor / service-role client in production. There is no self-service UI for this by design.

### Deleting a User

There is no in-app "delete my account" flow. An operator deletes a user from Supabase Auth directly — the dashboard's "Delete user" button, or `auth.admin.deleteUser(id)` from a service-role client — for example to fulfil a GDPR erasure request.

Every table that references `auth.users(id)` falls into one of two buckets (see `supabase/migrations/20260924000000_access_scope_tightening.sql`, "Account deletion" section):

- **Kept, with the reference set to NULL** — financial and legal records that must survive the account: `payment_transactions` (including `refunded_by`), `refund_requests` (including `admin_id`), `product_price_history` (Omnibus Directive price-history compliance), `audit_log` (`user_id` and `performed_by`), `admin_actions`, `issued_licenses` (license issuance history — `seller_id`), `seller_license_keys` (the seller's signing keypair — `seller_id`), and `subscriptions` (`user_id`, once the subscription has ended — see below). Each of these already stores an independent snapshot (amount, e-mail, product, timestamps), so nulling the account reference loses no financial or audit detail. `consent_logs` has no foreign key at all and is never touched.
- **Removed with the account** — pure per-account data: `profiles`, `user_product_access`, `video_progress`, `admin_users` (and anything that cascades from it, e.g. that admin's `api_keys`), `stripe_customers`, `seller_embed_settings`.

Two tables needed a product decision rather than a mechanical "keep vs remove" call:

- **`subscriptions.user_id`** blocks deletion only while Stripe is currently charging the account, or about to — a `BEFORE DELETE` trigger on `auth.users` (`prevent_delete_user_with_active_subscription()`, mirroring how `handle_new_user_registration()` is wired to `auth.users`) raises an exception when the user has a subscription in `trialing`, `active`, `past_due`, or `incomplete`. Those are the statuses where Stripe's own lifecycle (docs.stripe.com/billing/subscriptions/overview) is currently billing or about to bill the customer; `unpaid`, `canceled`, `incomplete_expired`, and `paused` are not blocking because Stripe has already stopped (or never started) attempting to collect. Once a subscription reaches a non-blocking status, the row is kept with `user_id` set to `NULL`, like the other financial tables above. The DELETE call itself gets back a generic `"Database error deleting user"` (500) — GoTrue does not forward the trigger's message to the API response — the specific reason ("an active Stripe subscription exists…") is only visible in the Postgres/GoTrue server logs.
- **`seller_license_keys.seller_id`** is kept (`NULL`ed) rather than cascaded, so a deleted seller's buyers can keep verifying licenses issued before the deletion. A license token carries no seller claim (`src/lib/license-keys/format.ts`) — the buyer's verifier is handed the seller id once, out of band, at issuance — so nulling the live `seller_id` FK alone would silently break every already-issued license's lookup. Both `seller_license_keys` and `issued_licenses` carry a second column, `original_seller_id` (plain UUID, no foreign key, stamped once at insert by `stamp_original_seller_id()` and also set explicitly by `storeSellerKey()`/`issueLicense()`), which is what `GET /api/licenses/jwks?seller=<id>` (via `seller_license_public_keys()`) and the CRL/revocation lookup (`GET /api/licenses/revoked`, via `seller_revoked_orders()`) actually filter on — so verification and revocation keep working by the same seller id the buyer already has, regardless of what happens to the seller's account afterwards. New issuance still requires a live seller, obviously.

### Outbound webhook delivery

`WebhookService.trigger()` persists one `webhook_logs` delivery per
order/event/endpoint before HTTP dispatch. `purchase.completed` uses the PI (or
CS for orders without a PI); `invoice.paid` uses `invoice.stripeInvoiceId`.
The queue row UUID is the top-level payload `id` and `X-Sellf-Delivery-Id` header.
Automatic and manual retries reuse that ID. Receivers must **deduplicate on this
id** and verify the existing signature against the raw body. Delivery is at least
once; an accepted request can be retried after an interrupted sender.

`payment_transactions.fulfillment_pending` defaults to false, so existing and
directly inserted completed orders count as fulfilled. Payment completion sets it
to true atomically; successful license issuance and durable delivery preparation
clear it independently of access granting.
All paid-order completion paths resume unfinished fulfillment. Invoice retries
also recover missing access and delivery. Endpoint customization cannot replace
or remove the envelope `id`. The retry worker leases rows through the existing
queue; interrupted attempts remain due after the lease expires.

### License Tier Registry

A small set of admin-panel features are gated by a license tier (`free`, `registered`, `pro`, `business`). The registry lives in `admin-panel/src/lib/license/features.ts` and the resolver in `admin-panel/src/lib/license/resolve.ts`. Currently gated:

- `csv-export` — payment CSV export (`registered+`)
- `api-keys` — creating an API key, `POST /api/v1/api-keys` (`registered+`; existing keys keep working)
- `webhooks` — creating a webhook endpoint, `POST /api/v1/webhooks` (`registered+`; existing endpoints keep firing)
- `watermark-removal` — hides the "Powered by Sellf" badge on checkout / product pages (`pro+`)
- `theme-customization` — saving custom themes (`pro+`)
- `api-key-scopes` — broader API key scopes (`pro+`)
- `webhook-product-scoping` / `webhook-payload-customization` — advanced webhook config (`pro+`)
- `license-key-issuance` / `license-revoked-webhook` — sell licensed products (`pro+`)

Resolution is DB-first (`license_keys` table) with env fallback (`SELLF_LICENSE_KEY`).

### Temporal Access Control

Products can have:
- `available_from`, `available_until`: Publication windows
- `auto_grant_duration_days`: Automatic expiration for free products

User access can have:
- `access_expires_at`: Individual expiration
- `access_duration_days`: Track access duration

All enforced at database level in RLS policies and access check functions.

### Login Wall (content gating snippet)

A per-product, copy-pasteable snippet sellers can paste on **their own pages** to
gate content behind a Sellf sign-in + active-access check. The snippet does not
verify the user against the page's server — the seller's page can remain a
plain static page.

**This is a UX-level gate, not a server-enforced access control.** The check that
decides whether the page's content shows or hides runs entirely in the visitor's
browser (presence of `_sf_token` in the URL fragment); there is no server-side
call that re-confirms the token before the page renders, so a visitor who edits
the page's own script/DOM can bypass it. That's an accepted trade-off for a
plain static page with no backend of its own. **Gating real content or actions —
anything where a bypass would matter — needs server-side verification instead:**
use Element gating's `POST /api/loginwall/verify` (documented below — or
`SellfGate.verify()` from a page that already has the gate snippet), which
re-reads live access on the Sellf server for every call. Do not reach for the
whole-page Login Wall when that's the requirement.

**Flow (one round trip per visit):**

1. Visitor hits `cust.example/some-page` (snippet in `<head>`).
2. Inline `<script>` redirects to `/loginwall/protect?id=<product-uuid>&redirect=<page-url>`.
3. `/loginwall/protect` (a Sellf route) checks the redirect host against the seller's
   embed allowlist (`seller_embed_settings.allowed_embed_origins`, with
   `SELLF_EMBED_ALLOWED_ORIGINS` as env fallback — the same allowlist the embed
   checkout uses), then checks the session: unauth → `/login?redirect_to=…`,
   signed-in without access → `/p/<slug>`, signed-in with access → 307 back to the page
   with the token appended to the URL **fragment** as `#_sf_token=<HMAC>`. Fragments
   are never sent in `Referer` headers and never reach server logs, so the token
   does not leak to third-party assets (fonts, analytics, embeds) that load during
   the seller page's initial render.
4. The deferred loader at `/api/loginwall/login.js` runs after the inline script,
   reads the token from `location.hash`, marks the page as visited
   (`window._SF_LW_<hash> = true` so the inline fallback no-ops), and strips the token
   from the URL via `history.replaceState` (preserving any unrelated fragment the
   seller's page already had).

**Pieces:**

- Pure crypto: `src/lib/loginwall/token.ts` — `signLoginwallToken` (HMAC-SHA256, no DB, no env). There is
  no corresponding server-side verify for this v1 token — see the UX-only caveat above; the gate token
  (v2, multi-product) has its own `signGateToken`/`verifyGateToken` pair for the flow that does verify.
- Snippet builder: `src/lib/loginwall/snippet.ts` — `buildLoginwallSnippet` (HTML the seller pastes) and `buildLoginwallScript` (the JS served at `/api/loginwall/login.js`). Per-product variable hash so the global flag name doesn't collide across products.
- Redirect allowlist: reuses `loadAllowedOriginsForProduct` from `src/lib/embed/checkout-embed.ts` (shared with the embed checkout flow). Sellers register origins in `public.seller_embed_settings.allowed_embed_origins`; the `SELLF_EMBED_ALLOWED_ORIGINS` env var is the fallback for solo deployments.
- Routes: `src/app/[locale]/loginwall/protect/route.ts` and `src/app/api/loginwall/login.js/route.ts`.
- Admin UI: `LoginwallSnippetModal` + the "Generate login wall snippet" action in `ProductsTable`.

**Env:** `LOGINWALL_SECRET` (HMAC key, 32 random bytes hex). Rotating it
invalidates every in-flight token immediately; the next visit just goes through
`/loginwall/protect` again and gets a fresh one.

### License keys (sell licensed digital products)

Sellers can issue ECDSA-signed license tokens to buyers on purchase, verified
**offline** with the seller's public key (no callback at verify time). Distinct
from `src/lib/license/verify.ts`, which licenses Sellf-the-product itself.

**Flow:** a seller turns on "Issue a license key on purchase" per product
(Settings → System holds their keypair; products carry `issue_license_on_purchase`,
`license_tier`, `license_duration_days`). On a completed Stripe purchase the webhook
calls `issueLicense`, which signs a token (`payloadB64url.sigB64url`, claims
`{v,kid,product,email,order,tier,iat,exp}`) and records it in `issued_licenses`
(idempotent per order). The token rides on the `purchase.completed` webhook payload
(`licenseKey`) for delivery. Buyers verify it against the seller's public keys from
`GET /api/licenses/jwks?seller=<id>`.

**Custody (both supported):** `managed` — Sellf generates the keypair; `byok` — the
seller uploads their own private key. Private keys are encrypted at rest with
`APP_ENCRYPTION_KEY` (same mechanism as Stripe secrets) and never leave the service
role; the public-keys endpoint reads only public material via a `SECURITY DEFINER`
function. Issuance failures leave fulfillment unfinished and request another attempt.

**Pieces:** `src/lib/license-keys/{format,keys,issue,sdk}.ts`, `src/app/api/licenses/jwks/route.ts`,
`src/lib/actions/license-config.ts`, `src/components/ProductFormModal/sections/LicenseSection.tsx` +
`src/components/settings/LicenseKeysSettings.tsx`, migration `20260529000000_license_keys.sql`.
`verifySellfLicense` (`sdk.ts`) is the reference offline verifier sellers can copy.

**Revocation:** licenses verify offline, so a refunded/abused token would work until
expiry. Revocation happens **automatically** on full refund + chargeback (the Stripe webhook
calls `revokeLicensesForOrder`, keyed on `paymentIntentId || sessionId`) and **manually** via
`DELETE /api/admin/licenses/:id`. Both flip `revoked_at`. Two surfaces then turn the token off:

- **CRL (k-anonymity range query)** — `GET /api/licenses/revoked?seller=<id>&prefix=<hex>`.
  The consumer computes `SHA-256(order)`, sends a short hex **prefix** (4 chars) of that hash,
  and gets back only the revoked hashes in that bucket (via the `seller_revoked_orders(uuid,text)`
  SECURITY DEFINER RPC — **service-role only**, with an internal hex guard so a `%`/`_` can't
  widen the bucket). No full-dump mode, so the revocation count can't be scraped and the server
  never sees the full hash. Never exposes tokens/PII. Consumer side lives in the unified
  ReplyStack/PostStack repo (`src/lib/license/revocation.ts` + `gate.ts`).
- **`license.revoked` webhook** — both revocation paths call `emitLicenseRevokedWebhooks`
  (`lib/services/license-revoke-webhook-payload.ts`) so a seller's integration reacts immediately.
  **Pro-gated** twice: subscribing to the event (`findDeniedEventFeature` on the `/api/v1/webhooks`
  write path) and dispatch (`checkFeature('license-revoked-webhook')`) — feature key in
  `lib/license/features.ts`, event→feature map in `EVENT_FEATURE_REQUIREMENTS`. Payload carries the
  order, customer, tier, domain, issuance source and the CRL URL — **never the signed token**.
  Fire-and-forget: it never throws, so a webhook failure neither undoes a revocation nor causes a
  Stripe refund/dispute event to be redelivered; the queue worker retries failed deliveries.

### Generated legal documents (Terms of Service, Privacy Policy)

`POST /api/legal/generate` calls the external legal-engine service and stores the rendered
HTML in the `legal` Storage bucket via `publishSnapshot` (`src/lib/legal/storage.ts`), same as
before. What changed: the bucket is **private**, and `shop_config.terms_of_service_url` /
`privacy_policy_url` are set to `/legal/terms` / `/legal/privacy` — a Sellf page, never the
storage object's own URL.

**Why not link storage directly:** Supabase Storage serves `text/html` objects as `text/plain`
(confirmed in `storage-api`'s renderer, cloud and self-hosted alike — see the B10 audit), so a
buyer clicking "Terms" would see raw markup (`<h2>`, `<li>`, …) as literal text instead of a
document. On Coolify-style installs the stored `SUPABASE_URL` is also an internal address
(`http://kong:8000/...`) the buyer's browser can never reach.

**The fix:** `/legal/[type]/page.tsx` reads the stored object with the **service-role** client
(fixes the internal-URL problem), parses it with `hast-util-from-html`, sanitizes it against a
narrow allowlist (`LEGAL_SCHEMA` in `src/lib/legal/sanitize-legal-html.ts` — derived from the
tags/attributes the legal-engine is actually known to emit: headings, lists incl. `ol[start]`,
tables, links, `pre/code`; no `id`/`class`/`style`/`title` on anything), and renders it with
`hast-util-to-jsx-runtime` (`src/components/legal/LegalDocument.tsx`) — never
`dangerouslySetInnerHTML`. The sanitizing step matters because this document now renders on the
admin panel's own origin, where the session cookie is `httpOnly: false`.

Already-published documents do not need to be regenerated: the migration that ships this
(`supabase/migrations/20260924000000_access_scope_tightening.sql`) only rewrites the stored
`shop_config` URL (matched by our own bucket's storage path, so an admin-typed external URL is
left untouched) and flips `storage.buckets.public` to `false` for `legal`.

`/polityka-prywatnosci` redirects to `/privacy` — the legal-engine terms template hardcodes a
link to that path, which Sellf never had.

### Element gating (per-element content + features)

Where the login wall gates a whole page, **element gating** lets a seller gate
individual elements on their own page and show different content per visitor
state — buyer, signed-in non-buyer, and guest. It shares the login-wall token
mechanism (same `LOGINWALL_SECRET`, same fragment handoff, same embed allowlist).

**Flow:** the seller pastes the gating snippet (Products menu → "Generate gating
snippet"). On load it sends the visitor through `/loginwall/gate?products=…` which —
unlike the whole-page wall — never bounces; it always returns to the page with a
signed multi-product state token in the URL fragment. The runtime at
`/api/loginwall/gate.js` reads the token, resolves each gated element, and strips
the token from the URL.

**Markup contract** (per gated block): `[data-sellf-product="<slug>"]` wrapping any
of `[data-has-access]`, `[data-no-access]`, `[data-no-session]`; the runtime keeps
the branch matching the visitor's state and removes the others (CSS hides everything
until resolved to avoid a flash). `[data-sellf-feature="<slug>"]` controls are enabled
only for owners. For an action that runs on a backend, gate it on
`SellfGate.verify(slug)` (POST to `/api/loginwall/verify?product=<slug>`, the slug
URL-encoded and repeated in the body): the token authenticates identity for the
products listed in its `products` request (any other slug is denied) and the server
**re-reads live access** (`user_product_access`), so a revoked or expired grant is
denied immediately rather than after the token TTL. Display and in-browser features
resolve client-side from the token and are best-effort.

The `?product=` query param exists so the browser's CORS preflight (`OPTIONS`) can
check the *right* product's seller allowlist before the actual `POST` — without it,
the preflight had no way to know which allowlist applied and had to accept any
well-formed origin (the real access check still happened on `POST`, which always
scoped CORS correctly, so this was a preflight-only gap, not a way to read another
seller's data). Sellers never touch this: the pasted snippet (`buildGateSnippet`,
the `<script src=".../api/loginwall/gate.js?...">` tag) is unchanged — the query
param is added by the runtime `gate.js` serves (`buildGateScript`), so it updates
automatically the next time a customer page loads. A direct browser call to
`/api/loginwall/verify` that does not go through `SellfGate.verify()` must add `?product=<slug>`
itself or its preflight will not reflect the origin. Server-to-server calls (no
`Origin` header, see below) are unaffected either way — CORS preflights only happen
from a browser.

**Server-side verification pattern** (for real back-end actions): `SellfGate.verify()`
returns a `Promise<boolean>` in the browser — the check runs on the Sellf server, but
the result lands back in the browser. For truly sensitive server actions (charging,
file delivery, data mutations), the seller's backend should independently call
`POST /api/loginwall/verify` server-to-server with the token forwarded from the client.
CORS does not apply to server-to-server calls (no `Origin` header), so the request
goes through normally and returns `{ access: true/false }`. Gate tokens have a 30-minute
TTL and are **not** single-use — for one-time operations add an idempotency key.

Pattern for the seller's backend:
```
// Browser: after verify() passes, forward the token
fetch("/your-endpoint", {
  method: "POST",
  headers: { "Authorization": "Bearer " + SellfGate.token },
});

// Seller's Node.js backend:
const r = await fetch("https://YOUR_SELLF/api/loginwall/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": req.headers["authorization"] },
  body: JSON.stringify({ product: "slug" }),
});
const { access } = await r.json();
if (!access) return res.status(403).end();
```

This pattern works identically from PHP (`wp_remote_post`), Python (`requests.post`), or
any HTTP client. The GateSnippetModal ("Generate gating snippet") includes a live
expandable "Advanced" section with ready-to-paste examples for Node.js, PHP/WordPress,
Python (Flask + Django), and cURL.

**Pieces:**

- Token: `src/lib/loginwall/token.ts` — `signGateToken`/`verifyGateToken`/`parseGatePayload` (v2, multi-product + auth flag) alongside the v1 login-wall token.
- Shared request helpers: `src/lib/loginwall/request.ts` (redirect parsing, origin, allowlist) — used by both `protect` and `gate`.
- Snippet + runtime builders: `src/lib/loginwall/gate-snippet.ts`.
- Routes: `src/app/[locale]/loginwall/gate/route.ts`, `src/app/api/loginwall/gate.js/route.ts`, `src/app/api/loginwall/verify/route.ts`.
- Admin UI: `GateSnippetModal` + the "Generate gating snippet" product action.
- Examples: `public/gate-examples/index.html` (self-contained interactive demo of all states/features) and `public/gate-examples/live-integration.html` (deploy-ready snippet + markup reference).

### Telemetry (anonymous usage stats)

Sellf phones home with **anonymous, opt-out** usage telemetry (model: n8n's
`N8N_DIAGNOSTICS_ENABLED`). It exists so the project can see feature adoption and
runtime mix. **Disclosure-only, never PII.**

**Trigger:** the Next.js `src/instrumentation.ts` `register()` hook calls
`startTelemetry()` on boot (which prints the one-line console notice), then an
hourly in-process `setInterval` (`scheduler.ts`, mirrors `supabase/keep-alive.ts`)
wakes the cycle. The real cadence gate is the DB, not the timer: `runTelemetryCycle`
(`send.ts`) does an atomic **claim → collect → post → confirm**. `telemetry_claim_send`
(a single `UPDATE … RETURNING` on the `telemetry_state` singleton) returns a row only
when the ~20h send window has elapsed AND the 1h retry lease is free, so concurrent
ticks/restarts can never double-send; `telemetry_confirm_send` stamps `last_sent_at`
on success. Only arms when `NODE_ENV=production`, telemetry is enabled, and the
deployment host is public (skips localhost / private / dotless hosts).

**Metrics RPC:** `get_telemetry_metrics()` — one round-trip, `SECURITY DEFINER`,
`service_role`-only, `count(*)` aggregates only (products/users/transactions/etc.).
It **never** sums amounts and never selects emails or customer rows. Counts are
clamped client-side and capped at the receiver.

**Opt-out: ENV-ONLY — there is NO UI toggle and NO banner.** Set
`SELLF_TELEMETRY_DISABLED=true` or `SELLF_TELEMETRY_ENABLED=false`
(`config.ts → isTelemetryEnabled`).

**Anonymity guarantees:** a random per-instance id from `telemetry_state`
(`gen_random_uuid()`, NOT derived from domain/license), license_tier only, coarsened
host facts (CPU/RAM bands, OS, arch, runtime major — `coarsen.ts`). NEVER sends:
emails, customer rows, revenue/amounts, raw domain, license key, or IP. The wire
envelope is validated via `telemetryEnvelopeSchema` (`contract.ts`) and
**self-validated before every send**: the top level and `identity` are `.strict()`, so
no extra/PII top-level or identity field is possible; `deployment` and `metrics` are
curated coarse maps (`deployment` = fixed coarsened keys + a curated `flags` object;
`metrics` = numeric counts only — `z.number()` values, so no string can ride in
metrics). Outbound is SSRF-guarded (https-only host guard + `redirect: 'error'`, 10s
timeout, one retry; never throws).

**Receiver:** `https://telemetry.techskills.academy/v1/ingest` (default), overridable
with `TELEMETRY_URL` (must be https; private/loopback rejected). Reports retained 120
days. Because it is anonymous with no personal data, **no DPA is required**.

**Module layout** (`src/lib/telemetry/`):
- `constants.ts` — project/schema version, default URL, window/lease/poll/boot timings.
- `config.ts` — `isTelemetryEnabled`, `isNonDeploymentHost`, `resolveTelemetryUrl`, `assertSafeOutboundUrl` (SSRF guard).
- `identity.ts` — `readInstanceId`, `claimSend`/`confirmSend` (atomic claim-then-confirm RPC wrappers).
- `coarsen.ts` — pure bucketing of CPU/RAM/version (no I/O).
- `collect.ts` — `collectMetrics` (RPC), `collectDeployment` (coarsened host + DB/env feature flags), `collectLicenseTier`; each fail-safe.
- `contract.ts` — strict zod envelope + `buildEnvelope`.
- `send.ts` — `postTelemetry` (transport) + `runTelemetryCycle` (orchestration).
- `scheduler.ts` — idempotent `startTelemetry`/`stopTelemetry` timers.
- Wired in `admin-panel/src/instrumentation.ts` (MUST live under `src/` — with a `src` directory Next.js only loads instrumentation from there, never from the project root; at the root it is silently never compiled/run); DB in `supabase/migrations/20260627120000_telemetry.sql`.
- User-facing disclosure: `README.md` (Telemetry section), `admin-panel/.env.example` (§12), `docs-site/.../telemetry.md`.

### Stable Versions & Known Issues

- **Supabase CLI**: 2.101.0 (run via `npx supabase`) — pin via `npx supabase@2.101.0` if needed

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
- Verify product slug matches database
- Check RLS policies in Supabase Studio
- Confirm user has active session
- Look at server logs from the `/api/verify-payment` and webhook handlers

### CORS Issues with Embed Checkout
- Verify `MAIN_DOMAIN` environment variable
- Confirm the seller's domain is in `seller_embed_settings.allowed_embed_origins` or env `SELLF_EMBED_ALLOWED_ORIGINS`
- Inspect the OPTIONS preflight to `/api/embed/checkout-session` in the browser network tab

### Testing Complex Flows (Playwright)
- **Magic Links:** Use `Mailpit` API to capture emails and extract tokens programmatically
- **Consent Banners (vanilla-cookieconsent):** Banners block UI interactions in tests. Use a helper (e.g., `acceptAllCookies`) to inject the consent cookie *before* navigation to bypass the banner
- **Race Conditions:** When testing high-concurrency scenarios (like multiple signups), ensuring DB triggers use transaction-level locks (`pg_advisory_xact_lock`) prevents "tuple concurrently updated" errors
- **Currency conversion (`currency-conversion.spec.ts`, `currency-config.spec.ts`):** the E2E dev server never calls the real frankfurter.dev host. `playwright.config.ts` starts a tiny local fixed-rate server (`scripts/fx-rate-stub-server.mjs`) as an extra `webServer` entry and points the dev server's `ECBProvider` at it via `CURRENCY_ECB_BASE_URL` (see `.env.example`). This keeps the suite deterministic and independent of network/third-party uptime. The override is a test-only seam — `assertCurrencyProviderBaseUrl` (`src/lib/security/startup-assertions.ts`) refuses to boot in production if `CURRENCY_ECB_BASE_URL` is set to anything other than the real host.

## File Structure Context

```
sellf/
├── index.html                     # Main landing page
├── themes/                        # CSS themes (dark.css, light.css)
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
        │       ├── runtime-config/route.ts   # Client config
        │       ├── create-embedded-checkout/route.ts
        │       ├── verify-payment/route.ts
        │       ├── validate-email/route.ts
        │       ├── embed/                    # External-page embed checkout
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
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Stripe
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# URLs
SITE_URL=http://localhost:3000
MAIN_DOMAIN=localhost:3000

# Cloudflare Turnstile (CAPTCHA)
NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY=...
CLOUDFLARE_TURNSTILE_SECRET_KEY=...

# Login Wall (HMAC for the content-gating handoff token — see "Login Wall" above)
LOGINWALL_SECRET=  # openssl rand -hex 32

# AES-256-GCM key encrypting every DB-stored secret (Stripe DB-mode key, webhook
# signing secret, license-issuer keys). Production startup refuses to boot without
# a valid one (see startup-assertions.ts).
APP_ENCRYPTION_KEY=  # openssl rand -base64 32

# HMAC binding checkout sessions to their buyer/product. Production startup
# refuses to boot without it (min 16 chars).
CHECKOUT_BINDING_SECRET=  # openssl rand -base64 32
```

Public instance URLs resolve at runtime from `SITE_URL`, then `MAIN_DOMAIN` (HTTPS;
localhost uses HTTP), then non-placeholder legacy `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_APP_URL`. Release installs do not need the
`NEXT_PUBLIC_*` URL variables. Set `SITE_URL` to the public origin without a path;
production refuses to boot without a usable configured origin. The resolver rejects
build placeholders. Shared browser redirect checks use `window.location.origin`;
client OTO builders receive `siteUrl` from runtime-config explicitly.

Supabase Auth must separately allow `${SITE_URL}/auth/callback` (or `${SITE_URL}/**`)
in its redirect URL list. Keep the email template mirrors byte-identical: they append
`&token_hash` to `.RedirectTo`; Sellf guarantees an absolute callback with a query.
A service-role key cannot read the hosted Auth redirect allowlist cheaply, so startup
cannot verify that provider-side setting. An incorrect allowlist causes Supabase to
substitute its Site URL and breaks the email. Verify a real delivered email after setup.

## CI/CD & Release Flow

### Creating a release

Releases are manual. CI builds the `sellf-build.tar.gz` artifact automatically.

**Versioning: CalVer `YYYY.M.patch`** (e.g. `2026.3.0`, `2026.3.1`). Year + month of release + patch counter within that month. No semver — Sellf is an end-user product, not a library.

**Before creating a release, bump the version in all these files:**

| File | Field | Example |
|------|-------|---------|
| `package.json` (root) | `"version"` | `"2026.3.0"` |
| `admin-panel/package.json` | `"version"` | `"2026.3.0"` |
| `docker-compose.yml` | `image` default | `${SELLF_VERSION:-2026.3.0}` |
| `.env.docker.example` | commented `SELLF_VERSION` | `2026.3.0` |
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

### Release signing

Before packaging and signing, the release build runs
`admin-panel/scripts/check-build-artifact.sh` against `.next/server` and every
standalone `.next/server` tree. No placeholder host/key literals are allowlisted in
server artifacts. `node admin-panel/scripts/run-runtime-url-tests.mjs` builds with
CI placeholders and runs production on port 3777 with runtime `SITE_URL`; it verifies
real Mailpit login/free-access emails, Stripe embed return URLs, sitemap and metadata.
It requires an existing local Supabase, the 3777 Auth redirect allowlist, and a test-mode
Stripe key. It never resets the database; fixtures belong only to that test run.
The production E2E solves real ALTCHA challenges because provider=none is fail-closed
in production. The full test runner includes this release regression.

Each release carries four assets: `sellf-build.tar.gz`, `sellf-build.tar.gz.sha256` (plain
`sha256sum` output, unsigned, kept for tools that read it), `sellf-build.manifest` and
`sellf-build.manifest.sig`. The manifest is exactly two LF-terminated lines, in this order, with
nothing after the second newline:

```
version=2026.10.0
sha256=<64 lowercase hex: sha256 of sellf-build.tar.gz>
```

`version` is the release tag without its leading `v` (CalVer `YYYY.M.patch`). The `.sig` is a raw
Ed25519 signature over the exact manifest bytes (`openssl pkeyutl -sign -rawin`), made in CI
("Write and sign release manifest" step) with the private key from the GitHub Actions secret
`RELEASE_SIGNING_KEY` (PEM). The step fails the release if the secret is missing, if the tag is not
strict `v?YYYY.M.patch` (no prerelease suffix) or differs from `admin-panel/package.json`, if
`upgrade.sh` still holds the placeholder key, or if the signature does not verify against the
public key embedded in `admin-panel/scripts/upgrade.sh` (which must equal
`admin-panel/scripts/release-signing-key.pub.pem`). `upgrade.sh` trusts only the signed manifest,
never the plain `.sha256`.

- **Trust anchor:** the PEM between `# release-signing-key:start` / `:end` in `upgrade.sh`. The check
  uses the copy in the **already-installed** script, never anything from the download.
  `admin-panel/scripts/release-signing-key.pub.pem` is an auditable mirror; a unit test keeps it
  byte-identical to the embedded key. Rotating the key = ship a release signed with the OLD key
  that contains the NEW public key, then switch the secret.
- **Order in `upgrade.sh`:** download manifest + `.sig` → verify signature → parse manifest (strict
  two-line format; version must equal the release tag minus its `v`) → compare with the installed version →
  download tarball → sha256 against the manifest → archive entry validation → extract.
- **Installed version:** first line of `<install dir>/version.txt` (written by CI from
  `package.json`, copied on every install/upgrade), falling back to `version` in
  `<install dir>/package.json`. Unreadable → the upgrade is refused.
- **Version rule:** fields compared as numbers (`2026.10.0` > `2026.9.10`); a `v` on the installed
  version is ignored. Older than installed → refused. Equal → reinstalled through the normal install
  path with every check (the admin UI's "Reinstall" button). Newer → installed.
- **No override:** a missing or invalid signature, a malformed manifest, or an older version is
  always refused; there is no environment switch. OpenSSL ≥ 1.1.1 with Ed25519 is required (not
  LibreSSL).
- **Bootstrap:** the first upgrade *to* the first signed release is performed by the previous,
  non-verifying script; verification applies from the next upgrade onward.

Verify a release by hand (only `openssl` + `sha256sum` needed):

```bash
V=v2026.10.0   # release tag
for f in sellf-build.tar.gz sellf-build.manifest sellf-build.manifest.sig; do
  curl -fsSLO "https://github.com/jurczykpawel/sellf/releases/download/$V/$f"; done
curl -fsSLO https://raw.githubusercontent.com/jurczykpawel/sellf/main/admin-panel/scripts/release-signing-key.pub.pem
openssl pkeyutl -verify -pubin -inkey release-signing-key.pub.pem -rawin \
  -in sellf-build.manifest -sigfile sellf-build.manifest.sig          # "Signature Verified Successfully"
grep -qx "sha256=$(sha256sum sellf-build.tar.gz | awk '{print $1}')" sellf-build.manifest \
  && echo "sellf-build.tar.gz: OK"                                    # hash matches the signed manifest
grep -x "version=${V#v}" sellf-build.manifest                        # signed version is the tag you asked for
```

### Docker image signing

The `docker` job pushes `ghcr.io/<owner>/sellf` and exposes the pushed image's digest as a job
output. The `latest` tag only moves on a real `release` event (`type=raw,value=latest,enable=${{
github.event_name == 'release' }}`), never on a `workflow_dispatch` re-run of an old tag, and the
same strict version gate as the tarball manifest runs before login/push, so a malformed or
mismatched tag never reaches GHCR.

A separate job, `sign-image` (`needs: [build, docker]`), then signs that digest so a Docker install
can pin and verify it instead of trusting the mutable `latest` tag. It writes `sellf-image.manifest`,
exactly two LF-terminated lines, nothing after the second newline:

```
version=2026.10.0
image=ghcr.io/jurczykpawel/sellf@sha256:<64 lowercase hex>
```

Line 2 is `image=`, never `sha256=` — that keeps this format disjoint from `sellf-build.manifest`
(line 2 `sha256=`), so a signed tarball manifest can never be replayed as an image manifest or vice
versa. Signing and verification reuse the exact same Ed25519 mechanism as the tarball manifest, via
the shared `admin-panel/scripts/ci/sign-manifest.sh sign|verify` helper: sign with
`RELEASE_SIGNING_KEY`, then verify against the same public key embedded in `upgrade.sh` before
upload. `sellf-build.manifest`, its signing step, and `upgrade.sh` itself are untouched by this —
`upgrade.sh` only ever serves the standalone/PM2 layout, and the image does not ship it.

If the `docker` job fails, only `sign-image` is skipped: the tarball release stays valid for PM2
installs, and a Docker install refuses cleanly for lacking a signed image rather than falling back to
an unsigned one.

Verify a released image by hand:

```bash
V=v2026.10.0
for f in sellf-image.manifest sellf-image.manifest.sig; do
  curl -fsSLO "https://github.com/jurczykpawel/sellf/releases/download/$V/$f"; done
curl -fsSLO https://raw.githubusercontent.com/jurczykpawel/sellf/main/admin-panel/scripts/release-signing-key.pub.pem
openssl pkeyutl -verify -pubin -inkey release-signing-key.pub.pem -rawin \
  -in sellf-image.manifest -sigfile sellf-image.manifest.sig          # "Signature Verified Successfully"
grep -x "version=${V#v}" sellf-image.manifest                        # signed version is the tag you asked for
IMAGE_REF="$(grep '^image=' sellf-image.manifest | cut -d= -f2-)"
docker pull "$IMAGE_REF"                                              # pulls by digest, not by mutable tag
docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$IMAGE_REF"
```

### Deploying to server (stackpilot)

Deploy scripts live in a separate repo: `jurczykpawel/stackpilot`.

```bash
# Fresh install
./local/deploy.sh sellf --ssh=mikrus --domain=example.com

# Update an existing instance (downloads latest GitHub release tarball)
./local/deploy.sh sellf --ssh=mikrus --update --instance=tsa
./local/deploy.sh sellf --ssh=mikrus --update --instance=demo

# Update with local build file (when no release exists yet)
./local/deploy.sh sellf --ssh=mikrus --update --instance=tsa --build-file=~/sellf-build.tar.gz

# Restart only (after .env.local changes, no file update)
./local/deploy.sh sellf --ssh=mikrus --update --instance=tsa --restart
```

Multi-instance: pass `--instance=<name>` so the script targets the right
`/opt/stacks/sellf-<name>/` directory and `pm2 restart sellf-<name>`.

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
   - `docs-site/src/content/docs/` - User-facing docs (Starlight → https://docs.sellf.app); deploy guides, Quick Start, API, configuration
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
CREATE TABLE public.my_table (...);
ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;

-- Explicit policies (even if service_role-only)
CREATE POLICY "Service role full access" ON public.my_table
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admin read" ON public.my_table
  FOR SELECT TO authenticated USING ((select public.is_admin()));

-- Explicit grants (NEVER rely on default privileges)
REVOKE ALL ON public.my_table FROM anon, authenticated;
GRANT SELECT ON public.my_table TO authenticated;
GRANT ALL ON public.my_table TO service_role;
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
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- CORRECT: explicit per-table
GRANT SELECT ON public.products TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_product_access TO authenticated;
GRANT ALL ON public.products TO service_role;
-- Default privileges only for service_role:
ALTER DEFAULT PRIVILEGES IN SCHEMA public
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
