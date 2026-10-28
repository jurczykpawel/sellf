/** The first subscription receipt reaches the buyer before the offer redirect. */
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import recorded from '../../fixtures/stripe/initial-subscription-purchase.json';
import { waitForEmail } from '../../helpers/mailpit';

const state = vi.hoisted(() => ({ email: '', productId: '', slug: '', sessionId: '' }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('@/lib/supabase/server', async () => {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  return { createClient: async () => {
    const db = createAdminClient();
    db.auth.getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
    return db;
  } };
});
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimitForIdentifier: async () => true }));
vi.mock('@/lib/payment/verify-payment', async original => {
  const actual = await original<typeof import('@/lib/payment/verify-payment')>();
  return { ...actual, verifyPaymentSession: async () => ({
    session_id: state.sessionId, status: recorded.checkout.status, payment_status: recorded.checkout.payment_status,
    customer_email: state.email, scenario: 'subscription_guest', is_guest_purchase: true,
    send_magic_link: true, requires_login: true, oto_info: { has_oto: true, oto_product_slug: 'next-workshop' },
  }) };
});
vi.mock('@/lib/embed/checkout-embed', () => ({ getSellfBaseUrl: () => process.env.SITE_URL }));
vi.mock('@/lib/utils/canonical-url', () => ({ getPublicBaseUrl: () => process.env.SITE_URL }));
vi.mock('@/app/[locale]/p/[slug]/payment-status/components/PaymentStatusView', () => ({ default: () => null }));

import PaymentStatusPage from '@/app/[locale]/p/[slug]/payment-status/page';

it('includes the paid invoice product and amount in the first pre-offer subscription email', async () => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  state.email = `pre-offer-${crypto.randomUUID()}@example.com`;
  state.slug = `pre-offer-${crypto.randomUUID()}`;
  state.sessionId = `cs_test_${crypto.randomUUID().replaceAll('-', '')}`;
  const product = await db.from('products').insert({ name: 'Subscription workshop', slug: state.slug, price: recorded.invoice.amount_paid / 100, currency: recorded.invoice.currency.toUpperCase(), is_active: true }).select('id').single();
  expect(product.error).toBeNull();
  state.productId = product.data!.id;
  try {
    const tx = await db.from('payment_transactions').insert({ product_id: state.productId, session_id: `in_${crypto.randomUUID().replaceAll('-', '')}`, customer_email: state.email, amount: recorded.invoice.amount_paid, currency: recorded.invoice.currency.toUpperCase(), status: 'completed' }).select('id').single();
    expect(tx.error).toBeNull();
    expect((await db.from('guest_purchases').insert({ product_id: state.productId, customer_email: state.email, transaction_id: tx.data!.id, transaction_amount: recorded.invoice.amount_paid })).error).toBeNull();
    await expect(PaymentStatusPage({ params: Promise.resolve({ locale: 'pl', slug: state.slug }), searchParams: Promise.resolve({ session_id: state.sessionId }) })).rejects.toThrow('redirect:');
    const mail = await waitForEmail(state.email, { timeout: 1500 });
    expect(mail.Subject).toBe('Potwierdź swój email');
    expect(mail.HTML).toContain('Subscription workshop');
    expect(mail.HTML).toContain('11,00\u00a0zł');
  } finally {
    const user = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === state.email);
    if (user) await db.auth.admin.deleteUser(user.id);
    await db.from('guest_purchases').delete().eq('product_id', state.productId);
    await db.from('payment_transactions').delete().eq('product_id', state.productId);
    await db.from('products').delete().eq('id', state.productId);
  }
});
