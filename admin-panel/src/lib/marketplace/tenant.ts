/**
 * Marketplace Tenant Resolution
 *
 * Utilities for extracting seller slugs from URLs, validating schema names,
 * and resolving seller routes in the marketplace.
 *
 * @see priv/MARKETPLACE-PLAN.md — routing URL section
 * @see supabase/migrations/20260311000001_marketplace_sellers.sql — sellers table
 */

// ===== URL PATTERNS =====

/** Regex to match seller routes: /s/{slug} or /{locale}/s/{slug} */
const SELLER_ROUTE_REGEX = /^\/(?:(?:en|pl)\/)?s\/([a-z0-9][a-z0-9_-]{0,49})(?:\/|$)/;

/** Reserved slugs that cannot be used as seller slugs.
 * Must stay aligned with SQL in provision_seller_schema()
 * @see supabase/migrations/20260311000001_marketplace_sellers.sql
 */
const RESERVED_SLUGS = new Set([
  // Core app routes
  'admin', 'api', 'auth', 'public', 'main', 'test', 'demo',
  'system', 'platform', 'seller', 'sellers',
  // Supabase internal schemas
  'storage', 'graphql', 'graphql_public', 'realtime', 'pgsodium',
  'pgsodium_masks', 'pgsodium_keyiduser', 'supabase_functions',
  'supabase_migrations', 'extensions', 'vault', 'pgbouncer',
  // Common reserved names
  'www', 'app', 'mail', 'smtp', 'ftp', 'root', 'support', 'help',
  'billing', 'checkout', 'login', 'signup', 'register', 'dashboard',
  'settings', 'config', 'webhook', 'webhooks', 'stripe', 'payment',
  'payments', 'status', 'health', 'monitor', 'internal',
]);

// ===== FUNCTIONS =====

/**
 * Check if a pathname is a seller route (starts with /s/ or /{locale}/s/)
 */
export function isSellerRoute(pathname: string): boolean {
  return SELLER_ROUTE_REGEX.test(pathname);
}

/**
 * Extract seller slug from a pathname.
 * Returns null if the pathname is not a seller route or slug is reserved.
 *
 * Examples:
 *   /s/nick → 'nick'
 *   /en/s/nick/product → 'nick'
 *   /pl/s/my-shop → 'my-shop'
 *   /s/admin → null (reserved)
 *   /p/product → null (not a seller route)
 */
export function extractSellerSlug(pathname: string): string | null {
  const match = pathname.match(SELLER_ROUTE_REGEX);
  if (!match) return null;

  const slug = match[1];
  if (RESERVED_SLUGS.has(slug)) return null;

  return slug;
}

/**
 * Normalize a seller slug to a PostgreSQL schema name.
 * Matches the sanitization logic in provision_seller_schema().
 *
 * @returns schema name like 'seller_nick_greenawalt' or null if invalid
 */
export function normalizeSchemaName(slug: string): string | null {
  if (!slug || slug.length === 0) return null;

  // Same sanitization as SQL: lowercase, non-alnum → _, collapse, trim
  let clean = slug.toLowerCase();
  clean = clean.replace(/[^a-z0-9]/g, '_');
  clean = clean.replace(/_+/g, '_');
  clean = clean.replace(/^_|_$/g, '');

  if (clean.length < 2 || clean.length > 50) return null;
  if (RESERVED_SLUGS.has(clean)) return null;

  return `seller_${clean}`;
}

/**
 * Validate that a schema name follows the seller_ prefix convention.
 */
export function isValidSellerSchema(schemaName: string): boolean {
  return /^seller_[a-z0-9_]{2,50}$/.test(schemaName)
    && schemaName !== 'seller_main'; // seller_main is owner, not a marketplace seller
}

/**
 * Extract the sub-path after the seller slug.
 * Used to determine which page to render within a seller's storefront.
 *
 * Examples:
 *   /s/nick → ''
 *   /s/nick/my-product → 'my-product'
 *   /en/s/nick/my-product → 'my-product'
 *   /s/nick/checkout → 'checkout'
 */
export function extractSellerSubpath(pathname: string): string {
  // Remove locale prefix if present
  const withoutLocale = pathname.replace(/^\/(?:en|pl)/, '');
  // Match /s/{slug}/{subpath}
  const match = withoutLocale.match(/^\/s\/[a-z0-9][a-z0-9_-]*\/(.+)$/);
  return match ? match[1] : '';
}

/**
 * Build a seller URL path.
 *
 * @param slug - seller slug
 * @param subpath - optional subpath (e.g., product slug, 'checkout')
 * @param locale - optional locale prefix
 */
export function buildSellerPath(
  slug: string,
  subpath?: string,
  locale?: string,
): string {
  const parts = [];
  if (locale) parts.push(locale);
  parts.push('s', slug);
  if (subpath) parts.push(subpath);
  return '/' + parts.join('/');
}
