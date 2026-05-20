import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getStripeServer: vi.fn(),
  stripeSessionsRetrieve: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/stripe/server', () => ({
  getStripeServer: mocks.getStripeServer,
}));

import { verifyPaymentSession } from '@/lib/payment/verify-payment';

function makeUser(id: string, email: string): User {
  return { id, email } as unknown as User;
}

function makeAdminClientNoCache() {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAdminClient.mockReturnValue(makeAdminClientNoCache());
  mocks.getStripeServer.mockResolvedValue({
    checkout: { sessions: { retrieve: mocks.stripeSessionsRetrieve } },
  });
});

describe('verifyPaymentSession — IDOR guard for guest sessions', () => {
  it('rejects when logged-in user email does not match Stripe guest session email', async () => {
    mocks.stripeSessionsRetrieve.mockResolvedValue({
      id: 'cs_test_guest',
      status: 'open',
      payment_status: 'unpaid',
      mode: 'payment',
      metadata: {},
      customer_details: { email: 'attacker@example.com' },
      amount_total: 9900,
      currency: 'pln',
      created: 1700000000,
      expires_at: 1700003600,
    });

    const victim = makeUser('user-victim', 'victim@example.com');
    const result = await verifyPaymentSession('cs_test_guest', victim);

    expect(result.error).toMatch(/does not belong/i);
    expect(result.customer_email).toBeUndefined();
    expect(result.amount_total).toBeUndefined();
  });

  it('allows logged-in user when session email matches their account email (case-insensitive)', async () => {
    mocks.stripeSessionsRetrieve.mockResolvedValue({
      id: 'cs_test_match',
      status: 'open',
      payment_status: 'unpaid',
      mode: 'payment',
      metadata: {},
      customer_details: { email: 'Buyer@Example.COM' },
      amount_total: 9900,
      currency: 'pln',
      created: 1700000000,
      expires_at: 1700003600,
    });

    const buyer = makeUser('user-buyer', 'buyer@example.com');
    const result = await verifyPaymentSession('cs_test_match', buyer);

    expect(result.error).toBeUndefined();
    expect(result.customer_email).toBe('Buyer@Example.COM');
  });

  it('rejects when logged-in user email does not match cached guest transaction email', async () => {
    const cachedTx = {
      id: 'tx-cached-guest',
      session_id: 'cs_cached_guest',
      product_id: 'p-1',
      customer_email: 'attacker@example.com',
      user_id: null,
      amount: 9900,
      currency: 'pln',
      status: 'completed',
      created_at: '2026-05-20T10:00:00Z',
      products: { id: 'p-1', slug: 'g', name: 'G', success_redirect_url: null },
    };

    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'payment_transactions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: cachedTx, error: null }),
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const victim = makeUser('user-victim', 'victim@example.com');
    const result = await verifyPaymentSession('cs_cached_guest', victim);

    expect(result.error).toMatch(/does not belong/i);
    expect(result.customer_email).toBeUndefined();
    expect(result.amount_total).toBeUndefined();
  });

  it('allows anonymous request (no user) for guest session — current public flow', async () => {
    mocks.stripeSessionsRetrieve.mockResolvedValue({
      id: 'cs_test_anon',
      status: 'open',
      payment_status: 'unpaid',
      mode: 'payment',
      metadata: {},
      customer_details: { email: 'buyer@example.com' },
      amount_total: 9900,
      currency: 'pln',
      created: 1700000000,
      expires_at: 1700003600,
    });

    const result = await verifyPaymentSession('cs_test_anon', null);

    expect(result.error).toBeUndefined();
    expect(result.customer_email).toBe('buyer@example.com');
  });
});
