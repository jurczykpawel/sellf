import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

/**
 * ============================================================================
 * SECURITY TEST: Refund Access Revocation
 * ============================================================================
 *
 * VULNERABILITY: Guest Purchase Access Not Revoked After Refund (V-CRITICAL-06)
 * LOCATION: src/app/api/admin/payments/refund/route.ts
 *
 * ATTACK FLOW (before fix):
 * 1. Guest purchases product (creates record in guest_purchases table)
 * 2. Admin processes refund
 * 3. Refund handler ONLY deleted from user_product_access (for authenticated users)
 * 4. Guest purchase record remained in guest_purchases table
 * 5. Guest later creates account with same email
 * 6. claim_guest_purchases_for_user() grants access to refunded product
 * 7. Guest gets product for FREE after receiving refund
 *
 * ROOT CAUSE:
 * The refund handler only checked `if (transaction.user_id && transaction.product_id)`
 * For guest purchases, user_id is NULL, so the access revocation was skipped entirely.
 *
 * FIX (V16):
 * Added separate cleanup for guest_purchases table using session_id
 *
 * This file tests the REAL production code to ensure security fixes remain intact.
 * ============================================================================
 */

// ===== LOAD REAL PRODUCTION SOURCE CODE =====

const refundRoutePath = join(__dirname, '../../../src/app/api/admin/payments/refund/route.ts');
const refundRouteSource = readFileSync(refundRoutePath, 'utf-8');

// SOURCE_TEXT_VERIFY: These tests read production source and assert on security-critical
// patterns. Runtime testing is not possible because the refund route requires a real
// Stripe connection and admin authentication. Source text verification ensures the
// dual-path access revocation (user_product_access + guest_purchases) is not accidentally
// removed during refactoring. Refund amount validation tests live in
// parameter-tampering.test.ts to avoid duplication.

describe('Refund Access Revocation Security', () => {
  describe('Production Code Verification (refund route)', () => {
    it('revokes user_product_access with user_id and product_id conditions', () => {
      expect(refundRouteSource).toMatch(/\.from\(\s*['"]user_product_access['"]\s*\)[\s\S]*?\.delete\(\)/);
      expect(refundRouteSource).toContain(".eq('user_id', transaction.user_id)");
      expect(refundRouteSource).toContain(".eq('product_id', transaction.product_id)");
    });

    it('revokes guest_purchases using session_id (V16 fix)', () => {
      expect(refundRouteSource).toMatch(/\.from\(\s*['"]guest_purchases['"]\s*\)[\s\S]*?\.delete\(\)/);
      expect(refundRouteSource).toContain(".eq('session_id', transaction.session_id)");
    });

    it('guest purchase cleanup path is separate from user access revocation', () => {
      expect(refundRouteSource).toContain('transaction.session_id && transaction.product_id');
    });

    it('requires admin authentication', () => {
      expect(refundRouteSource).toContain("'Unauthorized'");
      expect(refundRouteSource).toContain("'Forbidden'");
      expect(refundRouteSource).toContain("admin_users");
    });

    it('enforces rate limiting and validates transaction status', () => {
      expect(refundRouteSource).toContain('checkRateLimit');
      expect(refundRouteSource).toContain('RATE_LIMITS.ADMIN_REFUND');
      expect(refundRouteSource).toContain("transaction.status !== 'completed'");
      expect(refundRouteSource).toContain("'Only completed transactions can be refunded'");
    });
  });
});
