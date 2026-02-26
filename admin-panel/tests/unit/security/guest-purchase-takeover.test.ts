import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

/**
 * ============================================================================
 * SECURITY TEST: Guest Purchase Session Takeover (CVE-GATEFLOW-001)
 * ============================================================================
 *
 * VULNERABILITY: A logged-in attacker can steal access to products purchased
 * by guests if they obtain the session_id (via Referer leak, logs, etc.)
 *
 * ATTACK FLOW:
 * 1. Victim makes guest purchase -> session_id in URL /success?session_id=cs_xxx
 * 2. Session_id leaks via HTTP Referer when victim clicks external link
 * 3. Attacker logs in and calls /api/verify-payment with stolen session_id
 * 4. Previous vulnerable code would grant access to attacker's account
 *
 * FIX:
 * - verify-payment route validates session_id before processing
 * - Ownership check: if logged-in user tries to verify, require user_id match
 * - Guest purchase query uses session_id for lookup (not email alone)
 *
 * This file tests the REAL production code to ensure security fixes remain intact.
 * ============================================================================
 */

// ===== LOAD REAL PRODUCTION SOURCE CODE =====

const verifyPaymentRoutePath = join(__dirname, '../../../src/app/api/verify-payment/route.ts');
const verifyPaymentRouteSource = readFileSync(verifyPaymentRoutePath, 'utf-8');

const verifyPaymentLibPath = join(__dirname, '../../../src/lib/payment/verify-payment.ts');
const verifyPaymentLibSource = readFileSync(verifyPaymentLibPath, 'utf-8');

// SOURCE_TEXT_VERIFY: These tests read production source and assert on security-critical
// patterns. Runtime testing is not possible because the verify-payment route requires a
// real Stripe session and Supabase service role client. Source text verification ensures
// security-critical code paths (ownership checks, bypass prevention) are not accidentally
// removed during refactoring.

describe('Guest Purchase Session Takeover Prevention', () => {
  describe('verify-payment route security guards', () => {
    it('validates session_id and delegates to verifyPaymentSession with user context', () => {
      expect(verifyPaymentRouteSource).toContain("if (!session_id)");
      expect(verifyPaymentRouteSource).toContain("'Session ID is required'");
      expect(verifyPaymentRouteSource).toContain('verifyPaymentSession(session_id, user)');
    });

    it('returns appropriate HTTP status codes for error scenarios', () => {
      expect(verifyPaymentRouteSource).toContain("'Invalid session ID'");
      expect(verifyPaymentRouteSource).toContain('status: 400');
      expect(verifyPaymentRouteSource).toContain("'Session does not belong to current user'");
      expect(verifyPaymentRouteSource).toContain('status: 403');
      expect(verifyPaymentRouteSource).toContain("'Session not found'");
      expect(verifyPaymentRouteSource).toContain('status: 404');
    });

    it('applies rate limiting and gets authenticated user context', () => {
      expect(verifyPaymentRouteSource).toContain('checkRateLimit');
      expect(verifyPaymentRouteSource).toContain("'verify_payment'");
      expect(verifyPaymentRouteSource).toContain('supabase.auth.getUser()');
    });
  });

  describe('verifyPaymentSession security checks', () => {
    it('is server-only and validates environment variables', () => {
      expect(verifyPaymentLibSource).toContain("typeof window !== 'undefined'");
      expect(verifyPaymentLibSource).toContain(
        'verifyPaymentSession can only be called on the server'
      );
      expect(verifyPaymentLibSource).toContain('!process.env.SUPABASE_URL');
      expect(verifyPaymentLibSource).toContain('!process.env.SUPABASE_SERVICE_ROLE_KEY');
      expect(verifyPaymentLibSource).toContain("'Server configuration error'");
    });

    it('validates session_id input and uses service role client', () => {
      expect(verifyPaymentLibSource).toContain("!sessionId || typeof sessionId !== 'string'");
      expect(verifyPaymentLibSource).toContain("'Invalid session ID'");
      expect(verifyPaymentLibSource).toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(verifyPaymentLibSource).toContain('createServiceClient');
    });

    it('uses session_id (not email alone) for payment lookup', () => {
      expect(verifyPaymentLibSource).toContain(".eq('session_id', sessionId)");
    });

    it('checks ownership via both Stripe metadata and database transaction', () => {
      // Stripe session metadata path
      expect(verifyPaymentLibSource).toContain('session.metadata?.user_id');
      expect(verifyPaymentLibSource).toContain('session.metadata.user_id !== user.id');
      // Database transaction path
      expect(verifyPaymentLibSource).toContain('transaction.user_id !== user.id');
    });

    it('blocks cross-user session claiming with error return', () => {
      expect(verifyPaymentLibSource).toContain(
        "error: 'Session does not belong to current user'"
      );
    });

    it('prevents user_id bypass via empty, null-string, and undefined values', () => {
      const bypassChecks = [
        "session.metadata.user_id !== ''",
        "session.metadata.user_id !== 'null'",
        'session.metadata?.user_id',
      ];

      for (const check of bypassChecks) {
        expect(verifyPaymentLibSource).toContain(check);
      }
    });

    it('distinguishes guest purchase from authenticated purchase', () => {
      expect(verifyPaymentLibSource).toContain('is_guest_purchase');
      expect(verifyPaymentLibSource).toContain('requires_login');
    });
  });
});
