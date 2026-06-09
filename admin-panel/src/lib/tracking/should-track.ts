/**
 * Pure path predicates shared by the client tracking layer.
 *
 * Kept React-free so the routing logic that decides whether analytics may fire
 * is unit-testable without rendering a client component.
 */

/**
 * True for admin-panel routes, where analytics must never fire (self-traffic,
 * privacy of admin actions, and a misconfigured server-side GTM URL stalling
 * page loads). Matches any path segment under `/dashboard` regardless of the
 * `/{locale}` prefix (e.g. `/pl/dashboard/products`).
 */
export function isAdminTrackingPath(pathname: string | null | undefined): boolean {
  return pathname?.includes('/dashboard') ?? false
}
