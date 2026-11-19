import { expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  sessions: { retrieve: vi.fn(async () => ({ payment_intent: null })), listLineItems: vi.fn(async () => ({ data: [{ price: { id: 'price_inline', active: false, product: 'prod_inline' } }] })) },
  prices: { update: vi.fn() }, products: { update: vi.fn() },
}));
vi.mock('stripe', () => ({ default: class { checkout = { sessions: api.sessions }; prices = api.prices; products = api.products; } }));
import { clearPaidCheckout } from '../../helpers/stripe-test-events';
it('cleans up an inline checkout product without updating its already inactive price', async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  try {
    await clearPaidCheckout('cs_test_fixture');
    expect(api.prices.update).not.toHaveBeenCalled();
    expect(api.products.update).toHaveBeenCalledWith('prod_inline', { active: false });
  } finally { vi.unstubAllEnvs(); }
});
