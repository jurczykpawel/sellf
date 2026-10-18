import { describe, expect, it } from 'vitest';
import { headerPriceBadge } from '@/components/ProductFormModal/wizard/header-price-badge';

const base = {
  price: 0,
  currency: 'PLN',
  product_type: 'one_time' as const,
  recurring_price: null,
  billing_interval: 'month' as const,
  billing_interval_count: 1,
  allow_custom_price: false,
};

describe('headerPriceBadge', () => {
  it('does not call a subscription free', () => {
    const badge = headerPriceBadge({ ...base, product_type: 'subscription', recurring_price: 49 }, '0', 'Free', 'en');
    expect(badge?.free).toBe(false);
    expect(badge?.label).toContain('49');
  });

  it('shows no badge for a subscription without a recurring price yet', () => {
    expect(headerPriceBadge({ ...base, product_type: 'subscription' }, '0', 'Free', 'en')).toBeNull();
  });

  it('labels a genuinely free product', () => {
    expect(headerPriceBadge(base, '0', 'Free', 'en')).toEqual({ label: 'Free', free: true });
  });

  it('shows no badge for pay-what-you-want with a zero suggested price', () => {
    expect(headerPriceBadge({ ...base, allow_custom_price: true }, '0', 'Free', 'en')).toBeNull();
  });

  it('formats a paid price', () => {
    expect(headerPriceBadge({ ...base, price: 100 }, '100', 'Free', 'en')?.free).toBe(false);
  });
});
