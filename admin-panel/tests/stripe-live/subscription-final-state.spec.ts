/** Real invoice fulfillment, buyer mail and refunded subscription management. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { supabaseAdmin as db, setAuthSession } from '../helpers/admin-auth';
import { deleteChecked, deleteAuthUsers } from '../helpers/db-cleanup';
import { acceptAllCookies } from '../helpers/consent';
import { useSupabaseBuyerEmails } from '../helpers/buyer-email-setting-playwright';
import { waitForEmail, searchMessages } from '../helpers/mailpit';

useSupabaseBuyerEmails();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

test('paid subscription delivers its license, full refund ends management and a won dispute restores guest access @J05 @J38', async ({ page }) => {
  test.setTimeout(300000);
  expect(process.env.SLOT_TICKET).toBeTruthy();
  expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
  const run = randomUUID(), email = `subscription-final-${run}@example.com`, password = 'FinalPurchase187!';
  const productId = randomUUID(), disputeProductId = randomUUID();
  let disputeBuyerId: string | undefined, disputeIntent: Stripe.PaymentIntent | undefined;
  const buyer = await db.auth.admin.createUser({ email, password, email_confirm:true }); expect(buyer.error).toBeNull();
  const userId = buyer.data.user!.id;
  let customer: Stripe.Customer | undefined, stripeProduct: Stripe.Product | undefined, price: Stripe.Price | undefined, sub: Stripe.Subscription | undefined;
  try {
    await storeSellerKey(db, { sellerId:userId, ...generateSellerKeypair(), custody:'managed' });
    stripeProduct = await stripe.products.create({name:'Final subscription workshop'});
    price = await stripe.prices.create({product:stripeProduct.id,unit_amount:1100,currency:'pln',recurring:{interval:'month'}});
    expect((await db.from('products').insert({id:productId,name:'Final subscription workshop',slug:`final-${run}`,price:0,currency:'PLN',is_active:true,
      product_type:'subscription',recurring_price:11,billing_interval:'month',billing_interval_count:1,stripe_price_id:price.id,
      seller_id:userId,issue_license_on_purchase:true,vat_exempt:true})).error).toBeNull();
    customer = await stripe.customers.create({email:email.toUpperCase(),payment_method:'pm_card_visa',invoice_settings:{default_payment_method:'pm_card_visa'}});
    sub = await stripe.subscriptions.create({customer:customer.id,items:[{price:price.id}],metadata:{product_id:productId,locale:'pl'}});
    expect(sub.status).toBe('active');
    await expect.poll(async () => (await db.from('payment_transactions').select('id').eq('product_id',productId).eq('status','completed')).data?.length,{timeout:60000}).toBe(1);
    await expect.poll(async () => (await db.from('issued_licenses').select('id').eq('product_id',productId)).data?.length,{timeout:30000}).toBe(1);
    const license = await db.from('issued_licenses').select('license_key,email').eq('product_id',productId).single(); expect(license.error).toBeNull();
    expect(license.data!.email).toBe(email);
    const mail = await waitForEmail(email,{timeout:30000});
    expect(mail.Subject).toBe('Twój klucz licencyjny: Final subscription workshop');
    expect(mail.HTML).toContain(license.data!.license_key);
    await acceptAllCookies(page); await setAuthSession(page,email,password);
    await page.goto('/pl/my-purchases');
    await expect(page.getByRole('button',{name:'Anuluj subskrypcję'})).toBeVisible();
    const tx = await db.from('payment_transactions').select('stripe_payment_intent_id,subscription_id').eq('product_id',productId).single(); expect(tx.error).toBeNull();
    expect(tx.data!.stripe_payment_intent_id).toBeTruthy();
    await stripe.refunds.create({payment_intent:tx.data!.stripe_payment_intent_id!});
    await expect.poll(async () => (await stripe.subscriptions.retrieve(sub!.id)).status,{timeout:60000}).toBe('canceled');
    const response = await page.request.post(`/api/subscriptions/${tx.data!.subscription_id}/resume`,{headers:{'X-Requested-With':'XMLHttpRequest'}});
    expect(response.status()).toBe(400);
    await page.reload();
    await expect(page.getByText('Anulowana', {exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:/Wznów subskrypcję|Anuluj subskrypcję/})).toHaveCount(0);
    await expect(page.getByText(/Kończy się:/)).toHaveCount(0);
    const access = await db.from('user_product_access').select('access_expires_at').eq('user_id',userId).eq('product_id',productId); expect(access.error).toBeNull();
    expect(access.data!.some(row => !row.access_expires_at || Date.parse(row.access_expires_at)>Date.now())).toBe(false);
    expect((await db.from('issued_licenses').select('revoked_at').eq('product_id',productId).single()).data!.revoked_at).toBeTruthy();
    expect(await searchMessages(email)).toHaveLength(1);
    await page.screenshot({path:`${process.env.STRIPE_LIVE_ARTIFACTS}/refunded-subscription.png`});

    const disputeEmail = `dispute-final-${run}@example.com`;
    expect((await db.from('products').insert({id:disputeProductId,name:'Dispute workshop',slug:`dispute-${run}`,price:11,currency:'PLN',is_active:true,auto_grant_duration_days:30})).error).toBeNull();
    disputeIntent = await stripe.paymentIntents.create({amount:1100,currency:'pln',payment_method:'pm_card_createDispute',payment_method_types:['card'],confirm:true});
    expect(disputeIntent.status).toBe('succeeded');
    const charge = typeof disputeIntent.latest_charge === 'string' ? disputeIntent.latest_charge : disputeIntent.latest_charge!.id;
    const transaction = await db.from('payment_transactions').insert({product_id:disputeProductId,customer_email:disputeEmail,session_id:disputeIntent.id,
      stripe_payment_intent_id:disputeIntent.id,amount:1100,currency:'PLN',status:'completed'}).select('id').single(); expect(transaction.error).toBeNull();
    const guest = await db.from('guest_purchases').insert({product_id:disputeProductId,customer_email:disputeEmail,session_id:disputeIntent.id,
      transaction_amount:1100,transaction_id:transaction.data!.id}).select('id,created_at').single(); expect(guest.error).toBeNull();
    let dispute: Stripe.Dispute | undefined;
    await expect.poll(async () => { dispute = (await stripe.disputes.list({charge})).data[0]; return !!dispute; },{timeout:60000}).toBe(true);
    await expect.poll(async () => (await db.from('payment_transactions').select('status').eq('id',transaction.data!.id).single()).data?.status,{timeout:60000}).toBe('disputed');
    expect((await db.from('guest_purchases').select('id').eq('id',guest.data!.id)).data).toHaveLength(0);
    const confirmed = await db.auth.admin.createUser({email:disputeEmail,password,email_confirm:true}); expect(confirmed.error).toBeNull();
    disputeBuyerId = confirmed.data.user!.id;
    expect((await db.from('user_product_access').select('id').eq('product_id',disputeProductId).eq('user_id',disputeBuyerId)).data).toHaveLength(0);
    const client = createClient(process.env.SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    expect((await client.auth.signInWithPassword({email:disputeEmail,password})).error).toBeNull();
    const accessDuringDispute = await client.rpc('check_user_product_access',{product_slug_param:`dispute-${run}`}); expect(accessDuringDispute.error).toBeNull(); expect(accessDuringDispute.data).toBe(false);
    await stripe.disputes.update(dispute!.id,{evidence:{uncategorized_text:'winning_evidence'},submit:true});
    await expect.poll(async () => (await db.from('payment_transactions').select('status').eq('id',transaction.data!.id).single()).data?.status,{timeout:60000}).toBe('completed');
    const restored = await db.from('user_product_access').select('access_expires_at').eq('product_id',disputeProductId).eq('user_id',disputeBuyerId).single(); expect(restored.error).toBeNull();
    expect(Date.parse(restored.data!.access_expires_at)).toBe(Date.parse(guest.data!.created_at)+30*86400000);
    expect((await db.from('guest_purchases').select('claimed_by_user_id').eq('id',guest.data!.id).single()).data?.claimed_by_user_id).toBe(disputeBuyerId);
    const accessAfterWon = await client.rpc('check_user_product_access',{product_slug_param:`dispute-${run}`}); expect(accessAfterWon.error).toBeNull(); expect(accessAfterWon.data).toBe(true);

  } finally {
    if (sub && (await stripe.subscriptions.retrieve(sub.id)).status!=='canceled') await stripe.subscriptions.cancel(sub.id);
    if (disputeIntent) {
      const charge = typeof disputeIntent.latest_charge === 'string' ? disputeIntent.latest_charge : disputeIntent.latest_charge?.id;
      const dispute = charge ? (await stripe.disputes.list({charge})).data[0] : undefined;
      if (dispute?.status === 'needs_response') await stripe.disputes.close(dispute.id);
    }
    for (const id of [productId,disputeProductId]) {
      for (const table of ['issued_licenses','user_product_access','payment_transactions','subscriptions']) await deleteChecked(table,db.from(table).delete().eq('product_id',id));
      await deleteChecked('products',db.from('products').delete().eq('id',id));
    }
    if (disputeBuyerId) await deleteAuthUsers(db,[disputeBuyerId]);
    await deleteChecked('seller_license_keys',db.from('seller_license_keys').delete().eq('original_seller_id',userId));
    await deleteChecked('stripe_customers',db.from('stripe_customers').delete().eq('user_id',userId));
    await deleteAuthUsers(db,[userId]);
    if(customer) await stripe.customers.del(customer.id);
    if(price) await stripe.prices.update(price.id,{active:false});
    if(stripeProduct) await stripe.products.update(stripeProduct.id,{active:false});
  }
});
