import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isValidWebhookUrl,
  isValidEventType,
  validateEventTypes,
  WEBHOOK_EVENT_TYPES,
} from '@/lib/validations/webhook';

/**
 * ============================================================================
 * SECURITY TEST: Webhook URL SSRF Validation
 * ============================================================================
 *
 * Tests the PRODUCTION isValidWebhookUrl() from @/lib/validations/webhook.ts
 * which is used by:
 *   - src/app/api/admin/webhooks/route.ts (POST — create webhook)
 *   - src/app/api/admin/webhooks/[id]/route.ts (PUT — update webhook)
 *
 * VULNERABILITY: SSRF Bypass via Webhook PUT Endpoint (V-CRITICAL-07)
 *
 * ATTACK FLOW (before fix):
 * 1. Admin creates webhook with legitimate URL (e.g., https://example.com/webhook)
 * 2. POST validation passes (isValidWebhookUrl is called)
 * 3. Admin (or compromised admin account) updates webhook via PUT
 * 4. PUT had NO URL validation - accepts any URL including internal IPs
 * 5. Webhook URL changed to http://169.254.169.254/latest/meta-data/
 * 6. On next webhook trigger, server makes request to cloud metadata service
 * 7. Response (AWS credentials, instance identity) logged to webhook_logs
 *
 * Created during security audit iteration 6 (2026-01-08)
 * Fixed to import from production code (2026-02-26)
 * ============================================================================
 */

describe('Webhook URL SSRF Validation', () => {
  // The production isValidWebhookUrl requires HTTPS unless ALLOW_HTTP_WEBHOOKS=true.
  // Many test cases use HTTP URLs, so we enable HTTP for the SSRF-focused tests
  // and test the HTTPS enforcement separately.
  const originalEnv = process.env.ALLOW_HTTP_WEBHOOKS;

  beforeEach(() => {
    process.env.ALLOW_HTTP_WEBHOOKS = 'true';
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ALLOW_HTTP_WEBHOOKS;
    } else {
      process.env.ALLOW_HTTP_WEBHOOKS = originalEnv;
    }
  });

  describe('HTTPS Enforcement', () => {
    it('should BLOCK HTTP when ALLOW_HTTP_WEBHOOKS is not set', () => {
      delete process.env.ALLOW_HTTP_WEBHOOKS;
      const result = isValidWebhookUrl('http://example.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('HTTPS');
    });

    it('should ALLOW HTTP when ALLOW_HTTP_WEBHOOKS=true', () => {
      process.env.ALLOW_HTTP_WEBHOOKS = 'true';
      const result = isValidWebhookUrl('http://example.com/webhook');
      expect(result.valid).toBe(true);
    });

    it('should ALLOW HTTPS regardless of env var', () => {
      delete process.env.ALLOW_HTTP_WEBHOOKS;
      const result = isValidWebhookUrl('https://example.com/webhook');
      expect(result.valid).toBe(true);
    });
  });

  describe('Cloud Metadata Endpoints - BLOCKED', () => {
    it('should BLOCK AWS metadata endpoint (169.254.169.254)', () => {
      const result = isValidWebhookUrl('http://169.254.169.254/latest/meta-data/');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cloud metadata');
    });

    it('should BLOCK AWS metadata with credentials path', () => {
      const result = isValidWebhookUrl('http://169.254.169.254/latest/meta-data/iam/security-credentials/');
      expect(result.valid).toBe(false);
    });

    it('should BLOCK Google Cloud metadata endpoint', () => {
      const result = isValidWebhookUrl('http://metadata.google.internal/computeMetadata/v1/');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('internal services');
    });

    it('should BLOCK metadata.goog', () => {
      const result = isValidWebhookUrl('http://metadata.goog/computeMetadata/v1/');
      expect(result.valid).toBe(false);
    });

    it('should BLOCK any 169.254.x.x address', () => {
      const urls = [
        'http://169.254.0.1/test',
        'http://169.254.255.255/test',
        'http://169.254.1.1:8080/webhook',
      ];

      urls.forEach((url) => {
        const result = isValidWebhookUrl(url);
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('Localhost/Loopback - BLOCKED', () => {
    it('should BLOCK localhost', () => {
      const result = isValidWebhookUrl('http://localhost/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('localhost');
    });

    it('should BLOCK localhost with port', () => {
      const result = isValidWebhookUrl('http://localhost:3000/api/webhook');
      expect(result.valid).toBe(false);
    });

    it('should BLOCK 127.0.0.1', () => {
      const result = isValidWebhookUrl('http://127.0.0.1/webhook');
      expect(result.valid).toBe(false);
    });

    it('should BLOCK 127.x.x.x range', () => {
      const result = isValidWebhookUrl('http://127.0.0.2:8080/webhook');
      expect(result.valid).toBe(false);
    });

    it('should BLOCK IPv6 loopback [::1]', () => {
      const result = isValidWebhookUrl('http://[::1]/webhook');
      expect(result.valid).toBe(false);
    });
  });

  describe('Private IP Ranges (RFC 1918) - BLOCKED', () => {
    it('should BLOCK 10.x.x.x range', () => {
      const urls = [
        'http://10.0.0.1/webhook',
        'http://10.255.255.255/webhook',
        'http://10.0.1.1:8080/internal',
      ];

      urls.forEach((url) => {
        const result = isValidWebhookUrl(url);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('10.x.x.x');
      });
    });

    it('should BLOCK 172.16-31.x.x range', () => {
      const urls = [
        'http://172.16.0.1/webhook',
        'http://172.31.255.255/webhook',
        'http://172.20.0.1/internal',
      ];

      urls.forEach((url) => {
        const result = isValidWebhookUrl(url);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('172.16-31');
      });
    });

    it('should ALLOW 172.15.x.x (not private)', () => {
      const result = isValidWebhookUrl('http://172.15.0.1/webhook');
      expect(result.valid).toBe(true);
    });

    it('should ALLOW 172.32.x.x (not private)', () => {
      const result = isValidWebhookUrl('http://172.32.0.1/webhook');
      expect(result.valid).toBe(true);
    });

    it('should BLOCK 192.168.x.x range', () => {
      const urls = [
        'http://192.168.0.1/webhook',
        'http://192.168.1.1/webhook',
        'http://192.168.255.255/internal',
      ];

      urls.forEach((url) => {
        const result = isValidWebhookUrl(url);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('192.168');
      });
    });
  });

  describe('Kubernetes Internal Services - BLOCKED', () => {
    it('should BLOCK kubernetes.default', () => {
      const result = isValidWebhookUrl('http://kubernetes.default/api/v1/secrets');
      expect(result.valid).toBe(false);
    });

    it('should BLOCK kubernetes.default.svc', () => {
      const result = isValidWebhookUrl('http://kubernetes.default.svc/api/v1/pods');
      expect(result.valid).toBe(false);
    });

    it('should BLOCK subdomains of kubernetes.default.svc', () => {
      const result1 = isValidWebhookUrl('http://api.kubernetes.default.svc/endpoint');
      expect(result1.valid).toBe(false);
    });
  });

  describe('Valid External URLs - ALLOWED', () => {
    it('should ALLOW legitimate webhook URLs', () => {
      const validUrls = [
        'https://webhook.site/abc123',
        'https://api.example.com/webhook',
        'https://hooks.slack.com/services/xxx',
        'https://discord.com/api/webhooks/xxx',
        'http://my-webhook-server.com/endpoint',
        'https://8.8.8.8/webhook', // Public IP
      ];

      validUrls.forEach((url) => {
        const result = isValidWebhookUrl(url);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('Invalid URL Format - BLOCKED', () => {
    it('should BLOCK non-HTTP protocols', () => {
      const invalidUrls = [
        'ftp://example.com/file',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
      ];

      invalidUrls.forEach((url) => {
        const result = isValidWebhookUrl(url);
        expect(result.valid).toBe(false);
      });
    });

    it('should BLOCK malformed URLs', () => {
      const result = isValidWebhookUrl('not-a-valid-url');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('should BLOCK 0.0.0.0', () => {
      const result = isValidWebhookUrl('http://0.0.0.0/webhook');
      expect(result.valid).toBe(false);
    });
  });

});

describe('Webhook Event Type Validation', () => {
  describe('isValidEventType', () => {
    it('should accept all defined event types from WEBHOOK_EVENT_TYPES', () => {
      expect(WEBHOOK_EVENT_TYPES.length).toBeGreaterThan(0);
      for (const eventType of WEBHOOK_EVENT_TYPES) {
        expect(isValidEventType(eventType)).toBe(true);
      }
    });

    it('should reject unknown event types', () => {
      expect(isValidEventType('unknown.event')).toBe(false);
      expect(isValidEventType('payment.cancelled')).toBe(false);
      expect(isValidEventType('')).toBe(false);
      expect(isValidEventType('purchase.completed.extra')).toBe(false);
    });
  });

  describe('validateEventTypes', () => {
    it('should accept a valid array of event types', () => {
      const result = validateEventTypes(['purchase.completed', 'lead.captured']);
      expect(result.valid).toBe(true);
    });

    it('should accept a single event type in an array', () => {
      const result = validateEventTypes(['purchase.completed']);
      expect(result.valid).toBe(true);
    });

    it('should accept all known event types', () => {
      const result = validateEventTypes([...WEBHOOK_EVENT_TYPES]);
      expect(result.valid).toBe(true);
    });

    it('should reject empty array', () => {
      const result = validateEventTypes([]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('non-empty array');
    });

    it('should reject non-array input', () => {
      expect(validateEventTypes('purchase.completed').valid).toBe(false);
      expect(validateEventTypes(null).valid).toBe(false);
      expect(validateEventTypes(undefined).valid).toBe(false);
      expect(validateEventTypes(42).valid).toBe(false);
    });

    it('should reject arrays with invalid event types', () => {
      const result = validateEventTypes(['purchase.completed', 'invalid.event']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid.event');
    });

    it('should list valid types in error message when invalid events provided', () => {
      const result = validateEventTypes(['bogus']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('purchase.completed');
    });
  });

  describe('WEBHOOK_EVENT_TYPES constant', () => {
    it('should be a non-empty readonly array', () => {
      expect(WEBHOOK_EVENT_TYPES.length).toBeGreaterThan(0);
    });

    it('should contain at least the 3 active events', () => {
      expect(WEBHOOK_EVENT_TYPES).toContain('purchase.completed');
      expect(WEBHOOK_EVENT_TYPES).toContain('lead.captured');
      expect(WEBHOOK_EVENT_TYPES).toContain('waitlist.signup');
    });

    it('should follow dot-separated naming convention', () => {
      for (const eventType of WEBHOOK_EVENT_TYPES) {
        expect(eventType).toMatch(/^[a-z]+\.[a-z_]+$/);
      }
    });
  });
});
