/**
 * What maintenance mode pauses: the shop pages, the checkout, embed checkout, the login wall and
 * every request that starts a NEW payment. Everything else keeps working: the admin panel and
 * sign-in, the buyer's account, Stripe webhooks, the payment return pages and payment confirmation
 * (so a purchase started before the break completes), API v1, cron, health and legal pages.
 *
 * Pure function of the path, so the proxy decides without any I/O for traffic that is never paused.
 *
 * @see src/proxy.ts
 */

export type MaintenanceSurface = 'page' | 'api';

const LOCALE_PREFIX = /^\/(en|pl)(?=\/|$)/;

const PAUSED_PAGES: RegExp[] = [
  /^\/$/,
  /^\/store(\/|$)/,
  // Product pages, but not /p/<slug>/payment-status (the return page of a payment already made).
  /^\/p\/[^/]+\/?$/,
  /^\/product\//,
  /^\/checkout(\/|$)/,
  /^\/offer\//,
  /^\/v\//,
  /^\/loginwall\//,
];

const PAUSED_API: RegExp[] = [
  /^\/api\/create-payment-intent\/?$/,
  /^\/api\/embed\//,
  /^\/api\/orders\/bank-transfer\/?$/,
  /^\/api\/orders\/[^/]+\/pay\/?$/,
  /^\/api\/public\/products\/[^/]+\/grant-access\/?$/,
  /^\/api\/coupons\//,
  /^\/api\/order-bumps(\/|$)/,
  /^\/api\/loginwall\//,
];

export function classifyMaintenancePath(pathname: string): MaintenanceSurface | null {
  if (pathname.startsWith('/api/')) {
    return PAUSED_API.some(pattern => pattern.test(pathname)) ? 'api' : null;
  }
  const path = pathname.replace(LOCALE_PREFIX, '') || '/';
  return PAUSED_PAGES.some(pattern => pattern.test(path)) ? 'page' : null;
}
