import { describe, expect, it, vi } from 'vitest';
import { backfillBuyerDetails } from '@/lib/payment/buyer-details';

/**
 * Safety net: a paid order always ends up with order_details.buyer, filled from
 * the Stripe session when the checkout form did not store it.
 */

function makeClient(result: { data?: unknown; error?: unknown } | Error) {
  const rpc = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return { data: result.data ?? null, error: result.error ?? null };
  });
  return { rpc } as unknown as Parameters<typeof backfillBuyerDetails>[0] & { rpc: typeof rpc };
}

const METADATA = {
  first_name: 'Anna',
  last_name: 'Nowak',
  full_name: 'Anna Nowak',
  terms_accepted: 'true',
  needs_invoice: 'true',
  nip: '5252248481',
  company_name: 'Nowak Sp. z o.o.',
  address: 'Krótka 2',
  city: 'Kraków',
  postal_code: '30-001',
  country: 'PL',
};

describe('backfillBuyerDetails', () => {
  it('fills a missing buyer from session metadata', async () => {
    const client = makeClient({ data: 1 });

    await backfillBuyerDetails(client, { sessionId: 'cs_test_1', metadata: METADATA, customerDetails: null });

    expect(client.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = (client.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(name).toBe('set_payment_order_buyer');
    expect(args).toMatchObject({ p_session_id: 'cs_test_1', p_only_if_missing: true });
    expect(args.p_buyer).toMatchObject({
      v: 1,
      source: 'stripe_metadata',
      first_name: 'Anna',
      last_name: 'Nowak',
      nip: '5252248481',
      company_name: 'Nowak Sp. z o.o.',
      terms_accepted: true,
      needs_invoice: true,
    });
  });

  it('falls back to Stripe customer_details when the metadata is empty', async () => {
    const client = makeClient({ data: 1 });

    await backfillBuyerDetails(client, {
      sessionId: 'cs_test_2',
      metadata: {},
      customerDetails: {
        name: 'Piotr Zieliński',
        address: { line1: 'Długa 3', city: 'Gdańsk', postal_code: '80-001', country: 'PL' },
      } as never,
    });

    const args = (client.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(args.p_buyer).toMatchObject({
      full_name: 'Piotr Zieliński',
      first_name: 'Piotr',
      last_name: 'Zieliński',
      address: 'Długa 3',
      city: 'Gdańsk',
      postal_code: '80-001',
      country: 'PL',
      source: 'stripe_metadata',
    });
  });

  it('asks the database to leave an existing buyer untouched', async () => {
    const client = makeClient({ data: 0 });

    await expect(
      backfillBuyerDetails(client, { sessionId: 'cs_test_3', metadata: METADATA, customerDetails: null }),
    ).resolves.toBeUndefined();

    const args = (client.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(args.p_only_if_missing).toBe(true);
  });

  it('never throws when the database reports an error', async () => {
    const client = makeClient({ error: { message: 'boom', code: 'XX000' } });

    await expect(
      backfillBuyerDetails(client, { sessionId: 'cs_test_4', metadata: METADATA, customerDetails: null }),
    ).resolves.toBeUndefined();
  });

  it('never throws when the database call throws', async () => {
    const client = makeClient(new Error('network down'));

    await expect(
      backfillBuyerDetails(client, { sessionId: 'cs_test_5', metadata: METADATA, customerDetails: null }),
    ).resolves.toBeUndefined();
  });
});
