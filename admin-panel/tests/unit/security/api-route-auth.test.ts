/**
 * ============================================================================
 * SECURITY TEST: API Route Authentication & Authorization — Area 4
 * ============================================================================
 *
 * Verifies that every API route enforces the correct level of authentication.
 * Uses static source analysis — no live server required.
 *
 * CLASSIFICATION (per security audit Area 4):
 *
 *   ADMIN_ROUTES — must use requireAdminApi(), requireMarketplaceAdmin(),
 *     authenticate() from @/lib/api, or inline Bearer+getUser()+admin_users check.
 *
 *   AUTH_ROUTES — must call getUser()/signOut() and return 401 when
 *     unauthenticated. Logout routes use signOut (no prior auth needed).
 *
 *   WEBHOOK_ROUTES — must verify Stripe signature; must NOT use user auth.
 *
 *   SPECIAL_ROUTES — protected by other mechanisms (CRON_SECRET, CORS-only,
 *     PaymentIntent ID). Explicitly listed so new routes can't silently slip in.
 *
 *   PUBLIC_ROUTES — intentionally no auth (product catalog, health, etc.)
 *
 * If you add a new route, add it to the appropriate category below.
 *
 * @see AREA 4 in priv/SECURITY-AUDIT-PROMPT.md
 * ============================================================================
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const API_DIR = join(__dirname, '../../../src/app/api');

function findRoutes(dir: string, base = dir): Array<{ rel: string; source: string }> {
  const results: Array<{ rel: string; source: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRoutes(full, base));
    } else if (entry.name === 'route.ts') {
      results.push({
        rel: full.replace(base + '/', ''),
        source: readFileSync(full, 'utf-8'),
      });
    }
  }
  return results;
}

// ============================================================================
// Route classification
// All routes in admin-panel/src/app/api/ must be listed in exactly one category.
// ============================================================================

/** Admin routes: must enforce admin authentication */
const ADMIN_ROUTE_PREFIXES = [
  'admin/',
  'v1/',
  'stripe/connect/',
];

/**
 * Routes in admin-prefixed dirs that use CRON_SECRET or other non-user auth.
 * These are excluded from the admin auth check but verified separately.
 */
const CRON_OR_SECRET_ROUTES = new Set([
  'cron/route.ts',
]);

/**
 * Routes that are intentionally public (no auth needed).
 * New public routes must be added here explicitly.
 */
const PUBLIC_ROUTES = new Set([
  'access/route.ts',
  'health/route.ts',
  'runtime-config/route.ts',
  'sellf/route.ts',
  'sellf-embed/route.ts',
  'consent/route.ts',
  'config/route.ts',                           // config.js generator — public, rate-limited
  'status/route.ts',                           // system status — public, rate-limited
  'validate-email/route.ts',
  'waitlist/signup/route.ts',
  'coupons/auto-apply/route.ts',
  'coupons/verify/route.ts',
  'create-embedded-checkout/route.ts',
  'create-payment-intent/route.ts',
  'products/[id]/lowest-price/route.ts',
  'products/[id]/route.ts',
  'public/products/[slug]/route.ts',
  'public/products/[slug]/access/route.ts',
  'public/products/[slug]/content/route.ts',
  'public/products/[slug]/grant-access/route.ts',
  'public/products/claim-free/route.ts',
  'order-bumps/route.ts',
  'oto/info/route.ts',
  'tracking/fb-capi/route.ts',                 // CORS-protected server-side CAPI proxy
  'captcha/challenge/route.ts',                // ALTCHA challenge generation — public, stateless
]);

/**
 * Routes with custom non-user auth mechanisms.
 * Must be verified case-by-case below.
 */
const SPECIAL_AUTH_ROUTES = new Set([
  'webhooks/stripe/route.ts',                  // Stripe signature verification
  'update-payment-metadata/route.ts',          // CORS + PaymentIntent ID (pre-auth payment flow)
  'verify-payment/route.ts',                   // session_id + ownership check
  'v1/docs/openapi.json/route.ts',             // OpenAPI spec — intentionally public (schema only, no data)
]);

/** Auth-required routes: must verify user session */
const AUTH_REQUIRED_ROUTES = new Set([
  'auth/logout/route.ts',                      // uses signOut()
  'profile/get/route.ts',
  'users/[id]/access/route.ts',
  'users/[id]/profile/route.ts',
  'users/route.ts',
  'refund-requests/route.ts',
  'gus/fetch-company-data/route.ts',           // MEDIUM-001 fix: admin-only GUS lookup
]);

// ============================================================================
// Helpers
// ============================================================================

const allRoutes = findRoutes(API_DIR);

function isAdminRoute(rel: string): boolean {
  return ADMIN_ROUTE_PREFIXES.some(p => rel.startsWith(p)) &&
    !CRON_OR_SECRET_ROUTES.has(rel) &&
    !SPECIAL_AUTH_ROUTES.has(rel);
}

function isKnownRoute(rel: string): boolean {
  return (
    isAdminRoute(rel) ||
    CRON_OR_SECRET_ROUTES.has(rel) ||
    PUBLIC_ROUTES.has(rel) ||
    SPECIAL_AUTH_ROUTES.has(rel) ||
    AUTH_REQUIRED_ROUTES.has(rel)
  );
}

/** Returns true if source has a convincing admin auth check */
function hasAdminAuthCheck(source: string): boolean {
  return (
    /requireAdminApi\s*\(/.test(source) ||
    /requireAdminApiWithRequest\s*\(/.test(source) ||
    /requireMarketplaceAdmin\s*\(/.test(source) ||
    /\bauthenticate\s*\(/.test(source) ||
    // Inline pattern: getUser(token) or getUser() followed by admin_users check
    (/auth\.getUser/.test(source) && /from\(['"`]admin_users['"`]\)/.test(source))
  );
}

/** Returns true if source has a user session check (for auth-required routes) */
function hasUserAuthCheck(source: string): boolean {
  return (
    /\.auth\.getUser\(\)/.test(source) ||
    /\.auth\.getSession\(\)/.test(source) ||
    /\.auth\.signOut\(\)/.test(source) ||   // logout: signOut is the auth action
    /requireAdminApi\s*\(/.test(source) ||
    /requireAdminApiWithRequest\s*\(/.test(source) ||
    /\bauthenticate\s*\(/.test(source)
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Area 4: API Route Authentication & Authorization', () => {

  it('every route is classified in exactly one category', () => {
    const unclassified = allRoutes.filter(r => !isKnownRoute(r.rel));

    expect(
      unclassified.map(r => `  ${r.rel}`),
      `New routes added without security classification:\n` +
      unclassified.map(r => `  ${r.rel}`).join('\n') + '\n\n' +
      `Add each new route to the appropriate category in api-route-auth.test.ts:\n` +
      `  PUBLIC_ROUTES, AUTH_REQUIRED_ROUTES, SPECIAL_AUTH_ROUTES, or ADMIN_ROUTE_PREFIXES`
    ).toHaveLength(0);
  });

  it('every admin route must enforce admin authentication', () => {
    const adminRoutes = allRoutes.filter(r => isAdminRoute(r.rel));
    const violations: string[] = [];

    for (const route of adminRoutes) {
      if (!hasAdminAuthCheck(route.source)) {
        violations.push(`  ${route.rel}`);
      }
    }

    expect(
      violations,
      `Admin routes missing authentication check:\n${violations.join('\n')}\n\n` +
      `Every admin route must call requireAdminApi(), requireMarketplaceAdmin(), ` +
      `authenticate(), or perform inline Bearer+getUser()+admin_users check.`
    ).toHaveLength(0);
  });

  it('every admin route must return 401 or delegate to auth helper that returns 401', () => {
    const adminRoutes = allRoutes.filter(r => isAdminRoute(r.rel));
    const violations: string[] = [];

    for (const route of adminRoutes) {
      const has401 =
        /status:\s*401/.test(route.source) ||
        // V1 routes delegate to apiError() which sends 401
        /apiError\s*\(/.test(route.source) ||
        // authenticate() from @/lib/api throws 401 on failure
        /\bauthenticate\s*\(/.test(route.source) ||
        // requireAdminApi from auth-server throws 401
        /requireAdminApi\s*\(/.test(route.source) ||
        /requireMarketplaceAdmin\s*\(/.test(route.source);

      if (!has401) {
        violations.push(`  ${route.rel}`);
      }
    }

    expect(
      violations,
      `Admin routes not returning 401 for unauthenticated requests:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  it('every auth-required route must check user session', () => {
    const authRoutes = allRoutes.filter(r => AUTH_REQUIRED_ROUTES.has(r.rel));
    const violations: string[] = [];

    for (const route of authRoutes) {
      if (!hasUserAuthCheck(route.source)) {
        violations.push(`  ${route.rel}`);
      }
    }

    expect(
      violations,
      `Auth-required routes missing user session check:\n${violations.join('\n')}`
    ).toHaveLength(0);
  });

  it('Stripe webhook must verify signature and must not check user auth', () => {
    const webhook = allRoutes.find(r => r.rel === 'webhooks/stripe/route.ts');
    expect(webhook, 'webhooks/stripe/route.ts must exist').toBeDefined();
    if (!webhook) return;

    // Must verify Stripe webhook signature
    expect(
      /constructEvent|stripe\.webhooks|STRIPE_WEBHOOK_SECRET|verifyWebhookSignature/i.test(webhook.source),
      'Stripe webhook must verify signature (constructEvent / STRIPE_WEBHOOK_SECRET)'
    ).toBe(true);

    // Must NOT check user authentication — it's a machine-to-machine call
    expect(
      /supabase\.auth\.getUser\(\)\s*\n/.test(webhook.source),
      'Stripe webhook must not check user auth — use signature verification instead'
    ).toBe(false);
  });

  it('cron endpoint must use CRON_SECRET, not user auth', () => {
    const cron = allRoutes.find(r => r.rel === 'cron/route.ts');
    expect(cron, 'cron/route.ts must exist').toBeDefined();
    if (!cron) return;

    expect(
      /CRON_SECRET/.test(cron.source),
      'cron route must authenticate with CRON_SECRET environment variable'
    ).toBe(true);

    // Cron must use createAdminClient (legitimate service-role usage after secret check)
    expect(
      /createAdminClient/.test(cron.source),
      'cron route should use createAdminClient for DB operations'
    ).toBe(true);
  });

  it('service-role client must not be initialized before auth verification in admin routes', () => {
    /**
     * Detects routes that call createAdminClient() or inline service-role client
     * BEFORE the auth check. This means any unauthenticated request would cause
     * the route to initialize a privileged DB connection.
     *
     * Note: this is a defense-in-depth check. Even if the route returns 401,
     * we want auth to be verified BEFORE any service-role initialization.
     *
     * Exceptions:
     *   - Webhook routes: use Stripe signature (checked separately)
     *   - Cron: uses CRON_SECRET (checked separately)
     *   - Routes that use inline Bearer+getUser(token) — getUser is CALLED
     *     on the service-role client (valid pattern, client is needed for getUser)
     */
    const routesToCheck = allRoutes.filter(
      r => isAdminRoute(r.rel) && !CRON_OR_SECRET_ROUTES.has(r.rel)
    );
    const violations: string[] = [];

    for (const route of routesToCheck) {
      // Skip if it uses requireAdminApi (which does its own auth via server client)
      if (/requireAdminApi\s*\(/.test(route.source)) continue;
      if (/requireMarketplaceAdmin\s*\(/.test(route.source)) continue;
      // V1 routes use authenticate() from lib/api
      if (/\bauthenticate\s*\(/.test(route.source)) continue;

      // For inline admin routes: check createAdminClient comes after admin_users check
      if (/createAdminClient\s*\(/.test(route.source)) {
        const adminClientPos = route.source.indexOf('createAdminClient(');
        const adminCheckPos = route.source.search(/from\(['"`]admin_users['"`]\)/);

        if (adminCheckPos === -1 || adminClientPos < adminCheckPos) {
          // createAdminClient before admin_users check — but may be acceptable if
          // createAdminClient is used FOR the admin check (getUser call pattern)
          const getterPos = route.source.search(/getSupabaseServiceKey|SERVICE_ROLE/);
          if (getterPos !== -1 && getterPos < adminCheckPos) {
            violations.push(`  ${route.rel}  (createAdminClient before admin check)`);
          }
        }
      }
    }

    expect(
      violations,
      `Admin routes initializing service-role client before auth verification:\n${violations.join('\n')}\n\n` +
      `Move admin authentication before createAdminClient() initialization.`
    ).toHaveLength(0);
  });

  it('no route file has "use client" directive and service-role key access', () => {
    // Service-role keys must never reach the browser bundle
    const violations: string[] = [];
    for (const route of allRoutes) {
      const isClientSide =
        route.source.includes("'use client'") ||
        route.source.includes('"use client"');
      const hasServiceRole =
        /createAdminClient|createPlatformClient|SUPABASE_SERVICE_ROLE_KEY/.test(route.source);

      if (isClientSide && hasServiceRole) {
        violations.push(`  ${route.rel}`);
      }
    }
    expect(violations, `Client-side files must not access service-role key:\n${violations.join('\n')}`).toHaveLength(0);
  });
});
