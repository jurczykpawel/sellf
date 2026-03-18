/**
 * Webhook URL validation
 *
 * SECURITY: Validates webhook URLs to prevent SSRF attacks.
 * Rejects: internal IPs, localhost, private networks, cloud metadata endpoints.
 */

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

    // Block localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1') {
      return { valid: false, error: 'URL cannot point to localhost' };
    }

    // Block private/internal hostnames
    const blockedHostnames = [
      'metadata.google.internal',
      'metadata.goog',
      'kubernetes.default',
      'kubernetes.default.svc',
    ];
    if (blockedHostnames.some(blocked => hostname === blocked || hostname.endsWith('.' + blocked))) {
      return { valid: false, error: 'URL cannot point to internal services' };
    }

    // Check if hostname is an IP address
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipv4Match = hostname.match(ipv4Regex);

    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);

      // Block private IPv4 ranges (RFC 1918)
      // 10.0.0.0 - 10.255.255.255
      if (a === 10) {
        return { valid: false, error: 'URL cannot point to private IP addresses (10.x.x.x)' };
      }
      // 172.16.0.0 - 172.31.255.255
      if (a === 172 && b >= 16 && b <= 31) {
        return { valid: false, error: 'URL cannot point to private IP addresses (172.16-31.x.x)' };
      }
      // 192.168.0.0 - 192.168.255.255
      if (a === 192 && b === 168) {
        return { valid: false, error: 'URL cannot point to private IP addresses (192.168.x.x)' };
      }
      // 127.0.0.0 - 127.255.255.255 (loopback)
      if (a === 127) {
        return { valid: false, error: 'URL cannot point to loopback addresses' };
      }
      // 169.254.0.0 - 169.254.255.255 (link-local, includes AWS metadata)
      if (a === 169 && b === 254) {
        return { valid: false, error: 'URL cannot point to link-local addresses (cloud metadata)' };
      }
      // 0.0.0.0
      if (a === 0 && b === 0 && c === 0 && d === 0) {
        return { valid: false, error: 'URL cannot point to 0.0.0.0' };
      }
    }

    // Block IPv6 loopback and link-local (basic check for bracketed format)
    if (hostname.startsWith('[')) {
      const ipv6 = hostname.slice(1, -1).toLowerCase();
      if (ipv6 === '::1' || ipv6.startsWith('fe80:') || ipv6.startsWith('fc') || ipv6.startsWith('fd')) {
        return { valid: false, error: 'URL cannot point to IPv6 loopback or private addresses' };
      }
      // Block IPv4-mapped IPv6 addresses (e.g., ::ffff:127.0.0.1 → bypasses IPv4 checks)
      if (ipv6.startsWith('::ffff:')) {
        return { valid: false, error: 'URL cannot use IPv4-mapped IPv6 addresses' };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
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
