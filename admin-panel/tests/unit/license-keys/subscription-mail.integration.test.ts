import { execFileSync } from 'node:child_process';
import { getTestDatabaseContainer } from '../../helpers/database-container';
import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
useSupabaseBuyerEmails();
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import recordedTrial from '../../fixtures/stripe/trial-first-mail-invoice.json';
import recordedCheckout from '../../fixtures/stripe/initial-subscription-purchase.json';
import { PREDEFINED_CUSTOM_FIELDS } from '@/lib/validations/custom-checkout-fields';
import recordedSub from '../../fixtures/stripe/subscription_before_cancel.json';
import recordedInvoice from '../../fixtures/stripe/invoice_paid_cycle.json';
import { handleInvoicePaid } from '@/app/api/webhooks/stripe/subscription-handlers';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { waitForEmail, searchMessages, extractMagicLink } from '../../helpers/mailpit';

vi.mock('@/lib/license/resolve', () => ({ checkFeature: async () => true }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, checkRateLimitForIdentifier: async () => true }));

it.each([['pl', false, false, false, 'none'], ['pl', true, false, false, 'none'], ['en', false, false, false, 'none'], ['en', true, false, false, 'none'], ['en', true, true, false, 'none'], ['en', true, false, true, 'none'], ['en', true, false, true, 'empty'], ['en', true, false, true, 'filled'], ['pl', false, false, true, 'none']] as const)('delivers a subscription invoice license in %s with confirmed=%s trial=%s legacy=%s stale=%s', async (locale, confirmed, trial, legacy, stale) => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `invoice-license-${crypto.randomUUID()}@example.com`;
  const owner = await db.auth.admin.createUser({ email:`owner-${email}`, email_confirm:true }); expect(owner.error).toBeNull();
  const buyer = await db.auth.admin.createUser({ email, email_confirm:confirmed }); expect(buyer.error).toBeNull();
  const seller = owner.data.user!.id, uid = buyer.data.user!.id, product = crypto.randomUUID();
  const amount = trial ? recordedTrial.data.object.amount_paid : 1100;
  const sub = { ...recordedSub, ...(trial ? {status:'trialing',trial_end:Math.floor(Date.now()/1000)+604800} : {}), id: `sub_${crypto.randomUUID()}`, metadata: { product_id: product, locale, ...(trial || legacy ? {sf_attr_ref:crypto.randomUUID()} : {}) } } as unknown as Stripe.Subscription;
  const invoice = { ...recordedInvoice.data.object, id: `in_${crypto.randomUUID().replaceAll('-', '')}`, parent: { ...recordedInvoice.data.object.parent, subscription_details: { ...recordedInvoice.data.object.parent.subscription_details, subscription: sub.id } },
    customer_email: locale === 'en' ? email.toUpperCase() : email, customer: sub.customer, amount_paid:amount, currency:'pln', payments: { data: [], has_more:false } } as unknown as Stripe.Invoice;
  const checkout = {...recordedCheckout.checkout,id:`cs_test_${crypto.randomUUID().replaceAll('-','')}`,metadata:{},customer_details:null};
  const domain='invoice-license.example.com';
  const expectedDomain=stale==='filled'?'locked.example.com':domain;
  let earlyHistory: unknown;
  let sessionVisible = !legacy;
  const stripe = { subscriptions:{ retrieve:async()=>sub }, customers:{ retrieve:async()=>({ email }) }, checkout:{ sessions:{ list:async()=>{
    if(legacy&&!sessionVisible){const stored=await db.from('subscriptions').select('id').eq('stripe_subscription_id',sub.id).single();expect(stored.error).toBeNull();earlyHistory=await db.from('payment_transactions').select('custom_field_values, fulfillment_pending').eq('subscription_id',stored.data!.id).order('created_at',{ascending:true}).limit(1).maybeSingle();}
    return {data:(confirmed||legacy)&&sessionVisible?[checkout]:[]};
  } } } } as unknown as Stripe;
  try {
    await storeSellerKey(db, { sellerId:seller, ...generateSellerKeypair(), custody:'managed' });
    expect((await db.from('products').insert({ id:product, name:'Invoice workshop', slug:`invoice-${product}`, price:0, currency:'PLN',
      product_type:'subscription', recurring_price:11, trial_days:trial?7:null, billing_interval:'month', billing_interval_count:1,
      stripe_price_id:recordedSub.items.data[0].price.id, seller_id:seller, issue_license_on_purchase:true,custom_checkout_fields:[{...PREDEFINED_CUSTOM_FIELDS.license_domain,required:true,claim:undefined}] })).error).toBeNull();
    expect((await db.from('subscription_checkout_fields').insert({reference:legacy?checkout.id:sub.metadata.sf_attr_ref??sub.id,stripe_object_id:checkout.id,product_id:product,user_id:confirmed?uid:null,custom_field_values:{_sellf_license_domain:domain}})).error).toBeNull();
    const earlyInvoice=await db.from('payment_transactions').select('id,order_number,fulfillment_pending,custom_field_values').eq('stripe_invoice_id',invoice.id!).maybeSingle();
    expect(earlyInvoice.data).toBeNull();
    if (legacy) {
      await expect(handleInvoicePaid(invoice,db,db,stripe)).rejects.toThrow('Invalid custom field values');
      expect((await db.from('payment_transactions').select('fulfillment_pending,custom_field_values').eq('stripe_invoice_id',invoice.id!).single()).data).toEqual({fulfillment_pending:true,custom_field_values:{}});
      sessionVisible=true;
    }
    if(stale==='filled') expect((await db.from('payment_transactions').update({custom_field_values:{_sellf_license_domain:expectedDomain}}).eq('stripe_invoice_id',invoice.id!)).error).toBeNull();
    const delayed=(query:object,result:unknown):object=>new Proxy(query,{get(target,key){
      if(key==='maybeSingle') return async()=>result;
      const value=Reflect.get(target,key);
      return typeof value==='function' ? (...args:unknown[])=>['eq','order','limit'].includes(String(key))?delayed(value.apply(target,args),result):value.apply(target,args) : value;
    }});
    let invoiceRead=false,historyRead=false;
    const retryDb=stale==='none'?db:new Proxy(db,{get(target,key){
      if(key==='from') return (table:string)=>{
        const base=target.from(table as never);
        return table!=='payment_transactions'?base:new Proxy(base,{get(q,method){
          if(method==='select') return (columns:string)=>{
            const selected=q.select(columns);
            if(columns.includes('order_number')&&!invoiceRead){invoiceRead=true;return delayed(selected,earlyInvoice);}
            if(columns==='custom_field_values, fulfillment_pending'&&!historyRead){historyRead=true;return delayed(selected,earlyHistory);}
            return selected;
          };
          const value=Reflect.get(q,method);return typeof value==='function'?value.bind(q):value;
        }});
      };
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
    const results = await Promise.all(Array.from({length:stale!=='none'?1:confirmed?3:1},()=>handleInvoicePaid(invoice, retryDb, db, stripe)));
    for (const result of results) expect(result, result.message).toMatchObject({processed:true});
    const saved = await db.from('issued_licenses').select('license_key,email,license_domain').eq('product_id',product).single(); expect(saved.error).toBeNull();
    expect(saved.data!.email).toBe(email);
    expect(saved.data!.license_domain).toBe(expectedDomain);
    expect((await db.from('subscription_checkout_fields').select('reference').eq('product_id',product)).data).toEqual([]);
    expect((await db.from('payment_transactions').select('session_id,amount').eq('product_id',product)).data).toEqual([{session_id:invoice.id,amount}]);
    expect((await db.from('payment_transactions').select('status,custom_field_values,fulfillment_pending').eq('product_id',product)).data).toEqual([expect.objectContaining({status:'completed',custom_field_values:{_sellf_license_domain:expectedDomain},fulfillment_pending:false})]);
    const mail = await waitForEmail(email, { timeout:3000 });
    expect(mail.Subject).toBe(locale === 'pl' ? 'Twój klucz licencyjny: Invoice workshop' : 'Your license key: Invoice workshop');
    expect(mail.HTML).toContain(saved.data!.license_key);
    const link = new URL(extractMagicLink(mail.HTML!)!);
    const buyerClient = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {auth:{persistSession:false,autoRefreshToken:false}});
    expect((await buyerClient.from('subscription_checkout_fields').select('reference')).error?.code).toBe('42501');
    const verified = await buyerClient.auth.verifyOtp({token_hash:link.searchParams.get('token_hash')!,type:link.searchParams.get('type') as 'signup' | 'magiclink'});
    expect(verified.error).toBeNull(); expect(verified.data.user?.id).toBe(uid);
    expect((await buyerClient.from('subscription_checkout_fields').select('reference')).error?.code).toBe('42501');
    expect((await handleInvoicePaid(invoice, db, db, stripe)).processed).toBe(true);
    expect(await searchMessages(email)).toHaveLength(1);
    execFileSync('docker',['exec','-i',getTestDatabaseContainer(),'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:`UPDATE auth.users SET recovery_sent_at = recovery_sent_at - interval '5 minutes', confirmation_sent_at = confirmation_sent_at - interval '5 minutes' WHERE id = '${uid}';`});
    expect((await db.from('subscription_checkout_fields').insert({reference:sub.metadata.sf_attr_ref??sub.id,stripe_object_id:checkout.id,product_id:product,user_id:uid,custom_field_values:{_sellf_license_domain:'later.example.com'}})).error).toBeNull();
    const renewal={...invoice,amount_paid:1100,billing_reason:'subscription_cycle' as const,id:`in_${crypto.randomUUID().replaceAll('-','')}`};
    expect((await handleInvoicePaid(renewal,db,db,stripe)).processed).toBe(true);
    expect((await db.from('issued_licenses').select('license_domain').eq('product_id',product)).data).toEqual([{license_domain:expectedDomain},{license_domain:expectedDomain}]);
    expect(await searchMessages(email)).toHaveLength(2);
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
