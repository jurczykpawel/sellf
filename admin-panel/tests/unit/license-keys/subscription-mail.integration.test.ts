import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
useSupabaseBuyerEmails();
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import recordedSub from '../../fixtures/stripe/subscription_before_cancel.json';
import recordedInvoice from '../../fixtures/stripe/invoice_paid_cycle.json';
import { handleInvoicePaid } from '@/app/api/webhooks/stripe/subscription-handlers';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { waitForEmail, searchMessages, extractMagicLink } from '../../helpers/mailpit';

vi.mock('@/lib/license/resolve', () => ({ checkFeature: async () => true }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, checkRateLimitForIdentifier: async () => true }));

it.each([['pl', false], ['pl', true], ['en', false], ['en', true]] as const)('delivers a subscription invoice license in %s with confirmed=%s', async (locale, confirmed) => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `invoice-license-${crypto.randomUUID()}@example.com`;
  const owner = await db.auth.admin.createUser({ email:`owner-${email}`, email_confirm:true }); expect(owner.error).toBeNull();
  const buyer = await db.auth.admin.createUser({ email, email_confirm:confirmed }); expect(buyer.error).toBeNull();
  const seller = owner.data.user!.id, uid = buyer.data.user!.id, product = crypto.randomUUID();
  const sub = { ...recordedSub, id: `sub_${crypto.randomUUID()}`, metadata: { product_id: product, locale } } as unknown as Stripe.Subscription;
  const invoice = { ...recordedInvoice.data.object, id: `in_${crypto.randomUUID().replaceAll('-', '')}`, parent: { ...recordedInvoice.data.object.parent, subscription_details: { ...recordedInvoice.data.object.parent.subscription_details, subscription: sub.id } },
    customer_email: locale === 'en' ? email.toUpperCase() : email, customer: sub.customer, amount_paid:1100, currency:'pln', payments: { data: [], has_more:false } } as unknown as Stripe.Invoice;
  const stripe = { subscriptions:{ retrieve:async()=>sub }, customers:{ retrieve:async()=>({ email }) }, checkout:{ sessions:{ list:async()=>({data:[]}) } } } as unknown as Stripe;
  try {
    await storeSellerKey(db, { sellerId:seller, ...generateSellerKeypair(), custody:'managed' });
    expect((await db.from('products').insert({ id:product, name:'Invoice workshop', slug:`invoice-${product}`, price:0, currency:'PLN',
      product_type:'subscription', recurring_price:11, billing_interval:'month', billing_interval_count:1,
      stripe_price_id:recordedSub.items.data[0].price.id, seller_id:seller, issue_license_on_purchase:true })).error).toBeNull();
    const result = await handleInvoicePaid(invoice, db, db, stripe); expect(result, result.message).toMatchObject({processed:true});
    const saved = await db.from('issued_licenses').select('license_key,email').eq('product_id',product).single(); expect(saved.error).toBeNull();
    expect(saved.data!.email).toBe(email);
    const mail = await waitForEmail(email, { timeout:3000 });
    expect(mail.Subject).toBe(locale === 'pl' ? 'Twój klucz licencyjny: Invoice workshop' : 'Your license key: Invoice workshop');
    expect(mail.HTML).toContain(saved.data!.license_key);
    const link = new URL(extractMagicLink(mail.HTML!)!);
    const buyerClient = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {auth:{persistSession:false,autoRefreshToken:false}});
    const verified = await buyerClient.auth.verifyOtp({token_hash:link.searchParams.get('token_hash')!,type:link.searchParams.get('type') as 'signup' | 'magiclink'});
    expect(verified.error).toBeNull(); expect(verified.data.user?.id).toBe(uid);
    expect((await handleInvoicePaid(invoice, db, db, stripe)).processed).toBe(true);
    expect(await searchMessages(email)).toHaveLength(1);
  } finally {
    await db.from('issued_licenses').delete().eq('product_id',product);
    await db.from('user_product_access').delete().eq('product_id',product);
    await db.from('payment_transactions').delete().eq('product_id',product);
    await db.from('subscriptions').delete().eq('product_id',product);
    await db.from('products').delete().eq('id',product);
    await db.from('seller_license_keys').delete().eq('original_seller_id',seller);
    await db.auth.admin.deleteUser(uid); await db.auth.admin.deleteUser(seller);
  }
});
