import { beforeEach, expect, it, vi } from 'vitest';
const send = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/magic-link/request', () => ({ sendTrustedMagicLink: send }));
vi.mock('@/lib/embed/checkout-embed', () => ({ getSellfBaseUrl: () => 'https://shop.example.com' }));
import { mailOrderLicenses } from '@/lib/license-keys/license-mail';
beforeEach(() => { send.mockReset().mockResolvedValue({ ok: true }); });
it('delivers all order keys in one buyer email', async () => {
  const db = { from: () => ({ select: () => ({ in: async () => ({ data: [
    { id: 'a', slug: 'a', name: 'First' }, { id: 'b', slug: 'b', name: 'Second' },
  ] }) }) }), rpc: vi.fn().mockResolvedValue({ error: null, data: 'retry-id' }) };
  await mailOrderLicenses(db as never, { email: 'buyer@example.com', userId: null, licenses: [
    { productId: 'a', token: 'first.signature' }, { productId: 'b', token: 'second.signature' },
  ] });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0].data.license_keys).toEqual({ 'First (a)': 'first.signature', 'Second (b)': 'second.signature' });
  expect(db.rpc).toHaveBeenLastCalledWith('prepare_event_mail', expect.objectContaining({ p_data: { locale: 'en' } }));
});
