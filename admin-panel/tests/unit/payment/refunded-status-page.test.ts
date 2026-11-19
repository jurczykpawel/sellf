import { expect, it, vi } from 'vitest';
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'product', slug: 'product', name: 'Product', price: 100, currency: 'PLN' }, error: null }) }) }) }),
}) }));
vi.mock('@/app/[locale]/p/[slug]/payment-status/components/PaymentStatusView', () => ({ default: () => null }));
vi.mock('@/lib/payment/verify-payment', async original => ({
  ...await original<typeof import('@/lib/payment/verify-payment')>(),
  verifyPaymentSession: async () => ({ session_id: 'cs_test_refunded', status: 'complete', payment_status: 'refunded', access_granted: false }),
}));
import PaymentStatusPage from '@/app/[locale]/p/[slug]/payment-status/page';
it('passes a terminal refund to the buyer view instead of processing', async () => {
  const page = await PaymentStatusPage({ params: Promise.resolve({ locale: 'pl', slug: 'product' }), searchParams: Promise.resolve({ session_id: 'cs_test_refunded' }) });
  expect(page.props.paymentStatus).toBe('refunded');
  expect(page.props.accessGranted).toBe(false);
});
