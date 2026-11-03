/** Checkout endpoints hand the validated payload to the database without ever failing the checkout. */
import { describe, expect, it, vi } from 'vitest';
import { storeCheckoutAttribution, recordFreeAttribution, attributionRequestContext, freeAttributionRef, claimFreeAttribution } from '@/lib/attribution/store';

function fakeDb(error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ error });
  return { rpc } as unknown as Parameters<typeof storeCheckoutAttribution>[0] & { rpc: typeof rpc };
}
const ctx = { userAgent: 'Mozilla/5.0 (iPhone) Mobile', country: 'PL' };
const raw = { v: 1, consent: 'none', mode: 'url', last: { source: 'Listmonk', medium: 'email', campaign: 'mail-05' } };

describe('storeCheckoutAttribution', () => {
  it('stores the normalized payload under every checkout reference', async () => {
    const db = fakeDb();
    await storeCheckoutAttribution(db, ['cs_test_1', 'f0f0f0f0-0000-4000-a000-000000000001', null, undefined], raw, ctx);
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenCalledWith('store_checkout_attribution', expect.objectContaining({
      p_ref: 'cs_test_1',
      p_payload: expect.objectContaining({ last: expect.objectContaining({ source: 'listmonk', campaign: 'mail-05' }), device_class: 'mobile', country: 'PL' }),
    }));
  });

  it('swallows database errors so a payment is never blocked by attribution', async () => {
    const db = fakeDb({ message: 'boom' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(storeCheckoutAttribution(db, ['cs_test_2'], raw, ctx)).resolves.toBeUndefined();
    await expect(recordFreeAttribution(db, 'p', 'u', raw, ctx)).resolves.toBeUndefined();
    err.mockRestore();
  });

  it('reads device and country from the request, preferring the CDN country header', () => {
    const headers = new Headers({ 'user-agent': 'UA', 'cf-ipcountry': 'de', 'x-vercel-ip-country': 'FR' });
    expect(attributionRequestContext(headers)).toEqual({ userAgent: 'UA', country: 'de' });
    expect(attributionRequestContext(new Headers({ 'x-vercel-ip-country': 'FR' }))).toEqual({ userAgent: null, country: 'FR' });
  });

  it('links a guest free signup (magic link) to the later grant without storing the email', async () => {
    const ref = freeAttributionRef('free-guide', ' Buyer@Example.com ');
    expect(ref).toBe(freeAttributionRef('free-guide', 'buyer@example.com'));
    expect(ref).toMatch(/^free:free-guide:[0-9a-f]{64}$/);
    expect(ref).not.toContain('buyer');
    const db = fakeDb();
    await claimFreeAttribution(db, 'product-1', 'user-1', 'free-guide', 'buyer@example.com');
    expect(db.rpc).toHaveBeenCalledWith('record_free_attribution_from_ref', { p_product: 'product-1', p_user: 'user-1', p_ref: ref });
  });
});
