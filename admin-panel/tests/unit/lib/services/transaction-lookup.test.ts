/**
 * Unit tests: findTransactionByOrderId
 *
 * @see src/lib/services/transaction-lookup.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { findTransactionByOrderId } from '@/lib/services/transaction-lookup';

function createMockSupabase({
  byIntent = null as Record<string, unknown> | null,
  bySession = null as Record<string, unknown> | null,
}: {
  byIntent?: Record<string, unknown> | null;
  bySession?: Record<string, unknown> | null;
}) {
  const eqCalls: Array<[string, string]> = [];
  const from = vi.fn().mockImplementation((table: string) => ({
    select: vi.fn().mockImplementation((columns: string) => ({
      eq: vi.fn().mockImplementation((column: string, value: string) => {
        eqCalls.push([column, value]);
        return {
          maybeSingle: vi.fn().mockResolvedValue(
            column === 'stripe_payment_intent_id'
              ? { data: byIntent, error: null }
              : { data: bySession, error: null },
          ),
        };
      }),
    })),
  }));
  expect(from).toBeDefined();
  return { from, eqCalls };
}

describe('findTransactionByOrderId', () => {
  it('finds the row by stripe_payment_intent_id without a second lookup', async () => {
    const row = { id: 'txn-1' };
    const { from, eqCalls } = createMockSupabase({ byIntent: row });
    const result = await findTransactionByOrderId({ from } as never, 'pi_123', 'id');
    expect(result).toEqual(row);
    expect(eqCalls).toEqual([['stripe_payment_intent_id', 'pi_123']]);
  });

  it('falls back to session_id when no row matches the payment intent id', async () => {
    const row = { id: 'txn-2' };
    const { from, eqCalls } = createMockSupabase({ byIntent: null, bySession: row });
    const result = await findTransactionByOrderId({ from } as never, 'cs_456', 'id');
    expect(result).toEqual(row);
    expect(eqCalls).toEqual([
      ['stripe_payment_intent_id', 'cs_456'],
      ['session_id', 'cs_456'],
    ]);
  });

  it('returns null when neither lookup matches', async () => {
    const { from } = createMockSupabase({ byIntent: null, bySession: null });
    const result = await findTransactionByOrderId({ from } as never, 'unknown', 'id');
    expect(result).toBeNull();
  });
});
