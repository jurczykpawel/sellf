import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const subscriptionSectionSource = readFileSync(
  resolve(__dirname, '../../src/components/ProductFormModal/sections/SubscriptionSection.tsx'),
  'utf-8'
);

describe('subscription admin UI contract', () => {
  it('exposes only monthly and yearly billing intervals in the admin form', () => {
    expect(subscriptionSectionSource).toContain("value: 'month'");
    expect(subscriptionSectionSource).toContain("value: 'year'");
    expect(subscriptionSectionSource).not.toContain("value: 'day'");
    expect(subscriptionSectionSource).not.toContain("value: 'week'");
  });

  it('lets admins set subscription currency through the product currency field', () => {
    expect(subscriptionSectionSource).toContain('id="subscription_currency"');
    expect(subscriptionSectionSource).toContain('value={formData.currency}');
    expect(subscriptionSectionSource).toContain('currency: e.target.value');
    expect(subscriptionSectionSource).toContain('CURRENCIES.map');
    expect(subscriptionSectionSource).toContain('getCurrencySymbol(formData.currency)');
  });
});
