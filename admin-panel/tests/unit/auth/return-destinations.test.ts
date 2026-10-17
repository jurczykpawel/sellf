/** Return destinations used by the server routes and payment pages. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); }),
}));
vi.mock('next/navigation', () => ({ redirect: state.redirect }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en', getTranslations: async () => (key: string) => key }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user } }) },
  from: () => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: async () => ({ data: { id: 'product-1', slug: 'course', success_redirect_url: '/fallback', pass_params_to_redirect: false }, error: null }) }),
}) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/payment/verify-payment', () => ({
  verifyPaymentSession: async () => ({ status: 'complete', payment_status: 'paid', customer_email: 'buyer@example.com' }),
  verifyPaymentIntent: vi.fn(),
  mapVerifiedPaymentToStatus: () => ({ paymentStatus: 'completed', accessGranted: true, errorMessage: '' }),
}));
vi.mock('@/app/[locale]/p/[slug]/payment-status/components/PaymentStatusView', () => ({ default: () => null }));

import { GET as productAccess } from '@/app/[locale]/auth/product-access/route';
import PaymentSuccessPage from '@/app/payment/success/page';
import PaymentStatusPage from '@/app/[locale]/p/[slug]/payment-status/page';

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://shop.example');
  state.user = null;
  state.redirect.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

const invalidValues = ['/\t/elsewhere.test', '/\n/elsewhere.test', '/\r/elsewhere.test', '/%09/elsewhere.test', '/%250a/elsewhere.test', 'https://shop.example//elsewhere.test/path', '/first/..//elsewhere.test/path'];

it.each(invalidValues)('keeps product access on the product for %j', async value => {
  await expect(productAccess(new Request(`https://shop.example/pl/auth/product-access?product=course&return_url=${encodeURIComponent(value)}`))).rejects.toThrow('NEXT_REDIRECT:/p/course');
  expect(state.redirect).toHaveBeenCalledExactlyOnceWith('/p/course');
});
it('uses the resolved product return path and complete query', async () => {
  const value = 'https://shop.example/first/../thanks?a=1&b=2';
  await expect(productAccess(new Request(`https://shop.example/auth/product-access?product=course&return_url=${encodeURIComponent(value)}`))).rejects.toThrow('NEXT_REDIRECT:/thanks?a=1&b=2');
});

async function paymentSuccess(value: string): Promise<unknown> {
  const page = PaymentSuccessPage({ searchParams: Promise.resolve({ success_url: value, redirect_status: 'succeeded' }) });
  const child = page.props.children;
  return child.type(child.props);
}
it.each(invalidValues)('keeps the generic success page for %j', async value => {
  await paymentSuccess(value);
  expect(state.redirect).not.toHaveBeenCalled();
});
it('uses the resolved payment success path and complete query', async () => {
  await expect(paymentSuccess('https://shop.example/first/../thanks?a=1&b=2')).rejects.toThrow('NEXT_REDIRECT:/thanks?a=1&b=2');
});

it.each(invalidValues)('uses the configured payment-status destination for %j', async value => {
  state.user = { id: 'buyer-1', email: 'buyer@example.com' };
  const page = await PaymentStatusPage({ params: Promise.resolve({ locale: 'pl', slug: 'course' }), searchParams: Promise.resolve({ session_id: 'cs_test_sample', success_url: value }) });
  expect(page.props.redirectUrl).toBe('/fallback');
});
it('uses the resolved payment-status path and complete query', async () => {
  state.user = { id: 'buyer-1', email: 'buyer@example.com' };
  const page = await PaymentStatusPage({ params: Promise.resolve({ locale: 'pl', slug: 'course' }), searchParams: Promise.resolve({ session_id: 'cs_test_sample', success_url: 'https://shop.example/first/../thanks?a=1&b=2' }) });
  expect(page.props.redirectUrl).toBe('/thanks?a=1&b=2');
});
