/** Buyer locale in checkout returns. @see lib/checkout/return-url.ts */
import { expect, it } from 'vitest';
import { buildCheckoutReturnUrl } from '@/lib/checkout/return-url';
it.each(['en', 'pl'])('retains %s in the Stripe return URL', locale => {
  const result = buildCheckoutReturnUrl({ origin: 'https://shop.example', productId: 'product', productSlug: 'course', locale });
  const url = new URL(result);
  expect(url.searchParams.get('locale')).toBe(locale);
  expect(url.searchParams.get('product')).toBe('course');
  expect(result).toContain('session_id={CHECKOUT_SESSION_ID}');
});
it('uses English for an unsupported locale and preserves the configured destination', () => {
  const url = new URL(buildCheckoutReturnUrl({ origin: 'https://shop.example', productId: 'product', productSlug: 'course', locale: '//other.example', successUrl: '/my-products' }));
  expect(url.origin).toBe('https://shop.example');
  expect(url.searchParams.get('locale')).toBe('en');
  expect(url.searchParams.get('success_url')).toBe('/my-products');
});

it('keeps the buyer locale when a product redirects to checkout', async () => {
  const { checkoutUrl } = await import('@/lib/utils/product-urls');
  expect(checkoutUrl('course', 'pl')).toBe('/pl/checkout/course');
  expect(checkoutUrl('course')).toBe('/checkout/course');
});
