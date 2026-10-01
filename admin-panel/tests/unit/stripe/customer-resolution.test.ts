import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * getOrCreateStripeCustomer resolution rules with Stripe + Supabase mocked.
 * An existing Stripe customer found by email is only reused when no other
 * account holds it (neither via metadata.sellf_user_id nor via a DB mapping).
 */

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  mappingByUser: null as { stripe_customer_id: string } | null,
  mappingByCustomer: null as { user_id: string } | null,
}));

vi.mock('@/lib/stripe/server', () => ({
  getStripeServer: vi.fn(async () => ({
    customers: { search: mocks.search, create: mocks.create, update: mocks.update },
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: () => {
      let column = '';
      const q = {
        select: () => q,
        eq: (col: string) => {
          column = col;
          return q;
        },
        maybeSingle: async () => ({
          data: column === 'user_id' ? mocks.mappingByUser : mocks.mappingByCustomer,
          error: null,
        }),
        upsert: (...args: unknown[]) => {
          mocks.upsert(...args);
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  })),
}));

import { getOrCreateStripeCustomer } from '@/lib/stripe/customer';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mappingByUser = null;
  mocks.mappingByCustomer = null;
  mocks.search.mockResolvedValue({ data: [] });
  mocks.create.mockResolvedValue({ id: 'cus_new' });
  mocks.update.mockResolvedValue({});
});

describe('getOrCreateStripeCustomer', () => {
  it('returns the stored mapping for a signed-in user', async () => {
    mocks.mappingByUser = { stripe_customer_id: 'cus_mapped' };

    await expect(getOrCreateStripeCustomer({ email: 'a@example.com', userId: 'user-a' })).resolves.toBe('cus_mapped');
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('adopts an unowned customer with the account email for a signed-in user', async () => {
    mocks.search.mockResolvedValue({ data: [{ id: 'cus_guest', metadata: {} }] });

    await expect(getOrCreateStripeCustomer({ email: 'a@example.com', userId: 'user-a' })).resolves.toBe('cus_guest');
    expect(mocks.update).toHaveBeenCalledWith('cus_guest', { metadata: { sellf_user_id: 'user-a' } });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-a', stripe_customer_id: 'cus_guest' }),
      expect.anything(),
    );
  });

  it('creates a separate customer when the match belongs to another account (metadata)', async () => {
    mocks.search.mockResolvedValue({ data: [{ id: 'cus_other', metadata: { sellf_user_id: 'user-b' } }] });

    await expect(getOrCreateStripeCustomer({ email: 'b@example.com', userId: 'user-a' })).resolves.toBe('cus_new');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith({ email: 'b@example.com', metadata: { sellf_user_id: 'user-a' } });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-a', stripe_customer_id: 'cus_new' }),
      expect.anything(),
    );
  });

  it('creates a separate customer when the match is mapped to another account', async () => {
    mocks.search.mockResolvedValue({ data: [{ id: 'cus_other', metadata: {} }] });
    mocks.mappingByCustomer = { user_id: 'user-b' };

    await expect(getOrCreateStripeCustomer({ email: 'b@example.com', userId: 'user-a' })).resolves.toBe('cus_new');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('gives a guest a fresh customer when the match belongs to an account', async () => {
    mocks.search.mockResolvedValue({ data: [{ id: 'cus_other', metadata: { sellf_user_id: 'user-b' } }] });

    await expect(getOrCreateStripeCustomer({ email: 'b@example.com' })).resolves.toBe('cus_new');
    expect(mocks.create).toHaveBeenCalledWith({ email: 'b@example.com' });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('gives a guest a fresh customer when the match is mapped to an account', async () => {
    mocks.search.mockResolvedValue({ data: [{ id: 'cus_other', metadata: {} }] });
    mocks.mappingByCustomer = { user_id: 'user-b' };

    await expect(getOrCreateStripeCustomer({ email: 'b@example.com' })).resolves.toBe('cus_new');
  });

  it('reuses an unowned guest customer for a guest', async () => {
    mocks.search.mockResolvedValue({ data: [{ id: 'cus_guest', metadata: {} }] });

    await expect(getOrCreateStripeCustomer({ email: 'g@example.com' })).resolves.toBe('cus_guest');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
