/** @see src/lib/stripe/checkout-expiration.ts */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expireBoundCheckoutSession, abandonPendingCheckoutSession } from '@/lib/stripe/checkout-expiration';
import { signCheckoutBinding } from '@/lib/security/checkout-binding';
import { buildWebhookParams } from '@/lib/stripe/webhook-registration';
import { RETRIABLE_EVENTS } from '@/app/api/webhooks/stripe/retriable-events';
import type Stripe from 'stripe';
import type { createAdminClient } from '@/lib/supabase/admin';

const savedSecret = process.env.CHECKOUT_BINDING_SECRET;
beforeEach(() => { process.env.CHECKOUT_BINDING_SECRET = 'checkout-expiration-test-secret'; });
afterEach(() => {
  if (savedSecret === undefined) delete process.env.CHECKOUT_BINDING_SECRET;
  else process.env.CHECKOUT_BINDING_SECRET = savedSecret;
});

function fixtures(status = 'open', rowStatus = 'pending') {
  const row = { session_id: 'cs_test_first', status: rowStatus };
  const update = vi.fn((values: { status: string }) => {
    const filters: Record<string, string> = {};
    const query = {
      eq: vi.fn((column: string, value: string) => { filters[column] = value; return query; }),
      then: (resolve: (value: { error: null }) => void) => {
        if (filters.session_id === row.session_id && filters.status === row.status) row.status = values.status;
        resolve({ error: null });
      },
    };
    return query;
  });
  const from = vi.fn(() => ({ update }));
  const stripe = {
    checkout: { sessions: {
      retrieve: vi.fn(async () => ({ id: row.session_id, status, metadata: { product_id: 'product', user_id: '' } })),
      expire: vi.fn(async () => ({ id: row.session_id, status: 'expired' })),
    } },
  };
  return { row, update, from, db: { from } as unknown as ReturnType<typeof createAdminClient>, stripe: stripe as unknown as Stripe, sessions: stripe.checkout.sessions };
}
function input(token?: string) {
  return {
    clientSecret: 'cs_test_first_secret_value',
    bindingToken: token ?? signCheckoutBinding({ stripeObjectId: 'cs_test_first', userId: null, productId: 'product' }),
  };
}

describe('checkout expiration', () => {
  it('expires a bound open session and abandons its pending transaction', async () => {
    const f = fixtures();
    expect(await expireBoundCheckoutSession(f.stripe, f.db, input())).toEqual({ success: true });
    expect(f.sessions.expire).toHaveBeenCalledWith('cs_test_first');
    expect(f.row.status).toBe('abandoned');
  });
  it('reconciles an already expired session without expiring it again', async () => {
    const f = fixtures('expired');
    await expireBoundCheckoutSession(f.stripe, f.db, input());
    expect(f.sessions.expire).not.toHaveBeenCalled();
    expect(f.row.status).toBe('abandoned');
  });
  it('leaves completed sessions and completed transactions intact', async () => {
    const f = fixtures('complete', 'completed');
    await expireBoundCheckoutSession(f.stripe, f.db, input());
    expect(f.sessions.expire).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    expect(f.row.status).toBe('completed');
  });
  it('rejects a mismatched binding without modifying either system', async () => {
    const f = fixtures();
    expect((await expireBoundCheckoutSession(f.stripe, f.db, input('different'))).success).toBe(false);
    expect(f.sessions.expire).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
  });
  it('keeps completed rows when expiration arrives after completion and tolerates duplicate expiration', async () => {
    for (const status of ['pending', 'completed', 'refunded', 'abandoned']) {
      const f = fixtures('expired', status);
      await abandonPendingCheckoutSession(f.db, f.row.session_id);
      await abandonPendingCheckoutSession(f.db, f.row.session_id);
      expect(f.row.status).toBe(status === 'pending' ? 'abandoned' : status);
      expect(f.update.mock.results[0].value.eq).toHaveBeenCalledWith('status', 'pending');
    }
  });
  it('returns failure on database errors so reconciliation can be retried', async () => {
    const f = fixtures();
    const query = { eq: vi.fn().mockReturnThis(), then: (resolve: (value: object) => void) => resolve({ error: { message: 'unavailable' } }) };
    f.update.mockReturnValue(query as unknown as ReturnType<typeof f.update>);
    expect((await abandonPendingCheckoutSession(f.db, 'cs_test_first')).success).toBe(false);
  });
  it('returns failure when the database request rejects', async () => {
    const f = fixtures();
    f.from.mockImplementation(() => { throw new Error('temporary'); });
    await expect(abandonPendingCheckoutSession(f.db, 'cs_test_first')).resolves.toEqual({
      success: false, error: 'Unable to reconcile checkout session', status: 503,
    });
  });
  it('registers expiration events and retries failed expiration processing', () => {
    expect(buildWebhookParams('https://shop.example/api/webhooks/stripe').enabled_events).toContain('checkout.session.expired');
    expect(RETRIABLE_EVENTS.has('checkout.session.expired')).toBe(true);
  });
});
