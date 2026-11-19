/** Real sandbox payment reaches its buyer after the offer is withdrawn. */
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { verifyPaymentIntent } from '@/lib/payment/verify-payment';
import { stripeInstanceMetadata } from '@/lib/stripe/instance-marker';
import { requestMagicLink } from '@/lib/auth/magic-link/request';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';
import { extractMagicLink, waitForEmail } from '../helpers/mailpit';
import { useSupabaseBuyerEmails } from '../helpers/buyer-email-setting';
vi.mock('@/lib/captcha/verify', () => ({ verifyCaptchaToken: async () => ({ success: true }) }));
vi.mock('@/lib/actions/validate-email', () => ({ validateEmailAction: async () => ({ isValid: true }) }));
vi.mock('@/lib/services/product-validation', () => ({ ProductValidationService: { validateEmail: async () => true } }));
useSupabaseBuyerEmails();
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<T> { if (error) throw error; return data; }
it('confirms a real paid intent before its webhook, sends the first mail and claims withdrawn content @J185', async () => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const id = randomUUID(), email = `withdrawn-sandbox-${id}@example.com`;
  const product = (await checked(await db.from('products').insert({ name: 'Paid sandbox course', slug: `paid-sandbox-${id}`, price: 20, currency: 'PLN', is_active: true }).select('id,slug').single()))!;
  let payment: Stripe.PaymentIntent | undefined, userId: string | undefined;
  try {
    payment = await stripe.paymentIntents.create({ amount: 2000, currency: 'pln', receipt_email: email, payment_method: 'pm_card_visa', confirm: true, automatic_payment_methods: { enabled: true, allow_redirects: 'never' }, metadata: { ...await stripeInstanceMetadata(), product_id: product.id, locale: 'pl' } });
    expect(payment.livemode).toBe(false); expect(payment.status).toBe('succeeded');
    await checked(await db.from('payment_transactions').insert({ product_id: product.id, customer_email: email, amount: 2000, currency: 'PLN', session_id: payment.id, stripe_payment_intent_id: payment.id, status: 'pending' }));
    await checked(await db.from('products').update({ is_active: false }).eq('id', product.id));
    const verified = await verifyPaymentIntent(payment.id);
    expect(verified.error).toBeUndefined(); expect(verified.is_guest_purchase).toBe(true);
    expect(await requestMagicLink({ email, productSlug: product.slug, locale: 'pl', flow: 'post_checkout', captchaToken: 'test-boundary' })).toEqual({ ok: true });
    const mail = await waitForEmail(email);
    expect(mail.HTML).toContain('Paid sandbox course'); expect(mail.HTML).toContain('20,00');
    const link = new URL(extractMagicLink(mail.HTML!)!);
    const buyer = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
    const confirmed = await checked(await buyer.auth.verifyOtp({ token_hash: link.searchParams.get('token_hash')!, type: link.searchParams.get('type') as 'signup' | 'magiclink' }));
    userId = confirmed.user!.id;
    expect(await checked(await buyer.from('user_product_access').select('product_id').eq('user_id', userId))).toEqual([{ product_id: product.id }]);
    expect(await checked(await buyer.from('products').select('id').eq('id', product.id))).toEqual([{ id: product.id }]);
    const refund = await stripe.refunds.create({ payment_intent: payment.id }); expect(refund.status).toBe('succeeded');
    const tx = (await checked(await db.from('payment_transactions').update({ status: 'refunded', refunded_amount: 2000 }).eq('session_id', payment.id).select('id').single()))!;
    expect((await revokeTransactionAccess(db, { transactionId: tx.id, userId, productId: product.id, sessionId: payment.id })).success).toBe(true);
    expect(await checked(await buyer.from('user_product_access').select('product_id').eq('user_id', userId))).toEqual([]);
  } finally {
    if (payment) {
      const refunds = await stripe.refunds.list({ payment_intent: payment.id });
      if (!refunds.data.some(refund => refund.status === 'succeeded')) await stripe.refunds.create({ payment_intent: payment.id });
    }
    await db.from('guest_purchases').delete().eq('product_id', product.id);
    await db.from('payment_transactions').delete().eq('product_id', product.id);
    if (userId) await db.auth.admin.deleteUser(userId);
    await db.from('products').delete().eq('id', product.id);
  }
}, 60000);
