import { describe, it, expect, vi } from 'vitest';
import type Stripe from 'stripe';
import { applyBuyerTaxIdentityToCustomer, toEuVatValue } from '@/lib/stripe/buyer-tax-identity';

/**
 * stripe_tax only: pushes the BUYER's tax location + VAT-ID onto the Stripe Customer so
 * automatic_tax computes the right jurisdiction + EU B2B reverse charge. Fail-safe — a
 * bad/duplicate VAT-ID or API error must never throw out of the checkout path.
 */
function fakeStripe(over: {
  listTaxIds?: () => Promise<{ data: Array<{ value: string }> }>;
  createTaxId?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
} = {}) {
  const update = over.update ?? vi.fn(async () => ({}));
  const createTaxId = over.createTaxId ?? vi.fn(async () => ({}));
  const listTaxIds = vi.fn(over.listTaxIds ?? (async () => ({ data: [] })));
  return {
    stripe: { customers: { update, createTaxId, listTaxIds } } as unknown as Stripe,
    update, createTaxId, listTaxIds,
  };
}

describe('toEuVatValue', () => {
  it('prefixes the country code when the number has no alpha prefix', () => {
    expect(toEuVatValue('PL', '1181697228')).toBe('PL1181697228');
    expect(toEuVatValue('de', ' 123 456 789 ')).toBe('DE123456789');
  });
  it('leaves an already-prefixed number as-is (just normalizes case/spaces)', () => {
    expect(toEuVatValue('PL', 'pl1181697228')).toBe('PL1181697228');
    expect(toEuVatValue('DE', 'DE123456789')).toBe('DE123456789');
  });
});

describe('applyBuyerTaxIdentityToCustomer', () => {
  it('sets the buyer address (country is what Stripe Tax needs for jurisdiction)', async () => {
    const { stripe, update } = fakeStripe();
    await applyBuyerTaxIdentityToCustomer({
      stripe, customerId: 'cus_1',
      identity: { country: 'de', address: 'Hauptstr 1', city: 'Berlin', postalCode: '10115', taxId: null },
    });
    expect(update).toHaveBeenCalledWith('cus_1', {
      address: { country: 'DE', line1: 'Hauptstr 1', city: 'Berlin', postal_code: '10115' },
    });
  });

  it('creates an eu_vat tax id (country-prefixed) for an EU buyer with a VAT-ID', async () => {
    const { stripe, createTaxId } = fakeStripe();
    await applyBuyerTaxIdentityToCustomer({
      stripe, customerId: 'cus_1', identity: { country: 'DE', taxId: '123456789' },
    });
    expect(createTaxId).toHaveBeenCalledWith('cus_1', { type: 'eu_vat', value: 'DE123456789' });
  });

  it('is idempotent — skips createTaxId when the same value already exists', async () => {
    const { stripe, createTaxId } = fakeStripe({
      listTaxIds: async () => ({ data: [{ value: 'DE123456789' }] }),
    });
    await applyBuyerTaxIdentityToCustomer({
      stripe, customerId: 'cus_1', identity: { country: 'DE', taxId: 'DE123456789' },
    });
    expect(createTaxId).not.toHaveBeenCalled();
  });

  it('does NOT create a tax id for a non-EU country (no EU reverse charge)', async () => {
    const { stripe, createTaxId, update } = fakeStripe();
    await applyBuyerTaxIdentityToCustomer({
      stripe, customerId: 'cus_1', identity: { country: 'US', taxId: '12-3456789' },
    });
    expect(createTaxId).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled(); // address still set
  });

  it('no taxId → address only, no tax id call', async () => {
    const { stripe, createTaxId, update } = fakeStripe();
    await applyBuyerTaxIdentityToCustomer({ stripe, customerId: 'cus_1', identity: { country: 'PL', taxId: null } });
    expect(createTaxId).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });

  it('FAIL-SAFE: a createTaxId error (e.g. tax_id_invalid) is swallowed, never thrown', async () => {
    const { stripe } = fakeStripe({
      createTaxId: vi.fn(async () => { throw new Error('tax_id_invalid'); }),
    });
    await expect(
      applyBuyerTaxIdentityToCustomer({ stripe, customerId: 'cus_1', identity: { country: 'PL', taxId: 'bad' } }),
    ).resolves.toBeUndefined();
  });

  it('FAIL-SAFE: a customers.update error is swallowed, never thrown', async () => {
    const { stripe } = fakeStripe({ update: vi.fn(async () => { throw new Error('api down'); }) });
    await expect(
      applyBuyerTaxIdentityToCustomer({ stripe, customerId: 'cus_1', identity: { country: 'PL', taxId: null } }),
    ).resolves.toBeUndefined();
  });

  it('no country → no-op (Stripe Tax cannot use an unknown jurisdiction)', async () => {
    const { stripe, update, createTaxId } = fakeStripe();
    await applyBuyerTaxIdentityToCustomer({ stripe, customerId: 'cus_1', identity: { country: null, taxId: '123' } });
    expect(update).not.toHaveBeenCalled();
    expect(createTaxId).not.toHaveBeenCalled();
  });
});
