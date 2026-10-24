/** Real Stripe Customer tax identity checks. @see buyer-tax-identity.ts */
import { test, expect } from '@playwright/test';
import Stripe from 'stripe';
import { applyBuyerTaxIdentityToCustomer } from '@/lib/stripe/buyer-tax-identity';
import { checkoutProfileSchema } from '@/lib/checkout-modules/profile';
import { validateModuleValues } from '@/lib/checkout-modules/registry';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
for (const [country, nip] of [['DE', 'DE000000000'], ['PL', '5252248481']] as const) {
  test(`profile ${country} sends the buyer country and VAT number to Stripe Customer`, async () => {
    const result = validateModuleValues(checkoutProfileSchema.parse({ v: 1, modules: [{ id: 'buyer', types: ['organization'], gus: false }] }),
      { buyer: { type: 'organization', company_name: 'Test Company', country, nip, address: 'Street 1', city: 'City', postal_code: country === 'DE' ? '10115' : '00-001' } },
      { locale: 'en', currency: 'PLN', quantity: 1 });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Invalid profile');
    const buyer = result.details.buyer as { country: string; nip: string };
    const customer = await stripe.customers.create({ name: 'Sellf foreign tax ID test' });
    try {
      await applyBuyerTaxIdentityToCustomer({ stripe, customerId: customer.id, identity: { country: buyer.country, taxId: buyer.nip, address: 'Street 1', city: 'City', postalCode: country === 'DE' ? '10115' : '00-001' } });
      const saved = await stripe.customers.retrieve(customer.id);
      expect(saved.deleted).not.toBe(true);
      if (saved.deleted) throw new Error('Customer was deleted');
      expect(saved.address?.country).toBe(country);
      expect((await stripe.customers.listTaxIds(customer.id)).data).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'eu_vat', value: country === 'PL' ? `PL${nip}` : nip })]));
    } finally { await stripe.customers.del(customer.id); }
  });
}
