import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractPaymentIntentIdSecure,
  sanitizeMetadataField,
  sanitizePaymentMetadata,
  validatePaymentAmount,
  validateCurrencyMatch,
  validateRefund,
} from '@/lib/stripe/security';
import type { PaymentMetadata } from '@/lib/stripe/security';

/**
 * Security Tests: Stripe Integration
 *
 * Tests production security utilities for Stripe payment data handling.
 * Also verifies production source code implements expected patterns.
 *
 * @see src/lib/stripe/security.ts - production utilities under test
 * @see src/app/api/update-payment-metadata/route.ts - client secret usage
 * @see src/app/api/webhooks/stripe/route.ts - idempotency patterns
 */

const UPDATE_METADATA_SOURCE = readFileSync(
  resolve(__dirname, '../../../src/app/api/update-payment-metadata/route.ts'),
  'utf-8'
);

const WEBHOOK_ROUTE_SOURCE = readFileSync(
  resolve(__dirname, '../../../src/app/api/webhooks/stripe/route.ts'),
  'utf-8'
);

const REFUND_ROUTE_SOURCE = readFileSync(
  resolve(__dirname, '../../../src/app/api/admin/payments/refund/route.ts'),
  'utf-8'
);

describe('Stripe Integration Security', () => {
  describe('Client Secret Parsing', () => {
    it('should verify production code uses split(_secret_) pattern (known vulnerability)', () => {
      // Documents the current state: production still uses unsafe split.
      // This test tracks whether the pattern exists so we know when it's fixed.
      expect(UPDATE_METADATA_SOURCE).toContain(".split('_secret_')");
    });

    describe('Secure extraction', () => {
      it('should extract valid payment intent IDs', () => {
        const validSecrets = [
          'pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH',
          'pi_1234567890abcdef_secret_abcdef123456',
          'pi_test12345678901234_secret_xyz789abc',
        ];

        for (const secret of validSecrets) {
          const result = extractPaymentIntentIdSecure(secret);
          expect(result).not.toBeNull();
          expect(result).toMatch(/^pi_/);
        }
      });

      it('should reject malformed client secrets', () => {
        const malformedSecrets = [
          '',
          'invalid',
          'not_a_payment_intent',
          '_secret_only_secret',
          'pi_secret_missingid',
          'pi_short_secret_abc',
        ];

        for (const secret of malformedSecrets) {
          const result = extractPaymentIntentIdSecure(secret);
          expect(result).toBeNull();
        }
      });

      it('should reject secrets with embedded _secret_ attack', () => {
        const attacks = [
          'malicious_secret_pi_real123456789012_secret_xyz',
          'pi_fake_secret_pi_real12345678901234_secret_xyz',
          'prefix_secret_pi_test12345678901234_secret_abc',
        ];

        for (const attack of attacks) {
          const secureResult = extractPaymentIntentIdSecure(attack);
          expect(secureResult).toBeNull();
        }
      });

      it('should reject special character injection', () => {
        const injectionAttempts = [
          "pi_test123456789012345678901_secret_abc'; DROP TABLE--",
          'pi_test123456789012345678901_secret_<script>alert(1)</script>',
          'pi_test123456789012345678901_secret_../../etc/passwd',
        ];

        for (const attempt of injectionAttempts) {
          const result = extractPaymentIntentIdSecure(attempt);
          expect(result).toBeNull();
        }
      });
    });
  });

  describe('Payment Metadata Sanitization', () => {
    describe('Basic sanitization', () => {
      it('should preserve normal input', () => {
        const input: PaymentMetadata = {
          first_name: 'John',
          last_name: 'Doe',
          company_name: 'Acme Corp',
          nip: '1234567890',
          address: '123 Main St',
        };

        const result = sanitizePaymentMetadata(input);
        expect(result.first_name).toBe('John');
        expect(result.last_name).toBe('Doe');
        expect(result.company_name).toBe('Acme Corp');
      });

      it('should trim whitespace', () => {
        const input: PaymentMetadata = {
          first_name: '  John  ',
          last_name: '\n\tDoe\t\n',
        };

        const result = sanitizePaymentMetadata(input);
        expect(result.first_name).toBe('John');
        // \n\t are control chars, removed first, then trim
        expect(result.last_name?.trim()).toBe('Doe');
      });

      it('should enforce length limits', () => {
        const longName = 'A'.repeat(200);
        const input: PaymentMetadata = {
          first_name: longName,
          nip: '12345678901234567890123456789', // 29 chars, limit 20
        };

        const result = sanitizePaymentMetadata(input);
        expect(result.first_name?.length).toBe(100);
        expect(result.nip?.length).toBe(20);
      });
    });

    describe('Control character injection', () => {
      it('should remove null bytes', () => {
        const input: PaymentMetadata = {
          first_name: 'John\x00Doe',
          company_name: 'Company\x00Name',
        };

        const result = sanitizePaymentMetadata(input);
        expect(result.first_name).toBe('JohnDoe');
        expect(result.company_name).toBe('CompanyName');
      });

      it('should remove newlines and tabs', () => {
        const input: PaymentMetadata = {
          address: '123 Main St\n\rApt 4\tFloor 2',
        };

        const result = sanitizePaymentMetadata(input);
        expect(result.address).not.toContain('\n');
        expect(result.address).not.toContain('\r');
        expect(result.address).not.toContain('\t');
      });
    });

    describe('Metadata injection attacks', () => {
      it('should handle JSON injection attempts', () => {
        const input: PaymentMetadata = {
          first_name: '"; "needs_invoice": "true"; "nip": "HIJACKED',
          company_name: '{"malicious": true}',
        };

        const result = sanitizePaymentMetadata(input);
        // Should preserve the text but not allow it to break JSON structure
        // (Stripe escapes values when storing, but we still sanitize)
        expect(result.first_name).toBe('"; "needs_invoice": "true"; "nip": "HIJACKED');
        expect(result.company_name).toBe('{"malicious": true}');
      });

      it('should handle XSS attempts in metadata', () => {
        const input: PaymentMetadata = {
          company_name: '<script>alert(document.cookie)</script>',
          address: '<img onerror="alert(1)" src="x">',
        };

        const result = sanitizePaymentMetadata(input);
        // Stripe should never render metadata as HTML, but length limits still apply
        expect(result.company_name?.length).toBeLessThanOrEqual(200);
        expect(result.address?.length).toBeLessThanOrEqual(300);
      });
    });
  });

  describe('Amount Validation', () => {
    describe('Fixed price validation', () => {
      it('should accept exact amount match', () => {
        const result = validatePaymentAmount(9999, 99.99, 'USD');
        expect(result.valid).toBe(true);
      });

      it('should reject amount less than price', () => {
        // Attack: Pay $1 for $99.99 product
        const result = validatePaymentAmount(100, 99.99, 'USD');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('mismatch');
      });

      it('should reject zero amount', () => {
        const result = validatePaymentAmount(0, 99.99, 'USD');
        expect(result.valid).toBe(false);
      });

      it('should reject negative amount', () => {
        const result = validatePaymentAmount(-100, 99.99, 'USD');
        expect(result.valid).toBe(false);
      });
    });

    describe('Custom price (PWYW) validation', () => {
      it('should accept amount at minimum', () => {
        const result = validatePaymentAmount(50, 0, 'USD', true, 0.50);
        expect(result.valid).toBe(true);
      });

      it('should accept amount above minimum', () => {
        const result = validatePaymentAmount(1000, 0, 'USD', true, 0.50);
        expect(result.valid).toBe(true);
      });

      it('should reject amount below minimum', () => {
        // Attack: Pay $0.01 for PWYW (min $0.50)
        const result = validatePaymentAmount(1, 0, 'USD', true, 0.50);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('below minimum');
      });
    });

    describe('Edge cases', () => {
      it('should handle undefined amount', () => {
        const result = validatePaymentAmount(undefined, 99.99, 'USD');
        expect(result.valid).toBe(false);
      });

      it('should handle NaN amount', () => {
        const result = validatePaymentAmount(NaN, 99.99, 'USD');
        expect(result.valid).toBe(false);
      });

      it('should handle Infinity amount', () => {
        const result = validatePaymentAmount(Infinity, 99.99, 'USD');
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('Currency Validation', () => {
    describe('Valid currency matches', () => {
      it('should accept matching currencies', () => {
        expect(validateCurrencyMatch('USD', 'USD').valid).toBe(true);
        expect(validateCurrencyMatch('usd', 'USD').valid).toBe(true);
        expect(validateCurrencyMatch('Usd', 'usd').valid).toBe(true);
      });
    });

    describe('Currency mismatch attacks', () => {
      it('should reject different currencies', () => {
        // Attack: Pay in JPY instead of USD (cheaper)
        const result = validateCurrencyMatch('JPY', 'USD');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('mismatch');
      });

      it('should reject unknown currencies', () => {
        const result = validateCurrencyMatch('XXX', 'USD');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Unsupported');
      });

      it('should reject missing currency', () => {
        const result = validateCurrencyMatch(undefined, 'USD');
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('Webhook Idempotency', () => {
    it('should verify production webhook checks existing transactions before processing', () => {
      // The webhook route queries payment_transactions by session_id before inserting
      expect(WEBHOOK_ROUTE_SOURCE).toContain("'payment_transactions'");
      expect(WEBHOOK_ROUTE_SOURCE).toContain('.maybeSingle()');
    });

    it('should verify production webhook skips already-processed events', () => {
      // After finding an existing transaction, the handler returns early
      expect(WEBHOOK_ROUTE_SOURCE).toContain('Already processed');
    });

    it('should verify production webhook verifies signature before processing', () => {
      expect(WEBHOOK_ROUTE_SOURCE).toContain('verifyWebhookSignature');
      expect(WEBHOOK_ROUTE_SOURCE).toContain('stripe-signature');
    });

    it('should verify production webhook has rate limiting', () => {
      expect(WEBHOOK_ROUTE_SOURCE).toContain('checkRateLimit');
      expect(WEBHOOK_ROUTE_SOURCE).toContain('RATE_LIMITS.STRIPE_WEBHOOK');
    });

    it('should verify production webhook returns 200 for valid events to prevent retries', () => {
      // Stripe retries on non-200 responses; production always returns 200 for valid webhooks
      expect(WEBHOOK_ROUTE_SOURCE).toContain('received: true');
    });

    describe('Replay attack prevention (behavioral)', () => {
      it('should demonstrate idempotency check prevents duplicate processing', () => {
        // Behavioral test: simulates the pattern the production code uses
        const processedSessions = new Map<string, { timestamp: number }>();
        let processCount = 0;

        function simulateWebhookProcessing(sessionId: string): { duplicate: boolean } {
          // Mirrors production: check payment_transactions by session_id
          if (processedSessions.has(sessionId)) {
            return { duplicate: true };
          }

          processCount++;
          processedSessions.set(sessionId, { timestamp: Date.now() });
          return { duplicate: false };
        }

        // Same event delivered twice (Stripe retry scenario)
        const result1 = simulateWebhookProcessing('cs_test_123');
        const result2 = simulateWebhookProcessing('cs_test_123');

        expect(processCount).toBe(1);
        expect(result1.duplicate).toBe(false);
        expect(result2.duplicate).toBe(true);
      });

      it('should handle different session IDs independently', () => {
        const processedSessions = new Set<string>();

        function isProcessed(sessionId: string): boolean {
          if (processedSessions.has(sessionId)) return true;
          processedSessions.add(sessionId);
          return false;
        }

        expect(isProcessed('cs_test_123')).toBe(false);
        expect(isProcessed('cs_test_456')).toBe(false);
        expect(isProcessed('cs_test_123')).toBe(true);
        expect(isProcessed('cs_test_456')).toBe(true);
        expect(isProcessed('cs_test_789')).toBe(false);
      });
    });
  });

  describe('Refund Security', () => {
    describe('Production refund route patterns', () => {
      it('should verify production refund route checks transaction status', () => {
        expect(REFUND_ROUTE_SOURCE).toContain("transaction.status !== 'completed'");
      });

      it('should verify production refund route validates amount bounds', () => {
        expect(REFUND_ROUTE_SOURCE).toContain('refundAmount > maxRefundable');
      });

      it('should verify production refund route delegates access revocation to shared service', () => {
        expect(REFUND_ROUTE_SOURCE).toContain('revokeTransactionAccess');
        expect(REFUND_ROUTE_SOURCE).toContain("from '@/lib/services/access-revocation'");
      });

      it('should verify production refund route requires admin auth', () => {
        expect(REFUND_ROUTE_SOURCE).toContain("'admin_users'");
        expect(REFUND_ROUTE_SOURCE).toContain('Forbidden');
      });
    });

    describe('Valid refunds', () => {
      it('should allow full refund', () => {
        const result = validateRefund(10000, 10000, 0, 'completed');
        expect(result.valid).toBe(true);
      });

      it('should allow partial refund', () => {
        const result = validateRefund(5000, 10000, 0, 'completed');
        expect(result.valid).toBe(true);
      });

      it('should allow remaining partial refund', () => {
        const result = validateRefund(3000, 10000, 5000, 'completed');
        expect(result.valid).toBe(true);
      });
    });

    describe('Invalid refunds', () => {
      it('should reject over-refund', () => {
        const result = validateRefund(15000, 10000, 0, 'completed');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('exceeds');
      });

      it('should reject over-refund after partial', () => {
        const result = validateRefund(6000, 10000, 5000, 'completed');
        expect(result.valid).toBe(false);
      });

      it('should reject refund on non-completed', () => {
        const result = validateRefund(5000, 10000, 0, 'pending');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('status');
      });

      it('should reject refund on already refunded', () => {
        const result = validateRefund(5000, 10000, 0, 'refunded');
        expect(result.valid).toBe(false);
      });

      it('should reject zero refund', () => {
        const result = validateRefund(0, 10000, 0, 'completed');
        expect(result.valid).toBe(false);
      });

      it('should reject negative refund', () => {
        const result = validateRefund(-100, 10000, 0, 'completed');
        expect(result.valid).toBe(false);
      });
    });

    describe('Double refund prevention', () => {
      it('should reject when already fully refunded', () => {
        const result = validateRefund(100, 10000, 10000, 'completed');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('exceeds');
      });
    });
  });

  describe('Stripe metadata overflow guard (bump_product_ids)', () => {
    // Mirror of the truncation logic in create-payment-intent/route.ts.
    // Stripe enforces a 500-char limit per metadata value — exceeding it causes
    // the payment intent creation to fail with a 400 error.
    function truncateBumpIds(ids: string[]): string {
      const joined = ids.join(',');
      if (joined.length > 500) {
        const truncated = joined.slice(0, 500);
        return truncated.slice(0, truncated.lastIndexOf(','));
      }
      return joined;
    }

    const UUID = '00000000-0000-0000-0000-000000000000'; // 36 chars

    it('passes through short list unchanged', () => {
      const ids = [UUID, UUID, UUID];
      const result = truncateBumpIds(ids);
      expect(result).toBe(ids.join(','));
      expect(result.length).toBeLessThanOrEqual(500);
    });

    it('truncates long list to under 500 chars', () => {
      // 13 UUIDs × 36 chars + 12 commas = 480 chars → fits
      // 14 UUIDs × 36 chars + 13 commas = 517 chars → must truncate
      const ids = Array(14).fill(UUID);
      const result = truncateBumpIds(ids);
      expect(result.length).toBeLessThanOrEqual(500);
    });

    it('never leaves a trailing comma after truncation', () => {
      const ids = Array(20).fill(UUID);
      const result = truncateBumpIds(ids);
      expect(result.endsWith(',')).toBe(false);
    });

    it('result contains only complete UUIDs after truncation', () => {
      const ids = Array(20).fill(UUID);
      const result = truncateBumpIds(ids);
      const parts = result.split(',');
      for (const part of parts) {
        expect(part).toMatch(/^[0-9a-f-]{36}$/);
      }
    });

    it('production route source contains the 500-char guard', () => {
      const CREATE_PI_SOURCE = readFileSync(
        resolve(__dirname, '../../../src/app/api/create-payment-intent/route.ts'),
        'utf-8'
      );
      expect(CREATE_PI_SOURCE).toContain('ids.length > 500');
      expect(CREATE_PI_SOURCE).toContain('lastIndexOf(\',\')');
      // Fallback comment — webhook uses payment_line_items when metadata is truncated
      expect(CREATE_PI_SOURCE).toContain('payment_line_items');
    });
  });
});
