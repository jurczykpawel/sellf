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

  describe('Atomicity: access revocation runs even when DB update fails', () => {
    it('revocation is NOT inside a dbUpdateFailed===false branch', () => {
      // The fix: revocation must run regardless of DB update outcome.
      // If revokeTransactionAccess were inside "if (!dbUpdateFailed)", a DB failure
      // would leave the customer with both a refund AND product access.
      const dbCheckIndex = refundRouteSource.indexOf('dbUpdateFailed');
      const revocationIndex = refundRouteSource.indexOf('revokeTransactionAccess(supabase');
      expect(dbCheckIndex).toBeGreaterThan(-1);
      expect(revocationIndex).toBeGreaterThan(-1);

      // Ensure revocation call is NOT wrapped in "if (!dbUpdateFailed)"
      // by checking that no "!dbUpdateFailed" guard appears before revokeTransactionAccess
      const betweenDbCheckAndRevocation = refundRouteSource.slice(dbCheckIndex, revocationIndex);
      expect(betweenDbCheckAndRevocation).not.toContain('if (!dbUpdateFailed)');
      expect(betweenDbCheckAndRevocation).not.toContain('if(!dbUpdateFailed)');
    });

    it('revocation runs unconditionally within isFullRefund block', () => {
      // The revocation should be inside "if (isFullRefund)" but NOT inside
      // any further condition related to dbUpdateFailed
      const fullRefundBlock = refundRouteSource.match(/if \(isFullRefund\)\s*\{([\s\S]*?)^\s{4}\}/m);
      expect(fullRefundBlock).not.toBeNull();
      const blockContent = fullRefundBlock![1];
      expect(blockContent).toContain('revokeTransactionAccess');
      // No dbUpdateFailed guard inside this block
      expect(blockContent).not.toMatch(/if\s*\(\s*!?\s*dbUpdateFailed/);
    });

    it('returns 409 with warning when DB update fails but refund succeeds', () => {
      expect(refundRouteSource).toContain('if (dbUpdateFailed)');
      expect(refundRouteSource).toContain('status: 409');
      expect(refundRouteSource).toContain('database update failed');
    });

    it('tracks access revocation failure separately from DB failure', () => {
      expect(refundRouteSource).toContain('accessRevocationFailed');
      expect(refundRouteSource).toContain('access revocation failed');
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
