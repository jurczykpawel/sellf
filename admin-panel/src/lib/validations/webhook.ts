/**
 * Webhook URL validation.
 *   isValidWebhookUrl(url)         — sync hostname/IP-pattern checks.
 *   validateWebhookUrlAsync(url)   — sync checks + DNS resolution. Use this
 *                                    when persisting an endpoint URL.
 */

import dns from 'node:dns/promises';
import { isPrivateOrReservedIp } from '@/lib/security/ip-blocklist';

async function resolveAuthoritative(hostname: string): Promise<string[]> {
  const [v4, v6] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ]);
  const addrs: string[] = [];
  if (v4.status === 'fulfilled') addrs.push(...v4.value);
  if (v6.status === 'fulfilled') addrs.push(...v6.value);
  return addrs;
}

const INTERNAL_HOSTNAMES = [
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'kubernetes.default',
  'kubernetes.default.svc',
];

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isValidWebhookUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);

    // Must be HTTPS for security
    // HTTP only allowed when explicitly enabled via env var (for local testing against ngrok etc)
    const allowHttp = process.env.ALLOW_HTTP_WEBHOOKS === 'true';
    if (url.protocol !== 'https:') {
      if (url.protocol === 'http:' && !allowHttp) {
        return { valid: false, error: 'URL must use HTTPS protocol' };
      } else if (url.protocol !== 'http:') {
        return { valid: false, error: 'URL must use HTTPS protocol' };
      }
    }

    const hostname = url.hostname.toLowerCase();

    if (hostname === 'localhost') {
      return { valid: false, error: 'URL cannot point to localhost' };
    }

    if (INTERNAL_HOSTNAMES.some(blocked => hostname === blocked || hostname.endsWith('.' + blocked))) {
      return { valid: false, error: 'URL cannot point to internal services' };
    }

    const ipv4Match = hostname.match(IPV4_REGEX);
    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);

      if (a === 10) {
        return { valid: false, error: 'URL cannot point to private IP addresses (10.x.x.x)' };
      }
      if (a === 172 && b >= 16 && b <= 31) {
        return { valid: false, error: 'URL cannot point to private IP addresses (172.16-31.x.x)' };
      }
      if (a === 192 && b === 168) {
        return { valid: false, error: 'URL cannot point to private IP addresses (192.168.x.x)' };
      }
      if (a === 127) {
        return { valid: false, error: 'URL cannot point to loopback addresses' };
      }
      if (a === 169 && b === 254) {
        return { valid: false, error: 'URL cannot point to link-local addresses (cloud metadata)' };
      }
      if (a === 0 && b === 0 && c === 0 && d === 0) {
        return { valid: false, error: 'URL cannot point to 0.0.0.0' };
      }
      if (isPrivateOrReservedIp(hostname)) {
        return { valid: false, error: 'URL cannot point to reserved IPv4 addresses' };
      }
    }

    if (hostname.startsWith('[')) {
      const ipv6 = hostname.slice(1, -1).toLowerCase();
      if (ipv6.startsWith('::ffff:')) {
        return { valid: false, error: 'URL cannot use IPv4-mapped IPv6 addresses' };
      }
      if (isPrivateOrReservedIp(ipv6)) {
        return { valid: false, error: 'URL cannot point to IPv6 loopback or private addresses' };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/** Async URL validator with DNS resolution. Run before persisting endpoints. */
export async function validateWebhookUrlAsync(
  urlString: string
): Promise<{ valid: boolean; error?: string }> {
  const sync = isValidWebhookUrl(urlString);
  if (!sync.valid) return sync;

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  const hostname = url.hostname.toLowerCase();

  // Literal IPs already covered by the sync path — only resolve hostnames.
  const isLiteralIp = IPV4_REGEX.test(hostname) || hostname.startsWith('[');
  if (isLiteralIp) return { valid: true };

  let addresses: string[];
  try {
    addresses = await resolveAuthoritative(hostname);
  } catch {
    return { valid: false, error: 'Hostname could not be resolved' };
  }

  if (addresses.length === 0) {
    return { valid: false, error: 'Hostname has no A/AAAA records' };
  }

  const blocked = addresses.find((addr) => isPrivateOrReservedIp(addr));
  if (blocked) {
    return {
      valid: false,
      error: `Hostname resolves to a private/reserved address (${blocked})`,
    };
  }

  return { valid: true };
}

/**
 * Valid webhook event types
 *
 * Note: Must match WEBHOOK_EVENTS in src/types/webhooks.ts
 */
export const WEBHOOK_EVENT_TYPES = [
  // Active events (used in UI)
  'purchase.completed',
  'lead.captured',
  'waitlist.signup',
  'access.expired',
  // Legacy/future events
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
