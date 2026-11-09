import { execFileSync } from 'node:child_process';
import { getTestDatabaseContainer } from '../../helpers/database-container';
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
import { waitForEmail, searchMessages, extractMagicLink } from '../../helpers/mailpit';
import { mailOrderLicenses, sendLicenseMail } from '@/lib/license-keys/license-mail';
import { purchaseEventMail } from '@/lib/events/mail';
import { sendTrustedMagicLink } from '@/lib/auth/magic-link/request';
import { runAuthMailRetries } from '@/lib/auth/magic-link/retry';
import { buildPostCheckoutMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
useSupabaseBuyerEmails();
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
it.each(['pl','en'] as const)('keeps the first combined %s purchase link usable after the retry worker', async locale => {
 const email = `combined-${crypto.randomUUID()}@example.com`;
 const seller = await db.auth.admin.createUser({email:`seller-${email}`,email_confirm:true});
 expect(seller.error).toBeNull();
 const {data:products,error} = await db.from('products').insert([1,2].map(i=>({name:`Kit ${i}`,slug:`kit-${i}-${crypto.randomUUID()}`,price:10,currency:'PLN'}))).select('id,slug');
 expect(error).toBeNull();
 const session = `cs_test_${crypto.randomUUID().replaceAll('-','')}`;
 const order = `pi_${crypto.randomUUID().replaceAll('-','')}`;
 const tx = await db.from('payment_transactions').insert({product_id:products![0].id,customer_email:email,session_id:session,stripe_payment_intent_id:order,fulfillment_pending:true,amount:2000,currency:'PLN',status:'completed'}).select('id').single();
 expect(tx.error).toBeNull();
 const licenses = products!.map((p,i)=>({productId:p.id,token:`key${i}.signature`}));
 try {
  expect((await db.from('guest_purchases').insert(products!.map((p,i)=>({product_id:p.id,customer_email:email,session_id:`${session}_${i}`,transaction_id:tx.data!.id,transaction_amount:1000})))).error).toBeNull();
  expect((await db.from('issued_licenses').insert(licenses.map(l=>({seller_id:seller.data.user!.id,product_id:l.productId,email,order_id:order,kid:'mail-test',license_key:l.token})))).error).toBeNull();
  const redirectTo=buildPostCheckoutMagicLinkRedirect({origin:getSellfBaseUrl(),productSlug:products![0].slug,locale,sessionId:session,paymentIntentId:order});
  expect((await db.rpc('queue_auth_mail_retry',{p_email:email,p_redirect_to:redirectTo,p_data:{locale},p_kind:'post_checkout',p_error:'send_failed'})).error).toBeNull();
  const receipt = await purchaseEventMail(email,products![0].id,session,order,locale,{allowPending:true});
  expect(receipt.purchase_product).toBe('Kit 1');
  await Promise.all([1,2].map(()=>mailOrderLicenses(db,{email,userId:null,locale,licenses,mailData:receipt})));
  await db.from('payment_transactions').update({fulfillment_pending:false}).eq('id',tx.data!.id);
  const mail = await waitForEmail(email);
  for(const l of licenses) expect(mail.HTML).toContain(l.token);
  expect(mail.HTML).toContain(locale==='pl' ? '20,00\u00a0zł' : 'PLN\u00a020.00');
  const context = await purchaseEventMail(email,products![0].id,session,order,locale);
  expect(context.license_mail_managed).toBe('true');
  expect(await sendTrustedMagicLink({email,data:context,retry:'post_checkout',redirectTo:buildPostCheckoutMagicLinkRedirect({origin:getSellfBaseUrl(),productSlug:products![0].slug,locale,sessionId:session,paymentIntentId:order})})).toEqual({ok:true,skipped:true});
  await db.from('auth_mail_retries').update({next_attempt_at:new Date(0).toISOString()}).eq('email',email);
  await runAuthMailRetries(db);
  expect(await searchMessages(email)).toHaveLength(1);
  const link = new URL(extractMagicLink(mail.HTML!)!);
  const auth = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const verified = await auth.auth.verifyOtp({token_hash:link.searchParams.get('token_hash')!,type:'email'});
  expect(verified.error).toBeNull();
  expect((await auth.from('license_mail_receipts').select('mail_key')).error?.code).toBe('42501');
  const anon=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,{auth:{persistSession:false}});
  expect((await anon.from('license_mail_receipts').select('mail_key')).error?.code).toBe('42501');
  const account = await db.auth.admin.getUserById(verified.data.user!.id);
  expect(account.data.user!.user_metadata.license_keys).toBeUndefined();
  expect(account.data.user!.user_metadata.license_key).toBeUndefined();
  // Both keys are checked, including access withdrawn without revoking the key.
  expect((await db.rpc('license_mail_is_current',{p_email:email,p_keys:licenses.map(l=>l.token)})).data).toBe(true);
  await db.from('issued_licenses').update({revoked_at:new Date().toISOString()}).eq('product_id',products![1].id);
  expect((await db.rpc('license_mail_is_current',{p_email:email,p_keys:licenses.map(l=>l.token)})).data).toBe(false);
  expect((await db.rpc('queue_auth_mail_retry',{p_email:email,p_redirect_to:redirectTo,p_data:{locale,license_key:licenses[0].token,license_keys:Object.fromEntries(licenses.map(l=>[l.productId,l.token]))},p_kind:'license',p_error:'rate_limited'})).error).toBeNull();
  await db.from('auth_mail_retries').update({next_attempt_at:new Date(0).toISOString()}).eq('email',email);
  await runAuthMailRetries(db);
  expect((await db.from('auth_mail_retries').select('id').eq('email',email)).data).toEqual([]);
  expect(await searchMessages(email)).toHaveLength(1);
 } finally {
  const users=(await db.auth.admin.listUsers({perPage:1000})).data.users;
  const buyer=users.find(u=>u.email===email);if(buyer) await db.auth.admin.deleteUser(buyer.id);
  await db.from('auth_mail_retries').delete().eq('email',email);
  await db.from('guest_purchases').delete().eq('customer_email',email);
  await db.from('payment_transactions').delete().eq('id',tx.data!.id);
  await db.from('products').delete().in('id',products!.map(p=>p.id));
  await db.auth.admin.deleteUser(seller.data.user!.id);
 }
});

it('discards a queued free-product license after access is removed', async()=>{
 const email=`free-mail-${crypto.randomUUID()}@example.com`;
 const user=await db.auth.admin.createUser({email,email_confirm:true});
 const product=await db.from('products').insert({name:'Free Kit',slug:`free-mail-${crypto.randomUUID()}`,price:0,currency:'PLN'}).select('id,slug').single();
 try {
  expect((await db.from('user_product_access').insert({user_id:user.data.user!.id,product_id:product.data!.id})).error).toBeNull();
  expect((await db.from('issued_licenses').insert({seller_id:user.data.user!.id,product_id:product.data!.id,email,user_id:user.data.user!.id,order_id:`free_${user.data.user!.id}_${product.data!.id}`,kid:'mail-test',license_key:'free.signature'})).error).toBeNull();
  expect((await db.rpc('license_mail_is_current',{p_email:email,p_keys:['free.signature']})).data).toBe(true);
  await sendLicenseMail(db,{userId:user.data.user!.id,email,productSlug:product.data!.slug,productName:'Free Kit',token:'free.signature',locale:'pl'});
  expect((await waitForEmail(email)).HTML).toContain('free.signature');
  await db.from('user_product_access').delete().eq('user_id',user.data.user!.id);
  expect((await db.rpc('license_mail_is_current',{p_email:email,p_keys:['free.signature']})).data).toBe(false);
 }finally{
  await db.from('products').delete().eq('id',product.data!.id);
  await db.auth.admin.deleteUser(user.data.user!.id);
 }
});

it('upgrades an awaiting confirmation to the license delivery at the same destination',async()=>{
 const email=`upgrade-mail-${crypto.randomUUID()}@example.com`, redirect='https://example.com/auth/callback?redirect_to=course';
 try {
  for (const kind of ['post_checkout','license','post_checkout']) expect((await db.rpc('queue_auth_mail_retry',{p_email:email,p_redirect_to:redirect,p_data:kind==='license'?{license_key:'key.signature'}:{locale:'pl'},p_kind:kind,p_error:'send_failed'})).error).toBeNull();
  const row=await db.from('auth_mail_retries').select('kind,data').eq('email',email).single();
  expect(row.data).toMatchObject({kind:'license',data:{license_key:'key.signature'}});
 }finally{await db.from('auth_mail_retries').delete().eq('email',email);}
});

it('keeps an unconfirmed paid subscriber eligible until the payment is refunded', async()=>{
 const email=`subscription-mail-${crypto.randomUUID()}@example.com`;
 const user=await db.auth.admin.createUser({email,email_confirm:false});
 const product=await db.from('products').insert({name:'Subscription Kit',slug:`subscription-mail-${crypto.randomUUID()}`,price:10,currency:'PLN'}).select('id').single();
 const invoice=`in_${crypto.randomUUID().replaceAll('-','')}`;
 const sub=await db.from('subscriptions').insert({user_id:user.data.user!.id,product_id:product.data!.id,stripe_customer_id:`cus_${crypto.randomUUID()}`,stripe_subscription_id:`sub_${crypto.randomUUID()}`,status:'active',current_period_end:new Date(Date.now()+86400000).toISOString()}).select('id').single();
 expect(sub.error).toBeNull();
 try{
  expect((await db.from('payment_transactions').insert({product_id:product.data!.id,customer_email:email,user_id:user.data.user!.id,subscription_id:sub.data!.id,session_id:invoice,stripe_invoice_id:invoice,amount:1000,currency:'PLN',status:'completed'})).error).toBeNull();
  expect((await db.from('issued_licenses').insert({seller_id:user.data.user!.id,product_id:product.data!.id,email,user_id:user.data.user!.id,order_id:invoice,kid:'mail-test',license_key:'subscription.signature'})).error).toBeNull();
  expect((await db.rpc('license_mail_is_current',{p_email:email,p_keys:['subscription.signature']})).data).toBe(true);
  expect((await purchaseEventMail(email,product.data!.id)).license_mail_managed).toBe('true');
  await db.from('payment_transactions').update({status:'refunded',refunded_amount:1000}).eq('stripe_invoice_id',invoice);
  expect((await db.rpc('license_mail_is_current',{p_email:email,p_keys:['subscription.signature']})).data).toBe(false);
 }finally{
  await db.from('payment_transactions').delete().eq('stripe_invoice_id',invoice);
  await db.from('subscriptions').delete().eq('id',sub.data!.id);
  await db.from('products').delete().eq('id',product.data!.id);
  await db.auth.admin.deleteUser(user.data.user!.id);
 }
});

it('uses the license delivery as the paid bank-transfer confirmation', async()=>{
 const {sendOrderNotice}=await import('@/lib/orders/transfer-mail');
 const email=`transfer-license-${crypto.randomUUID()}@example.com`;
 const user=await db.auth.admin.createUser({email,email_confirm:true});
 const product=await db.from('products').insert({name:'Transfer Kit',slug:`transfer-license-${crypto.randomUUID()}`,price:10,currency:'PLN'}).select('id,slug').single();
 const tx=await db.from('payment_transactions').insert({product_id:product.data!.id,user_id:user.data.user!.id,customer_email:email,payment_provider:'bank_transfer',pricing_snapshot_version:1,status:'completed',amount:1000,currency:'PLN',metadata:{locale:'pl'}}).select('id').single();
 expect(tx.error).toBeNull();
 try{
  expect((await db.from('user_product_access').insert({user_id:user.data.user!.id,product_id:product.data!.id})).error).toBeNull();
  expect((await db.from('issued_licenses').insert({seller_id:user.data.user!.id,user_id:user.data.user!.id,product_id:product.data!.id,email,order_id:tx.data!.id,kid:'mail-test',license_key:'transfer.signature'})).error).toBeNull();
  await mailOrderLicenses(db,{email,userId:user.data.user!.id,locale:'pl',licenses:[{productId:product.data!.id,token:'transfer.signature'}]});
  const mail=await waitForEmail(email);
  await sendOrderNotice(db as never,tx.data!.id,'paid');
  const state=await db.from('payment_transactions').select('transfer_paid_mail_sent_at').eq('id',tx.data!.id).single();
  expect(state.data!.transfer_paid_mail_sent_at).not.toBeNull();
  expect(await searchMessages(email)).toHaveLength(1);
  const link=new URL(extractMagicLink(mail.HTML!)!);
  const auth=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  expect((await auth.auth.verifyOtp({token_hash:link.searchParams.get('token_hash')!,type:'email'})).error).toBeNull();
 }finally{
  await db.from('user_product_access').delete().eq('product_id',product.data!.id);
  await db.from('payment_transactions').delete().eq('id',tx.data!.id);
  await db.from('products').delete().eq('id',product.data!.id);
  await db.auth.admin.deleteUser(user.data.user!.id);
 }
});

it('reserves mail registration and completion for the service role',()=>{
 const sql = "SELECT has_function_privilege('anon','public.claim_license_mail(text,text,text,jsonb)','execute'),has_function_privilege('authenticated','public.claim_license_mail(text,text,text,jsonb)','execute'),has_function_privilege('anon','public.finish_license_mail(uuid,boolean,text)','execute'),has_function_privilege('authenticated','public.finish_license_mail(uuid,boolean,text)','execute'),has_function_privilege('service_role','public.claim_license_mail(text,text,text,jsonb)','execute'),has_function_privilege('service_role','public.finish_license_mail(uuid,boolean,text)','execute')";
 const output=execFileSync('docker',['exec',getTestDatabaseContainer(),'psql','-U','postgres','-Atc',sql],{encoding:'utf8'});
 expect(output.trim()).toBe('f|f|f|f|t|t');
});
