import { expect, it, vi } from 'vitest';
import { enrichBuyerWebhook } from '@/lib/webhooks/buyer-notifications';
it('delivers the key only with license.issued, without changing the other license events', async () => {
 const single = vi.fn(async () => ({ data: { license_key: 'signed.key' }, error: null }));
 const q = { select: vi.fn(() => q), eq: vi.fn(() => q), single };
 const db = { from: vi.fn(() => q) };
 const data = { license: { id: 'license-1', expiresAt: '2027-01-01' }, customer: { email: 'buyer@example.com', locale: 'en' } };
 expect(await enrichBuyerWebhook('license.issued', data, db as never)).toEqual({ ...data, licenseKey: 'signed.key' });
 expect(await enrichBuyerWebhook('license.revoked', data, db as never)).toEqual(data);
 expect(single).toHaveBeenCalledOnce();
});
it('does not consume an issued notification without its delivery key', async () => {
 const q = { select: () => q, eq: () => q, single: async () => ({ data: null, error: {} }) };
 await expect(enrichBuyerWebhook('license.issued', { license: { id: 'l' } }, { from: () => q } as never)).rejects.toThrow();
});
