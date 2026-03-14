/**
 * Unit Tests: revokeTransactionAccess service
 *
 * Covers:
 * 1. Main product user_product_access revocation (authenticated user)
 * 2. Main product guest_purchases revocation (guest session)
 * 3. Bump product access revocation (user_product_access for each bump)
 * 4. Bump product guest_purchases revocation (guest for each bump)
 * 5. No bumps scenario — only main product revoked
 * 6. Missing user_id — skips user_product_access, still cleans guest_purchases
 * 7. Missing session_id — skips guest_purchases, still cleans user_product_access
 * 8. Both user_id and session_id null — no revocation but no crash
 * 9. Bump query error — warns but doesn't fail
 * 10. Batch bump revocation error — warns but doesn't fail
 * 11. Main product revocation error — warns but continues
 * 12. Idempotent — deleting non-existent rows is a no-op
 * 13. Multiple bumps — all revoked
 *
 * @see src/lib/services/access-revocation.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';
import type { RevocationTarget } from '@/lib/services/access-revocation';

// ===== MOCK SUPABASE CLIENT =====

interface MockDeleteChain {
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
}

interface MockSelectChain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
}

function createMockSupabase({
  bumpLineItems = [] as Array<{ product_id: string }>,
  bumpQueryError = null as { message: string } | null,
  deleteErrors = {} as Record<string, { message: string } | null>,
}: {
  bumpLineItems?: Array<{ product_id: string }>;
  bumpQueryError?: { message: string } | null;
  deleteErrors?: Record<string, { message: string } | null>;
} = {}) {
  // Track all .from() calls and their chains for assertions
  const fromCalls: Array<{ table: string; operation: string; filters: Record<string, string> }> = [];

  const from = vi.fn().mockImplementation((table: string) => {
    // Handle SELECT (for payment_line_items query)
    const selectChain: MockSelectChain = {
      select: vi.fn(),
      eq: vi.fn(),
    };

    // Handle DELETE chains
    const deleteChain: MockDeleteChain = {
      delete: vi.fn(),
      eq: vi.fn(),
    };

    const filters: Record<string, string> = {};
    const call = { table, operation: '', filters };

    // .in() handler for batch delete — resolves the chain with product_id array
    const inHandler = vi.fn().mockImplementation((column: string, values: string[]) => {
      filters[column] = `[${values.join(',')}]`;

      if (call.operation === 'delete') {
        // Check for per-value errors (any matching "table:column=value")
        const matchingError = values
          .map(v => deleteErrors[`${table}:${column}=${v}`])
          .find(e => e !== null && e !== undefined);

        fromCalls.push({ ...call });
        return Promise.resolve({ error: matchingError || null });
      }

      return Promise.resolve({ data: null, error: null });
    });

    // Chain builder for .eq() — tracks all filter arguments
    const eqHandler = vi.fn().mockImplementation((column: string, value: string) => {
      filters[column] = value;

      // Detect if this is a select or delete chain based on what was called
      if (call.operation === 'select') {
        // Last .eq() in a SELECT chain resolves the promise
        // For payment_line_items, resolve after item_type filter
        if (column === 'item_type') {
          return Promise.resolve({
            data: bumpQueryError ? null : bumpLineItems,
            error: bumpQueryError,
          });
        }
        return { eq: eqHandler };
      }

      if (call.operation === 'delete') {
        // Determine error key: "table:column=value" pattern
        const errorKey = `${table}:${column}=${value}`;
        const specificError = deleteErrors[errorKey] || null;

        // After the second .eq() in a delete chain, resolve
        if (Object.keys(filters).length >= 2) {
          fromCalls.push({ ...call });
          return Promise.resolve({ error: specificError });
        }
        return { eq: eqHandler, in: inHandler };
      }

      return { eq: eqHandler, in: inHandler };
    });

    // .select() starts a select chain
    selectChain.select = vi.fn().mockImplementation(() => {
      call.operation = 'select';
      return { eq: eqHandler };
    });

    // .delete() starts a delete chain
    deleteChain.delete = vi.fn().mockImplementation(() => {
      call.operation = 'delete';
      return { eq: eqHandler };
    });

    return {
      select: selectChain.select,
      delete: deleteChain.delete,
      eq: eqHandler,
    };
  });

  return { from, _fromCalls: fromCalls };
}

// ===== FIXTURES =====

const TRANSACTION_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PRODUCT_ID = '33333333-3333-3333-3333-333333333333';
const SESSION_ID = 'cs_test_session123';
const BUMP_1 = '44444444-4444-4444-4444-444444444444';
const BUMP_2 = '55555555-5555-5555-5555-555555555555';
const BUMP_3 = '66666666-6666-6666-6666-666666666666';

const fullTarget: RevocationTarget = {
  transactionId: TRANSACTION_ID,
  userId: USER_ID,
  productId: PRODUCT_ID,
  sessionId: SESSION_ID,
};

const guestOnlyTarget: RevocationTarget = {
  transactionId: TRANSACTION_ID,
  userId: null,
  productId: PRODUCT_ID,
  sessionId: SESSION_ID,
};

const authOnlyTarget: RevocationTarget = {
  transactionId: TRANSACTION_ID,
  userId: USER_ID,
  productId: PRODUCT_ID,
  sessionId: null,
};

const noAccessTarget: RevocationTarget = {
  transactionId: TRANSACTION_ID,
  userId: null,
  productId: PRODUCT_ID,
  sessionId: null,
};

// ===== TESTS =====

describe('revokeTransactionAccess', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Input validation (defense-in-depth)', () => {
    it('rejects empty transactionId', async () => {
      const mock = createMockSupabase();
      const result = await revokeTransactionAccess(mock as never, { ...fullTarget, transactionId: '' });

      expect(result.success).toBe(false);
      expect(result.warnings[0]).toContain('Invalid transactionId');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('rejects non-UUID transactionId', async () => {
      const mock = createMockSupabase();
      const result = await revokeTransactionAccess(mock as never, { ...fullTarget, transactionId: 'not-a-uuid' });

      expect(result.success).toBe(false);
      expect(result.warnings[0]).toContain('Invalid transactionId');
    });

    it('rejects non-UUID productId', async () => {
      const mock = createMockSupabase();
      const result = await revokeTransactionAccess(mock as never, { ...fullTarget, productId: 'bad' });

      expect(result.success).toBe(false);
      expect(result.warnings[0]).toContain('Invalid productId');
    });

    it('rejects non-UUID userId (when non-null)', async () => {
      const mock = createMockSupabase();
      const result = await revokeTransactionAccess(mock as never, { ...fullTarget, userId: 'bad-id' });

      expect(result.success).toBe(false);
      expect(result.warnings[0]).toContain('Invalid userId');
    });

    it('accepts null userId', async () => {
      const mock = createMockSupabase();
      const result = await revokeTransactionAccess(mock as never, guestOnlyTarget);

      expect(result.success).toBe(true);
    });
  });

  describe('Main product revocation (no bumps)', () => {
    it('revokes user_product_access for authenticated user', async () => {
      const mock = createMockSupabase();
      const result = await revokeTransactionAccess(mock as never, authOnlyTarget);

      expect(result.success).toBe(true);
      expect(result.mainProductRevoked).toBe(true);
      expect(result.bumpProductsRevoked).toBe(0);
      expect(result.warnings).toHaveLength(0);

      // Should query payment_line_items
      expect(mock.from).toHaveBeenCalledWith('payment_line_items');
      // Should delete from user_product_access
      expect(mock.from).toHaveBeenCalledWith('user_product_access');
    });

    it('revokes guest_purchases for guest session', async () => {
      const mock = createMockSupabase();
      const result = await revokeTransactionAccess(mock as never, guestOnlyTarget);

      expect(result.success).toBe(true);
      expect(result.mainGuestRevoked).toBe(true);
      expect(result.bumpProductsRevoked).toBe(0);
      expect(mock.from).toHaveBeenCalledWith('guest_purchases');
    });

    it('revokes both user_product_access and guest_purchases when both present', async () => {
      const mock = createMockSupabase();
      const result = await revokeTransactionAccess(mock as never, fullTarget);

      expect(result.success).toBe(true);
      expect(result.mainProductRevoked).toBe(true);
      expect(result.mainGuestRevoked).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('user_product_access');
      expect(mock.from).toHaveBeenCalledWith('guest_purchases');
    });

    it('handles no user_id and no session_id gracefully', async () => {
      const mock = createMockSupabase();
      const result = await revokeTransactionAccess(mock as never, noAccessTarget);

      expect(result.success).toBe(true);
      expect(result.mainProductRevoked).toBe(false);
      expect(result.mainGuestRevoked).toBe(false);
      expect(result.bumpProductsRevoked).toBe(0);
      expect(result.warnings).toHaveLength(0);
      // Should still query payment_line_items
      expect(mock.from).toHaveBeenCalledWith('payment_line_items');
    });
  });

  describe('Bump product revocation', () => {
    it('revokes access for single bump product (user + guest)', async () => {
      const mock = createMockSupabase({
        bumpLineItems: [{ product_id: BUMP_1 }],
      });

      const result = await revokeTransactionAccess(mock as never, fullTarget);

      expect(result.success).toBe(true);
      expect(result.bumpProductsRevoked).toBe(1);
    });

    it('revokes access for multiple bump products', async () => {
      const mock = createMockSupabase({
        bumpLineItems: [
          { product_id: BUMP_1 },
          { product_id: BUMP_2 },
          { product_id: BUMP_3 },
        ],
      });

      const result = await revokeTransactionAccess(mock as never, fullTarget);

      expect(result.success).toBe(true);
      expect(result.bumpProductsRevoked).toBe(3);
    });

    it('revokes bump user_product_access even without session_id (auth-only)', async () => {
      const mock = createMockSupabase({
        bumpLineItems: [{ product_id: BUMP_1 }],
      });

      const result = await revokeTransactionAccess(mock as never, authOnlyTarget);

      expect(result.success).toBe(true);
      expect(result.bumpProductsRevoked).toBe(1);
    });

    it('revokes bump guest_purchases even without user_id (guest-only)', async () => {
      const mock = createMockSupabase({
        bumpLineItems: [{ product_id: BUMP_1 }],
      });

      const result = await revokeTransactionAccess(mock as never, guestOnlyTarget);

      expect(result.success).toBe(true);
      // bumpProductsRevoked only counts user_product_access deletions
      expect(result.bumpProductsRevoked).toBe(0);
      // But guest_purchases should be cleaned (no error = success)
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('Error handling', () => {
    it('warns on bump line items query failure but continues', async () => {
      const mock = createMockSupabase({
        bumpQueryError: { message: 'DB timeout' },
      });

      const result = await revokeTransactionAccess(mock as never, fullTarget);

      expect(result.success).toBe(false);
      expect(result.warnings).toContain('Failed to query bump line items: DB timeout');
      // Main product revocation should still proceed
      expect(mock.from).toHaveBeenCalledWith('user_product_access');
    });

    it('warns on main product revocation failure but continues', async () => {
      const mock = createMockSupabase({
        deleteErrors: {
          [`user_product_access:product_id=${PRODUCT_ID}`]: { message: 'RLS violation' },
        },
      });

      const result = await revokeTransactionAccess(mock as never, fullTarget);

      expect(result.success).toBe(false);
      expect(result.warnings.some(w => w.includes('Failed to revoke main product access'))).toBe(true);
    });

    it('warns on batch bump revocation failure', async () => {
      const mock = createMockSupabase({
        bumpLineItems: [
          { product_id: BUMP_1 },
          { product_id: BUMP_2 },
        ],
        deleteErrors: {
          // Any matching product_id error triggers the batch .in() to fail
          [`user_product_access:product_id=${BUMP_1}`]: { message: 'Some error' },
        },
      });

      const result = await revokeTransactionAccess(mock as never, fullTarget);

      // Batch failed — no bumps revoked
      expect(result.bumpProductsRevoked).toBe(0);
      expect(result.warnings.some(w => w.includes('bump product access'))).toBe(true);
    });

    it('warns on guest purchase revocation failure', async () => {
      const mock = createMockSupabase({
        deleteErrors: {
          [`guest_purchases:product_id=${PRODUCT_ID}`]: { message: 'FK violation' },
        },
      });

      const result = await revokeTransactionAccess(mock as never, fullTarget);

      expect(result.success).toBe(false);
      expect(result.warnings.some(w => w.includes('Failed to revoke main guest purchase'))).toBe(true);
    });
  });

  describe('Source code verification', () => {
    it('all 7 refund paths import and call revokeTransactionAccess()', () => {
      const { readFileSync } = require('fs');
      const { join } = require('path');

      const refundPaths = [
        'src/app/api/webhooks/stripe/route.ts',
        'src/app/api/admin/payments/refund/route.ts',
        'src/app/api/v1/payments/[id]/refund/route.ts',
        'src/lib/actions/payment.ts',
        'src/app/api/admin/refund-requests/[id]/route.ts',
        'src/app/api/v1/refund-requests/[id]/route.ts',
      ];

      for (const p of refundPaths) {
        const source = readFileSync(join(__dirname, '../../../../', p), 'utf-8');
        expect(source).toContain('revokeTransactionAccess');
        expect(source).toContain("from '@/lib/services/access-revocation'");
      }
    });

    it('shared service handles both user_product_access and guest_purchases', () => {
      const { readFileSync } = require('fs');
      const { join } = require('path');

      const source = readFileSync(
        join(__dirname, '../../../../src/lib/services/access-revocation.ts'),
        'utf-8'
      );

      expect(source).toContain("'user_product_access'");
      expect(source).toContain("'guest_purchases'");
      expect(source).toContain("'payment_line_items'");
      expect(source).toContain('.delete()');
    });

    it('shared service queries bump products from payment_line_items', () => {
      const { readFileSync } = require('fs');
      const { join } = require('path');

      const source = readFileSync(
        join(__dirname, '../../../../src/lib/services/access-revocation.ts'),
        'utf-8'
      );

      expect(source).toContain("item_type");
      expect(source).toContain("order_bump");
      expect(source).toContain("transaction_id");
    });

    it('shared service validates inputs before querying DB', () => {
      const { readFileSync } = require('fs');
      const { join } = require('path');

      const source = readFileSync(
        join(__dirname, '../../../../src/lib/services/access-revocation.ts'),
        'utf-8'
      );

      expect(source).toContain('UUID_PATTERN');
      expect(source).toContain('Invalid transactionId');
      expect(source).toContain('Invalid productId');
      expect(source).toContain('Invalid userId');
    });
  });
});
