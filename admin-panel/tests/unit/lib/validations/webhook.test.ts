/**
 * Webhook Validation Unit Tests
 *
 * Tests the actual isValidWebhookUrl function from the source.
 * Also tests event type validation.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isValidWebhookUrl,
  isValidEventType,
  validateEventTypes,
  WEBHOOK_EVENT_TYPES,
} from '@/lib/validations/webhook';

describe('Webhook Validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('isValidWebhookUrl - Protocol Validation', () => {
    it('should allow HTTPS URLs', () => {
      const result = isValidWebhookUrl('https://webhook.example.com/endpoint');
      expect(result.valid).toBe(true);
    });

    it('should reject HTTP URLs by default', () => {
      const result = isValidWebhookUrl('http://webhook.example.com/endpoint');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('HTTPS');
    });

    it('should allow HTTP URLs when ALLOW_HTTP_WEBHOOKS is true', () => {
      vi.stubEnv('ALLOW_HTTP_WEBHOOKS', 'true');
      const result = isValidWebhookUrl('http://webhook.example.com/endpoint');
      expect(result.valid).toBe(true);
      vi.unstubAllEnvs();
    });

    it('should reject FTP protocol', () => {
      const result = isValidWebhookUrl('ftp://example.com/file');
      expect(result.valid).toBe(false);
    });

    it('should reject file protocol', () => {
      const result = isValidWebhookUrl('file:///etc/passwd');
      expect(result.valid).toBe(false);
    });

    it('should reject javascript protocol', () => {
      const result = isValidWebhookUrl('javascript:alert(1)');
      expect(result.valid).toBe(false);
    });

    it('should reject data protocol', () => {
      const result = isValidWebhookUrl('data:text/html,<script>alert(1)</script>');
      expect(result.valid).toBe(false);
    });
  });

  describe('isValidWebhookUrl - SSRF Protection', () => {
    it('should block localhost', () => {
      expect(isValidWebhookUrl('https://localhost/webhook').valid).toBe(false);
      expect(isValidWebhookUrl('https://127.0.0.1/webhook').valid).toBe(false);
    });

    it('should block loopback range', () => {
      expect(isValidWebhookUrl('https://127.0.0.2/webhook').valid).toBe(false);
      expect(isValidWebhookUrl('https://127.255.255.255/webhook').valid).toBe(false);
    });

    it('should block IPv6 loopback', () => {
      expect(isValidWebhookUrl('https://[::1]/webhook').valid).toBe(false);
    });

    it('should block AWS metadata endpoint', () => {
      // HTTP is blocked first, so use HTTPS for this test
      const result = isValidWebhookUrl('https://169.254.169.254/latest/meta-data/');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cloud metadata');
    });

    it('should block link-local range', () => {
      expect(isValidWebhookUrl('https://169.254.0.1/test').valid).toBe(false);
      expect(isValidWebhookUrl('https://169.254.255.255/test').valid).toBe(false);
    });

    it('should block private 10.x.x.x range', () => {
      expect(isValidWebhookUrl('https://10.0.0.1/webhook').valid).toBe(false);
      expect(isValidWebhookUrl('https://10.255.255.255/webhook').valid).toBe(false);
    });

    it('should block private 172.16-31.x.x range', () => {
      expect(isValidWebhookUrl('https://172.16.0.1/webhook').valid).toBe(false);
      expect(isValidWebhookUrl('https://172.31.255.255/webhook').valid).toBe(false);
    });

    it('should allow 172.15.x.x (not private)', () => {
      expect(isValidWebhookUrl('https://172.15.0.1/webhook').valid).toBe(true);
    });

    it('should allow 172.32.x.x (not private)', () => {
      expect(isValidWebhookUrl('https://172.32.0.1/webhook').valid).toBe(true);
    });

    it('should block private 192.168.x.x range', () => {
      expect(isValidWebhookUrl('https://192.168.0.1/webhook').valid).toBe(false);
      expect(isValidWebhookUrl('https://192.168.1.1/webhook').valid).toBe(false);
    });

    it('should block 0.0.0.0', () => {
      expect(isValidWebhookUrl('https://0.0.0.0/webhook').valid).toBe(false);
    });

    it('should block Google Cloud metadata', () => {
      expect(isValidWebhookUrl('https://metadata.google.internal/computeMetadata/v1/').valid).toBe(false);
      expect(isValidWebhookUrl('https://metadata.goog/test').valid).toBe(false);
    });

    it('should block Kubernetes internal services', () => {
      expect(isValidWebhookUrl('https://kubernetes.default/api').valid).toBe(false);
      expect(isValidWebhookUrl('https://kubernetes.default.svc/api').valid).toBe(false);
    });

    it('should block IPv6 private addresses', () => {
      expect(isValidWebhookUrl('https://[fe80::1]/webhook').valid).toBe(false);
      expect(isValidWebhookUrl('https://[fc00::1]/webhook').valid).toBe(false);
      expect(isValidWebhookUrl('https://[fd00::1]/webhook').valid).toBe(false);
    });
  });

  describe('isValidWebhookUrl - Valid URLs', () => {
    it('should allow legitimate webhook services', () => {
      expect(isValidWebhookUrl('https://webhook.site/abc123').valid).toBe(true);
      expect(isValidWebhookUrl('https://hooks.slack.com/services/xxx').valid).toBe(true);
      expect(isValidWebhookUrl('https://discord.com/api/webhooks/xxx').valid).toBe(true);
    });

    it('should allow public IP addresses', () => {
      expect(isValidWebhookUrl('https://8.8.8.8/webhook').valid).toBe(true);
      expect(isValidWebhookUrl('https://1.1.1.1/webhook').valid).toBe(true);
    });

    it('should allow domains with ports', () => {
      expect(isValidWebhookUrl('https://api.example.com:8443/webhook').valid).toBe(true);
    });

    it('should allow domains with paths and query strings', () => {
      expect(isValidWebhookUrl('https://api.example.com/webhook/v1?token=abc').valid).toBe(true);
    });
  });

  describe('isValidWebhookUrl - Invalid URL Format', () => {
    it('should reject malformed URLs', () => {
      expect(isValidWebhookUrl('not-a-url').valid).toBe(false);
      expect(isValidWebhookUrl('').valid).toBe(false);
      expect(isValidWebhookUrl('//example.com').valid).toBe(false);
    });

    it('should return proper error for invalid format', () => {
      const result = isValidWebhookUrl('invalid');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });
  });

  describe('isValidEventType', () => {
    it('should validate known event types', () => {
      expect(isValidEventType('purchase.completed')).toBe(true);
      expect(isValidEventType('lead.captured')).toBe(true);
      expect(isValidEventType('waitlist.signup')).toBe(true);
      expect(isValidEventType('payment.completed')).toBe(true);
      expect(isValidEventType('payment.refunded')).toBe(true);
    });

    it('should reject unknown event types', () => {
      expect(isValidEventType('unknown.event')).toBe(false);
      expect(isValidEventType('purchase')).toBe(false);
      expect(isValidEventType('')).toBe(false);
    });

    it('should reject similar but incorrect types', () => {
      expect(isValidEventType('Purchase.Completed')).toBe(false);
      expect(isValidEventType('purchase_completed')).toBe(false);
    });
  });

  describe('validateEventTypes', () => {
    it('should validate array of valid events', () => {
      const result = validateEventTypes(['purchase.completed', 'lead.captured']);
      expect(result.valid).toBe(true);
    });

    it('should reject non-array input', () => {
      expect(validateEventTypes('purchase.completed').valid).toBe(false);
      expect(validateEventTypes(null).valid).toBe(false);
      expect(validateEventTypes({}).valid).toBe(false);
    });

    it('should reject empty array', () => {
      const result = validateEventTypes([]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('non-empty array');
    });

    it('should reject array with invalid events', () => {
      const result = validateEventTypes(['purchase.completed', 'invalid.event']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid.event');
    });

    it('should list valid event types in error message', () => {
      const result = validateEventTypes(['bad.event']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('purchase.completed');
    });
  });

  describe('WEBHOOK_EVENT_TYPES', () => {
    it('should include all active events', () => {
      expect(WEBHOOK_EVENT_TYPES).toContain('purchase.completed');
      expect(WEBHOOK_EVENT_TYPES).toContain('lead.captured');
      expect(WEBHOOK_EVENT_TYPES).toContain('waitlist.signup');
    });

    it('should include legacy events', () => {
      expect(WEBHOOK_EVENT_TYPES).toContain('payment.completed');
      expect(WEBHOOK_EVENT_TYPES).toContain('payment.refunded');
      expect(WEBHOOK_EVENT_TYPES).toContain('payment.failed');
    });

    it('should include user events', () => {
      expect(WEBHOOK_EVENT_TYPES).toContain('user.access_granted');
      expect(WEBHOOK_EVENT_TYPES).toContain('user.access_revoked');
    });

    it('should include product events', () => {
      expect(WEBHOOK_EVENT_TYPES).toContain('product.created');
      expect(WEBHOOK_EVENT_TYPES).toContain('product.updated');
      expect(WEBHOOK_EVENT_TYPES).toContain('product.deleted');
    });
  });
});
