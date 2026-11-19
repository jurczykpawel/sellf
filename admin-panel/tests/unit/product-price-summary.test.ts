import { expect, it } from 'vitest';
import { buyerSummaryParts } from '@/components/ProductFormModal/wizard/buyer-summary';
import { headerPriceBadge } from '@/components/ProductFormModal/wizard/header-price-badge';
import { initialFormData } from '@/components/ProductFormModal/types';
it.each(['en', 'pl'])('does not promise free access for an invalid JPY amount (%s)', locale => {
  const form = { ...initialFormData, currency: 'JPY', price: 0 };
  expect(buyerSummaryParts(form, null, '1000.5', locale).access.payment).toBe('invalid');
  expect(headerPriceBadge(form, '1000.5', 'Free', locale)).toBeNull();
  expect(buyerSummaryParts(form, null, '0', locale).access.payment).toBe('free');
});
