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
 *           src/lib/services/access-revocation.ts (shared revocation logic)
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
 * FIX (V16): Added separate cleanup for guest_purchases table using session_id
 * FIX (V17): Extracted all revocation logic into revokeTransactionAccess() —
 *            single source of truth for main + bump product access revocation.
 *
 * This file tests the REAL production code to ensure security fixes remain intact.
 * ============================================================================
 */

// ===== LOAD REAL PRODUCTION SOURCE CODE =====

const refundRoutePath = join(__dirname, '../../../src/app/api/admin/payments/refund/route.ts');
const refundRouteSource = readFileSync(refundRoutePath, 'utf-8');

const accessRevocationPath = join(__dirname, '../../../src/lib/services/access-revocation.ts');
const accessRevocationSource = readFileSync(accessRevocationPath, 'utf-8');

// SOURCE_TEXT_VERIFY: The refund route delegates access revocation to the shared
// revokeTransactionAccess() function. We verify:
// 1. The route imports and calls the shared function
// 2. The shared function performs dual-path revocation (user_product_access + guest_purchases)
// Refund amount validation tests live in parameter-tampering.test.ts.

describe('Refund Access Revocation Security', () => {
  describe('Production Code Verification (refund route → shared revocation)', () => {
    it('delegates access revocation to shared revokeTransactionAccess()', () => {
      expect(refundRouteSource).toContain('revokeTransactionAccess');
      expect(refundRouteSource).toContain("from '@/lib/services/access-revocation'");
    });

    it('passes transaction context to revocation function', () => {
      expect(refundRouteSource).toContain('transactionId: transaction.id');
      expect(refundRouteSource).toContain('userId: transaction.user_id');
      expect(refundRouteSource).toContain('productId: transaction.product_id');
      expect(refundRouteSource).toContain('sessionId: transaction.session_id');
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

  describe('Shared Revocation Service (access-revocation.ts)', () => {
    it('revokes user_product_access with user_id and product_id conditions', () => {
      expect(accessRevocationSource).toMatch(/\.from\(\s*['"]user_product_access['"]\s*\)[\s\S]*?\.delete\(\)/);
      expect(accessRevocationSource).toContain('.eq(\'user_id\', target.userId)');
      expect(accessRevocationSource).toContain('.eq(\'product_id\', target.productId)');
    });

    it('revokes guest_purchases using session_id', () => {
      expect(accessRevocationSource).toMatch(/\.from\(\s*['"]guest_purchases['"]\s*\)[\s\S]*?\.delete\(\)/);
      expect(accessRevocationSource).toContain('.eq(\'session_id\', target.sessionId)');
    });

    it('guest purchase cleanup path is separate from user access revocation', () => {
      expect(accessRevocationSource).toContain('target.sessionId && target.productId');
    });

    it('revokes bump product access (user_product_access + guest_purchases)', () => {
      expect(accessRevocationSource).toContain('payment_line_items');
      expect(accessRevocationSource).toContain('order_bump');
      expect(accessRevocationSource).toContain('bumpProductIds');
    });
  });
});
