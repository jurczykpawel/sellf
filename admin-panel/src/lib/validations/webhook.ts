/**
 * Webhook URL validation.
 *   isValidWebhookUrl(url)         — sync hostname/IP-pattern checks.
 *   validateWebhookUrlAsync(url)   — sync checks + DNS resolution. Use this
 *                                    when persisting an endpoint URL.
 */

import { isPrivateOrReservedIp } from '@/lib/security/ip-blocklist';
import { RESERVED_ENVELOPE_KEYS } from '@/lib/webhooks/payload-customization';

async function resolveAuthoritative(hostname: string): Promise<string[]> {
  const dns = await import('node:dns/promises');
  const [v4, v6] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ]);
  const addrs: string[] = [];
  if (v4.status === 'fulfilled') addrs.push(...v4.value);
  if (v6.status === 'fulfilled') addrs.push(...v6.value);
  return addrs;
}

export const WEBHOOK_URL_REASONS = [
  'https_required',
  'localhost',
  'internal_service',
  'private_ip',
  'loopback',
  'link_local',
  'unspecified',
  'reserved_ipv4',
  'ipv4_mapped_ipv6',
  'private_ipv6',
  'invalid_format',
  'unresolvable',
  'no_dns_records',
  'resolves_private',
] as const;

export type WebhookUrlReason = typeof WEBHOOK_URL_REASONS[number];

export interface WebhookUrlValidation {
  valid: boolean;
  error?: string;
  reason?: WebhookUrlReason;
}

function reject(reason: WebhookUrlReason, error: string): WebhookUrlValidation {
  return { valid: false, error, reason };
}

const INTERNAL_HOSTNAMES = [
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'kubernetes.default',
  'kubernetes.default.svc',
];

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isValidWebhookUrl(urlString: string): WebhookUrlValidation {
  try {
    const url = new URL(urlString);

    // Must be HTTPS for security
    // HTTP only allowed when explicitly enabled via env var (for local testing against ngrok etc)
    const allowHttp = process.env.ALLOW_HTTP_WEBHOOKS === 'true';
    if (url.protocol !== 'https:') {
      if (url.protocol === 'http:' && !allowHttp) {
        return reject('https_required', 'URL must use HTTPS protocol');
      } else if (url.protocol !== 'http:') {
        return reject('https_required', 'URL must use HTTPS protocol');
      }
    }

    const hostname = url.hostname.toLowerCase();

    if (hostname === 'localhost') {
      return reject('localhost', 'URL cannot point to localhost');
    }

    if (INTERNAL_HOSTNAMES.some(blocked => hostname === blocked || hostname.endsWith('.' + blocked))) {
      return reject('internal_service', 'URL cannot point to internal services');
    }

    const ipv4Match = hostname.match(IPV4_REGEX);
    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);

      if (a === 10) {
        return reject('private_ip', 'URL cannot point to private IP addresses (10.x.x.x)');
      }
      if (a === 172 && b >= 16 && b <= 31) {
        return reject('private_ip', 'URL cannot point to private IP addresses (172.16-31.x.x)');
      }
      if (a === 192 && b === 168) {
        return reject('private_ip', 'URL cannot point to private IP addresses (192.168.x.x)');
      }
      if (a === 127) {
        return reject('loopback', 'URL cannot point to loopback addresses');
      }
      if (a === 169 && b === 254) {
        return reject('link_local', 'URL cannot point to link-local addresses (cloud metadata)');
      }
      if (a === 0 && b === 0 && c === 0 && d === 0) {
        return reject('unspecified', 'URL cannot point to 0.0.0.0');
      }
      if (isPrivateOrReservedIp(hostname)) {
        return reject('reserved_ipv4', 'URL cannot point to reserved IPv4 addresses');
      }
    }

    if (hostname.startsWith('[')) {
      const ipv6 = hostname.slice(1, -1).toLowerCase();
      if (ipv6.startsWith('::ffff:')) {
        return reject('ipv4_mapped_ipv6', 'URL cannot use IPv4-mapped IPv6 addresses');
      }
      if (isPrivateOrReservedIp(ipv6)) {
        return reject('private_ipv6', 'URL cannot point to IPv6 loopback or private addresses');
      }
    }

    return { valid: true };
  } catch {
    return reject('invalid_format', 'Invalid URL format');
  }
}

/** Async URL validator with DNS resolution. Run before persisting endpoints. */
export async function validateWebhookUrlAsync(
  urlString: string
): Promise<WebhookUrlValidation> {
  const sync = isValidWebhookUrl(urlString);
  if (!sync.valid) return sync;

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return reject('invalid_format', 'Invalid URL format');
  }

  const hostname = url.hostname.toLowerCase();

  // Literal IPs already covered by the sync path — only resolve hostnames.
  const isLiteralIp = IPV4_REGEX.test(hostname) || hostname.startsWith('[');
  if (isLiteralIp) return { valid: true };

  let addresses: string[];
  try {
    addresses = await resolveAuthoritative(hostname);
  } catch {
    return reject('unresolvable', 'Hostname could not be resolved');
  }

  if (addresses.length === 0) {
    return reject('no_dns_records', 'Hostname has no A/AAAA records');
  }

  const blocked = addresses.find((addr) => isPrivateOrReservedIp(addr));
  if (blocked) {
    return reject('resolves_private', `Hostname resolves to a private/reserved address (${blocked})`);
  }

  return { valid: true };
}

/**
 * Valid webhook event types
 *
 * Note: Must match WEBHOOK_EVENTS in src/types/webhooks.ts
 */
export const WEBHOOK_EVENT_TYPES = [
  'order.abandoned',
  'seats.held',
  'seats.confirmed',
  'seats.released',
  'access.granted',
  'access.updated',
  'access.revoked',
  // Active events (used in UI)
  'purchase.completed',
  'order.placed',
  'order.cancelled',
  'order.overdue',
  'order.payment_reminder',
  'order.transfer_declared',
  'order.invoice_issued',
  'order.reopened',
  'order.participants_updated',
  'lead.captured',
  'waitlist.signup',
  'access.expired',
  // Subscriptions MVP (Phase 3)
  'subscription.created',
  'subscription.updated',
  'subscription.canceled',
  'subscription.trial_ending',
  'subscription.renewal_upcoming',
  'invoice.paid',
  'invoice.payment_failed',
  'refund.issued',
  'refund.updated',
  'dispute.created',
  'dispute.closed',
  // License (Pro — gated by EVENT_FEATURE_REQUIREMENTS / 'license-revoked-webhook')
  'license.issued',
  'license.revoked',
  'license.restored',
  'license.expired',
  'invoicing.issued',
  'invoicing.failed',
  'invoicing.corrected',
  'commission.accrued',
  'commission.reversed',
  'payout.reserved',
  'payout.paid',
  'payout.cancelled',
  'refund.requested',
  'refund.request_approved',
  'refund.request_rejected',
  'refund.request_cancelled',
  'product.published',
  'product.unpublished',
  'product.price_changed',
  'product.sold_out',
  // Legacy/future events
  // Reserved: sent once an operation that changes a license (tier, extension, holder) exists.
  'license.updated',
  'payment.completed',
  'payment.refunded',
  'payment.failed',
  'user.access_granted',
  'user.access_revoked',
  'product.created',
  'product.updated',
  'product.deleted',
] as const;

export type WebhookEventType = typeof WEBHOOK_EVENT_TYPES[number];

export function isValidEventType(eventType: string): eventType is WebhookEventType {
  return WEBHOOK_EVENT_TYPES.includes(eventType as WebhookEventType);
}

export function validateEventTypes(events: unknown): { valid: boolean; error?: string } {
  if (!Array.isArray(events) || events.length === 0) {
    return { valid: false, error: 'Events must be a non-empty array' };
  }

  const invalidEvents = events.filter(e => !isValidEventType(e));
  if (invalidEvents.length > 0) {
    return {
      valid: false,
      error: `Invalid event types: ${invalidEvents.join(', ')}. Valid types: ${WEBHOOK_EVENT_TYPES.join(', ')}`
    };
  }

  return { valid: true };
}

/**
 * Product scoping: an endpoint fires for every product ('all') or only for an
 * explicit set of products ('selected'). The 'selected' set lives in the
 * webhook_endpoint_products junction; this validates the write-time input.
 */
export const WEBHOOK_PRODUCT_FILTER_MODES = ['all', 'selected'] as const;

export type WebhookProductFilterMode = typeof WEBHOOK_PRODUCT_FILTER_MODES[number];

// Matches the products API cap on categories/tags arrays.
export const MAX_WEBHOOK_SCOPED_PRODUCTS = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidProductFilterMode(mode: string): mode is WebhookProductFilterMode {
  return (WEBHOOK_PRODUCT_FILTER_MODES as readonly string[]).includes(mode);
}

/**
 * Custom payload fields (`custom_payload_fields`) are merged into the outbound
 * webhook envelope alongside the core `event`/`timestamp`/`data` keys
 * (`buildEndpointBody` in lib/webhooks/payload-customization.ts). A field sharing
 * one of those names would collide with the real value, so it is rejected here at
 * save time — `buildEndpointBody` also drops any that slip through some other way.
 */
export function validateCustomPayloadFields(
  fields: Record<string, unknown> | null | undefined,
): { valid: boolean; error?: string } {
  if (!fields) return { valid: true };

  const reserved = Object.keys(fields).filter((key) =>
    (RESERVED_ENVELOPE_KEYS as readonly string[]).includes(key),
  );
  if (reserved.length > 0) {
    return {
      valid: false,
      error: `Custom payload field name(s) reserved for the webhook envelope: ${reserved.join(', ')}. Rename them (e.g. "event" -> "event_name").`,
    };
  }

  return { valid: true };
}

export function validateProductFilter(
  mode: string | undefined,
  productIds: unknown,
): { valid: boolean; error?: string } {
  if (mode === undefined || mode === 'all') {
    return { valid: true };
  }

  if (!isValidProductFilterMode(mode)) {
    return {
      valid: false,
      error: `Invalid product filter mode: ${mode}. Valid modes: ${WEBHOOK_PRODUCT_FILTER_MODES.join(', ')}`,
    };
  }

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return { valid: false, error: 'Selected mode requires at least one product' };
  }

  if (productIds.length > MAX_WEBHOOK_SCOPED_PRODUCTS) {
    return { valid: false, error: `Cannot scope to more than ${MAX_WEBHOOK_SCOPED_PRODUCTS} products` };
  }

  const hasInvalid = productIds.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id));
  if (hasInvalid) {
    return { valid: false, error: 'product_ids must all be valid product UUIDs' };
  }

  return { valid: true };
}
