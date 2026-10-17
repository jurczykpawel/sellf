/** Payment mode resolution used by affiliate accounting. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const config = vi.hoisted(() => ({ key: vi.fn() }));
vi.mock('@/lib/stripe/internal-config', () => ({ getDecryptedStripeKeyInternal: config.key }));
import { getAffiliateLivemode } from '@/lib/stripe/affiliate-mode';
beforeEach(() => config.key.mockResolvedValue(null));
afterEach(() => vi.unstubAllEnvs());
it.each([['sk_test_sample', false], ['rk_test_sample', false], ['sk_live_sample', true], ['rk_live_sample', true]] as const)('uses configured key mode %s', async (key, live) => {
  vi.stubEnv('STRIPE_SECRET_KEY', key); vi.stubEnv('NODE_ENV', 'production');
  expect(await getAffiliateLivemode()).toBe(live);
  expect(config.key).toHaveBeenCalledWith(live ? 'live' : 'test');
});
it('uses the database key that checkout prefers', async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_sample'); config.key.mockResolvedValue('rk_live_database');
  expect(await getAffiliateLivemode()).toBe(true);
});
it('does not assume a payable mode without a valid configuration', async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', '');
  await expect(getAffiliateLivemode()).rejects.toThrow('Stripe configuration unavailable');
});
