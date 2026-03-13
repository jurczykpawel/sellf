import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

/**
 * ============================================================================
 * SECURITY TEST: Refund Access Revocation
 * ============================================================================
 *
 * Verifies that refund processing correctly revokes product access for
 * all purchase types (authenticated users and guest purchases).
 * Tests real production source code via static analysis.
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
