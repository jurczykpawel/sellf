import { beforeEach, expect, it, vi } from 'vitest';
const create = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/stripe/server', () => ({ getStripeServer: vi.fn() }));
vi.mock('@/lib/stripe/checkout-config', () => ({ getCheckoutConfig: async () => ({ tax_mode: 'local', expires_hours: 24, paymentMethodMode: 'automatic', automatic_tax: { enabled: false }, tax_id_collection: { enabled: false }, billing_address_collection: 'auto' }) }));
vi.mock('@/lib/stripe/tax-rate-manager', () => ({ getOrCreateStripeTaxRate: vi.fn(), resolveLocalSubscriptionTaxRateId: vi.fn() }));
import { CheckoutService } from '@/lib/services/checkout';
import { buildEmbedReturnUrl } from '@/lib/embed/checkout-embed';
import type { CheckoutSessionOptions } from '@/types/checkout';
beforeEach(() => { create.mockReset(); create.mockResolvedValue({ id: 'cs_test', client_secret: 'secret' }); });
it.each(['pl', 'en'] as const)('keeps %s on the return page and in fulfillment metadata', async locale => {
  process.env.SITE_URL = 'https://sellf.example.com';
  const service = new CheckoutService();
  Object.assign(service, { stripe: { checkout: { sessions: { create } } } });
  await service.createStripeSession({ product: { id: 'product', slug: 'book', name: 'Book', price: 10, currency: 'PLN', product_type: 'one_time' }, locale, returnUrl: buildEmbedReturnUrl('book', locale) } as CheckoutSessionOptions);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ locale, metadata: expect.objectContaining({ locale }), return_url: `https://sellf.example.com/${locale}/p/book/payment-status?session_id={CHECKOUT_SESSION_ID}` }));
});
