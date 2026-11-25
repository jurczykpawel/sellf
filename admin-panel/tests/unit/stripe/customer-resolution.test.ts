import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * getOrCreateStripeCustomer resolution rules with Stripe + Supabase mocked.
 * An existing Stripe customer found by email is only reused when no other
 * account holds it (neither via metadata.sellf_user_id nor via a DB mapping).
 */

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  search: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  replace: vi.fn(),
  mappingByUser: null as { stripe_customer_id: string } | null,
  mappingByCustomer: null as { user_id: string } | null,
}));

vi.mock('@/lib/stripe/server', () => ({
  getStripeServer: vi.fn(async () => ({
    customers: { retrieve: mocks.retrieve, search: mocks.search, create: mocks.create, update: mocks.update },
  })),
}));

vi.mock('@/lib/stripe/instance-marker', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/stripe/instance-marker')>(),
  getStripeInstanceId: async () => 'instance-a',
  isForeignStripeMarker: async (marker: string | null) => marker !== null && marker !== 'instance-a',
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: () => {
      let column = '';
      let replacement: unknown;
      const filters: Record<string, string> = {};
      const q = {
        select: () => q,
        eq: (col: string, value: string) => {
          column = col;
          filters[col] = value;
          return q;
        },
        maybeSingle: async () => replacement ? mocks.replace(replacement, filters) : ({
          data: column === 'user_id' ? mocks.mappingByUser : mocks.mappingByCustomer,
          error: null,
        }),
        update: (value: unknown) => {
          replacement = value;
          return q;
        },
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
  mocks.retrieve.mockResolvedValue({ id: 'cus_mapped', metadata: {} });
  mocks.search.mockResolvedValue({ data: [] });
  mocks.create.mockResolvedValue({ id: 'cus_new' });
  mocks.update.mockResolvedValue({});
  mocks.replace.mockResolvedValue({ data: { stripe_customer_id: 'cus_new' }, error: null });
});

describe('getOrCreateStripeCustomer', () => {
  it('returns the stored mapping for a signed-in user', async () => {
    mocks.mappingByUser = { stripe_customer_id: 'cus_mapped' };

    await expect(getOrCreateStripeCustomer({ email: 'a@example.com', userId: 'user-a' })).resolves.toBe('cus_mapped');
    expect(mocks.retrieve).toHaveBeenCalledWith('cus_mapped');
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it.each(['missing', 'deleted', 'other installation', 'other account'])('replaces a mapped customer that is %s', async (reason) => {
    mocks.mappingByUser = { stripe_customer_id: 'cus_mapped' };
    if (reason === 'missing') mocks.retrieve.mockRejectedValueOnce({ statusCode: 404, code: 'resource_missing' });
    if (reason === 'deleted') mocks.retrieve.mockResolvedValueOnce({ id: 'cus_mapped', deleted: true });
    if (reason === 'other installation') {
      mocks.retrieve.mockResolvedValueOnce({ id: 'cus_mapped', metadata: { sellf_instance: 'instance-b' } });
    }
    if (reason === 'other account') {
      mocks.retrieve.mockResolvedValueOnce({ id: 'cus_mapped', metadata: { sellf_user_id: 'user-b' } });
    }

    await expect(getOrCreateStripeCustomer({ email: 'a@example.com', userId: 'user-a' })).resolves.toBe('cus_new');
    expect(mocks.create).toHaveBeenCalledWith(
      { email: 'a@example.com', metadata: { sellf_user_id: 'user-a', sellf_instance: 'instance-a' } },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(mocks.replace).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_customer_id: 'cus_new' }),
      { user_id: 'user-a', stripe_customer_id: 'cus_mapped' },
    );
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it.each([403, 429, 500])('preserves the mapping when Stripe fails with HTTP %i', async (statusCode) => {
    const error = Object.assign(new Error('Stripe request failed'), { statusCode });
    mocks.mappingByUser = { stripe_customer_id: 'cus_mapped' };
    mocks.retrieve.mockRejectedValueOnce(error);

    await expect(getOrCreateStripeCustomer({ email: 'a@example.com', userId: 'user-a' })).rejects.toBe(error);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('returns the verified mapping when another request has already replaced it', async () => {
    mocks.mappingByUser = { stripe_customer_id: 'cus_mapped' };
    mocks.retrieve.mockRejectedValueOnce({ statusCode: 404, code: 'resource_missing' })
      .mockResolvedValueOnce({ id: 'cus_winner', metadata: { sellf_user_id: 'user-a', sellf_instance: 'instance-a' } });
    mocks.replace.mockImplementationOnce(async () => {
      mocks.mappingByUser = { stripe_customer_id: 'cus_winner' };
      return { data: null, error: null };
    });

    await expect(getOrCreateStripeCustomer({ email: 'a@example.com', userId: 'user-a' })).resolves.toBe('cus_winner');
    expect(mocks.retrieve).toHaveBeenLastCalledWith('cus_winner');
  });

  it('adopts an unowned customer with the account email for a signed-in user', async () => {
    mocks.search.mockResolvedValue({ data: [{ id: 'cus_guest', metadata: {} }] });

    await expect(getOrCreateStripeCustomer({ email: 'a@example.com', userId: 'user-a' })).resolves.toBe('cus_guest');
    expect(mocks.update).toHaveBeenCalledWith('cus_guest', { metadata: { sellf_user_id: 'user-a', sellf_instance: 'instance-a' } });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-a', stripe_customer_id: 'cus_guest' }),
      expect.anything(),
    );
  });

  it('creates a separate customer when the match belongs to another account (metadata)', async () => {
    mocks.search.mockResolvedValue({ data: [{ id: 'cus_other', metadata: { sellf_user_id: 'user-b' } }] });

    await expect(getOrCreateStripeCustomer({ email: 'b@example.com', userId: 'user-a' })).resolves.toBe('cus_new');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith({ email: 'b@example.com', metadata: { sellf_user_id: 'user-a', sellf_instance: 'instance-a' } });
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
    expect(mocks.create).toHaveBeenCalledWith({ email: 'b@example.com', metadata: { sellf_instance: 'instance-a' } });
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

  it('keeps an email match from a different installation separate', async () => {
    mocks.search.mockResolvedValue({ data: [{ id: 'cus_other', metadata: { sellf_instance: 'instance-b' } }] });

    await expect(getOrCreateStripeCustomer({ email: 'a@example.com' })).resolves.toBe('cus_new');
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
