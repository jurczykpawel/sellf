/** An in-flight guest payment is fulfilled even if the offer leaves the catalogue. */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ buyer: null as unknown, result: {} as Record<string, unknown> }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.buyer }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('@/lib/payment/verify-payment', async original => ({ ...await original<typeof import('@/lib/payment/verify-payment')>(), verifyPaymentSession: async () => state.result }));
vi.mock('@/app/[locale]/p/[slug]/payment-status/components/PaymentStatusView', () => ({ default: () => null }));
import PaymentStatusPage from '@/app/[locale]/p/[slug]/payment-status/page';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<T> { if (error) throw error; return data; }
it.each(['inactive', 'archived'] as const)('finishes the guest receipt and claim for an %s paid product @J185', async mode => {
  const id = randomUUID(), email = `inflight-${id}@example.com`, session = `cs_${id.replaceAll('-', '')}`;
  const product = (await checked(await db.from('products').insert({ name: 'Paid course', slug: `paid-${id}`, price: 20, currency: 'PLN', is_active: true }).select('id,slug').single()))!;
  let userId: string | undefined;
  try {
    await checked(await db.from('payment_transactions').insert({ product_id: product.id, customer_email: email, session_id: session, amount: 2000, currency: 'PLN', status: 'pending' }));
    await checked(await db.from('products').update({ is_active: false, ...(mode === 'archived' ? { archived_at: new Date().toISOString() } : {}) }).eq('id', product.id));
    const paid = await checked(await db.rpc('process_stripe_payment_completion_with_bump', { session_id_param: session, product_id_param: product.id, customer_email_param: email, amount_total: 2000, currency_param: 'PLN', allow_inactive_product_param: true }));
    expect(paid.success).toBe(true);
    const anonymous = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!); state.buyer = anonymous;
    state.result = { session_id: session, status: 'complete', payment_status: 'paid', customer_email: email, is_guest_purchase: true, send_magic_link: true, metadata: { product_id: product.id } };
    const view = await PaymentStatusPage({ params: Promise.resolve({ locale: 'pl', slug: product.slug }), searchParams: Promise.resolve({ session_id: session }) });
    expect(view.props).toMatchObject({ product: { id: product.id }, paymentStatus: 'magic_link_sent', customerEmail: email });
    const buyer = (await checked(await db.auth.admin.createUser({ email, password: `Password-${id}!`, email_confirm: true }))).user!; userId = buyer.id;
    expect(await checked(await db.from('user_product_access').select('product_id').eq('user_id', buyer.id))).toEqual([{ product_id: product.id }]);
    const owner = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
    await checked(await owner.auth.signInWithPassword({ email, password: `Password-${id}!` }));
    expect(await checked(await owner.from('products').select('id').eq('id', product.id))).toEqual([{ id: product.id }]);
    expect(await checked(await anonymous.from('products').select('id').eq('id', product.id))).toEqual([]);
  } finally {
    await db.from('guest_purchases').delete().eq('product_id', product.id);
    await db.from('payment_transactions').delete().eq('product_id', product.id);
    if (userId) await db.auth.admin.deleteUser(userId);
    await db.from('products').delete().eq('id', product.id);
  }
});
