import { describe, expect, it, vi } from 'vitest';
import { buyerWebhookCustomerSchema } from '@/lib/webhooks/customer-locale';
import { ShopConfigUpdateDTO } from '@/lib/validations/shop-config';
import { enrichBuyerWebhook } from '@/lib/webhooks/buyer-notifications';
const events = ['purchase.completed', 'license.issued', 'order.placed', 'order.payment_reminder', 'order.cancelled', 'order.participants_needed', 'refund.issued', 'lead.captured', 'waitlist.signup', 'access.expired', 'subscription.created', 'subscription.updated', 'subscription.canceled', 'subscription.trial_ending', 'subscription.renewal_upcoming'];
function database(locale: unknown, shopLocale: string) {
  const from = vi.fn((table: string) => {
    const data = table === 'shop_config' ? { custom_settings: { default_locale: shopLocale } }
      : table === 'issued_licenses' ? { license_key: 'signed.key', sellf_order_id: 'order-1' }
      : table === 'lead_submissions' ? { locale } : { id: 'order-1', metadata: { locale } };
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
      single: async () => ({ data, error: null }), maybeSingle: async () => ({ data, error: null }) };
    return q;
  });
  return { from, rpc: vi.fn(async () => ({ data: false, error: null })) };
}
describe.each(events)('%s buyer language contract', event => {
  it.each([['en', 'pl', 'en'], ['pl', 'en', 'pl'], [undefined, 'pl', 'pl'], [null, 'en', 'en'], ['de', 'pl', 'pl']])('saved %s, shop %s yields %s', async (locale, shopLocale, expected) => {
    const data = { customer: { email: 'buyer@example.com', ...(event === 'waitlist.signup' || event === 'lead.captured' ? { locale } : {}) },
      ...(event === 'license.issued' ? { license: { id: 'license-1', orderId: 'order-1' } }
        : event === 'refund.issued' ? { payment: { id: 'order-1' } }
        : event === 'lead.captured' ? { leadId: 'lead-1' }
        : event.startsWith('subscription.') ? { subscription: { stripeSubscriptionId: 'sub-1' } }
        : event === 'waitlist.signup' || event === 'access.expired' ? {} : { order: { orderId: 'order-1' } }) };
    const wanted = event === 'access.expired' ? shopLocale : expected;
    expect(await enrichBuyerWebhook(event, data, database(locale, shopLocale) as never)).toMatchObject({ customer: { email: 'buyer@example.com', locale: wanted } });
  });
});
it('does not consult another purchase by the same address', async () => {
  const db = database(undefined, 'pl');
  expect(await enrichBuyerWebhook('refund.issued', { customer: { email: 'buyer@example.com', locale: 'en' }, payment: { id: 'old-order' } }, db as never)).toMatchObject({ customer: { locale: 'pl' } });
  expect(db.rpc).not.toHaveBeenCalled();
});
it('keeps events without a customer unchanged', async () => {
  const db = database(undefined, 'pl'), payload = { product: { id: 'p' } };
  expect(await enrichBuyerWebhook('product.created', payload, db as never)).toBe(payload);
  expect(db.from).not.toHaveBeenCalled();
});

it('requires a supported locale in the delivery contract and shop setting', () => {
  expect(buyerWebhookCustomerSchema.safeParse({ email: 'buyer@example.com' }).success).toBe(false);
  expect(buyerWebhookCustomerSchema.safeParse({ locale: 'de' }).success).toBe(false);
  expect(ShopConfigUpdateDTO.safeParse({ custom_settings: { default_locale: 'de' } }).success).toBe(false);
  expect(ShopConfigUpdateDTO.parse({ custom_settings: { default_locale: 'pl', timezone: 'Europe/Warsaw' } })).toEqual({ custom_settings: { default_locale: 'pl', timezone: 'Europe/Warsaw' } });
});
it('resolves a legacy license by its original checkout reference', async () => {
  const db = database('pl', 'en');
  expect(await enrichBuyerWebhook('license.issued', { customer: { email: 'buyer@example.com' }, license: { id: 'license-1', order: 'cs_checkout' } }, db as never)).toMatchObject({ customer: { locale: 'pl' } });
});
it('leaves a failed shop lookup available for retry', async () => {
  const q = { select: () => q, maybeSingle: async () => ({ data: null, error: new Error('unavailable') }) };
  await expect(enrichBuyerWebhook('waitlist.signup', { customer: { email: 'buyer@example.com' } }, { from: () => q } as never)).rejects.toThrow('Shop language unavailable');
});
it('uses the bound subscription language when an invoice has no locale', async () => {
  const db = database(undefined, 'en');
  db.from.mockImplementation((table: string) => {
    const data = table === 'payment_transactions' ? { metadata: {}, subscription_id: 'sub-row' }
      : table === 'subscriptions' ? { metadata: { locale: 'pl' } } : { custom_settings: { default_locale: 'en' } };
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data, error: null }) };
    return q as never;
  });
  expect(await enrichBuyerWebhook('refund.issued', { payment: { id: 'invoice-row' }, customer: { email: 'buyer@example.com' } }, db as never)).toMatchObject({ customer: { locale: 'pl' } });
});
it('resolves a subscription license by its subscription claim', async () => {
  expect(await enrichBuyerWebhook('license.issued', { customer: { email: 'buyer@example.com' }, license: { id: 'license-1', order: 'sub_stripe' } }, database('pl', 'en') as never)).toMatchObject({ customer: { locale: 'pl' } });
});
