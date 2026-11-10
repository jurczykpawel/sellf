/** License decisions through recorded Stripe outcomes, real tokens, CRL and signed delivery. */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import created from '../../fixtures/stripe/charge_dispute_created_needs_response.json';
import won from '../../fixtures/stripe/charge_dispute_closed_won.json';
import lost from '../../fixtures/stripe/charge_dispute_closed_lost.json';
import wonCharge from '../../fixtures/stripe/dispute_charge_won.json';
import refundedCharge from '../../fixtures/stripe/charge_full_current.json';
import lostCharge from '../../fixtures/stripe/dispute_charge_lost.json';
import { getTestDatabaseContainer } from '../../helpers/database-container';
import type Stripe from 'stripe';

const h=vi.hoisted(()=>({pro:true,seller:'',requests:[] as Array<{body:string;headers:Record<string,string>}>}));
vi.mock('@/lib/license/resolve',()=>({checkFeature:async()=>h.pro}));
vi.mock('@/lib/rate-limiting',()=>({checkRateLimit:async()=>true}));
vi.mock('@/lib/auth-server',()=>({requireAdminApiWithRequest:async()=>({user:{id:h.seller}})}));
vi.mock('@/lib/validations/webhook',async original=>({...await original<typeof import('@/lib/validations/webhook')>(),validateWebhookUrlAsync:async()=>({valid:true})}));
vi.mock('undici',async original=>({...await original<typeof import('undici')>(),fetch:async(_url:string,init:{body:string;headers:Record<string,string>})=>{
 h.requests.push({body:init.body,headers:init.headers});return new Response('{}',{status:200});
}}));
import { createAdminClient } from '@/lib/supabase/admin';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { signLicense } from '@/lib/license-keys/format';
import { verifySellfLicense } from '@/lib/license-keys/sdk';
import { handleChargeDispute } from '@/app/api/webhooks/stripe/dispute-handlers';
import { runBusinessEvents } from '@/lib/services/business-events';
import { WebhookService } from '@/lib/services/webhook-service';
import { verifyWebhookSignature } from '@/lib/services/webhook-queue/signature';
import { GET as keys } from '@/app/api/licenses/jwks/route';
import { GET as crl } from '@/app/api/licenses/revoked/route';
import { DELETE as manualRevoke } from '@/app/api/admin/licenses/[id]/route';

const db=createAdminClient();
let product:string,buyer:string,transaction:string,license:string,endpoint:string,token:string,order:string;
let pair:ReturnType<typeof generateSellerKeypair>;
let expiration:string,email:string;
let additionalProducts:string[]=[];
function sql(query:string):void{
 execFileSync('docker',['exec','-i',getTestDatabaseContainer(),'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:query,stdio:['pipe','pipe','pipe']});
}
async function saveToken(exp=Math.floor(Date.now()/1000)+30*86400):Promise<void>{
 expiration=new Date(exp*1000).toISOString();
 const issued=Math.min(Math.floor(Date.now()/1000)-60,exp-86400);
 token=signLicense({v:1,kid:pair.kid,product:'license-restoration-'+product,email,order,tier:'pro',domain:'buyer.example.test',iat:issued,exp},pair.privateKeyPem);
 const {error}=await db.from('issued_licenses').upsert({id:license,seller_id:h.seller,original_seller_id:h.seller,user_id:buyer,product_id:product,email,order_id:order,kid:pair.kid,license_key:token,issued_at:new Date(issued*1000).toISOString(),expires_at:expiration,license_domain:'buyer.example.test'});
 expect(error).toBeNull();
}
async function state(){
 const keyResponse=await keys(new NextRequest('http://localhost/api/licenses/jwks?seller='+h.seller));expect(keyResponse.status).toBe(200);
 const publicKeys=(await keyResponse.json()).keys;
 const hash=createHash('sha256').update(order).digest('hex');
 const response=await crl(new NextRequest('http://localhost/api/licenses/revoked?seller='+h.seller+'&prefix='+hash.slice(0,4)));
 expect(response.status).toBe(200);
 const hashes=(await response.json()).order_hashes;
 const direct=await db.rpc('seller_revoked_orders',{seller:h.seller,hash_prefix:hash.slice(0,4)});expect(direct.error).toBeNull();
 expect(hashes).toEqual((direct.data??[]).map(x=>x.order_hash));
 const verified=verifySellfLicense(token,{keys:publicKeys});
 return {usable:verified.valid&&verified.claims.product==='license-restoration-'+product&&verified.claims.email===email&&verified.claims.domain==='buyer.example.test'&&!hashes.includes(hash),verified,revoked:hashes.includes(hash),response};
}
async function apply(event:typeof created|typeof won|typeof lost){
 const stripe={charges:{retrieve:async(id:string)=>id===wonCharge.id?wonCharge:lostCharge}} as unknown as Stripe;
 const result=await handleChargeDispute(event.data.object as unknown as Stripe.Dispute,db,stripe,event.type==='charge.dispute.closed');
 expect(result.processed).toBe(true);
}
async function revoke(){
 const response=await manualRevoke(new NextRequest('http://localhost/api/admin/licenses/'+license,{method:'DELETE'}),{params:Promise.resolve({id:license})});
 expect(response.status).toBe(200);
 const audit=await db.from('audit_log').select('operation,old_values,new_values').eq('performed_by',h.seller).contains('new_values',{action:'license_revoked',license_id:license});
 expect(audit.error).toBeNull();expect(audit.data!.length).toBeGreaterThan(0);
 expect(audit.data!.every(x=>x.operation==='UPDATE')).toBe(true);expect(JSON.stringify(audit.data).includes(token)).toBe(false);
}
async function drain():Promise<void>{
 for(let n=0;n<30;n++){
  const result=await runBusinessEvents(db);expect(result.errors).toBe(0);
  const remaining=await db.from('business_events').select('id').eq('product_id',product).is('dispatched_at',null);expect(remaining.error).toBeNull();
  if(!remaining.data?.length)return;
 }
 throw Error('Own license notifications still pending');
}
function received(kind:string){return h.requests.map(x=>JSON.parse(x.body)).filter(x=>x.event===kind);}
beforeEach(async()=>{
 h.pro=true;h.requests=[];additionalProducts=[];product=randomUUID();transaction=randomUUID();license=randomUUID();endpoint=randomUUID();order=String(wonCharge.payment_intent);pair=generateSellerKeypair();
 const owner=await db.auth.admin.createUser({email:'license-owner-'+product+'@example.com',email_confirm:true});expect(owner.error).toBeNull();h.seller=owner.data.user!.id;
 const customer=await db.auth.admin.createUser({email:'license-buyer-'+product+'@example.com',email_confirm:true});expect(customer.error).toBeNull();buyer=customer.data.user!.id;email=customer.data.user!.email!;
 await storeSellerKey(db,{sellerId:h.seller,...pair,custody:'managed'});
 expect((await db.from('products').insert({id:product,name:'License restoration',slug:'license-restoration-'+product,price:11,currency:'PLN',license_tier:'pro',issue_license_on_purchase:true})).error).toBeNull();
 expect((await db.from('payment_transactions').insert({id:transaction,product_id:product,user_id:buyer,customer_email:email,session_id:order,stripe_payment_intent_id:order,amount:wonCharge.amount,currency:'PLN',status:'completed'})).error).toBeNull();
 expect((await db.from('user_product_access').insert({user_id:buyer,product_id:product})).error).toBeNull();
 await saveToken();
 expect((await db.from('webhook_endpoints').insert({id:endpoint,url:'https://receiver.example/license',secret:'fixture-license-event-secret',events:['license.revoked','license.restored','dispute.closed'],is_active:true,product_filter_mode:'selected'})).error).toBeNull();
 expect((await db.from('webhook_endpoint_products').insert({webhook_endpoint_id:endpoint,product_id:product})).error).toBeNull();
});
afterEach(async()=>{
 vi.restoreAllMocks();
 await db.from('webhook_endpoints').delete().eq('id',endpoint);
 await db.from('payment_transactions').delete().eq('id',transaction);
 await db.from('products').delete().in('id',[product,...additionalProducts]);
 await db.from('seller_license_keys').delete().eq('original_seller_id',h.seller);
 if(buyer)await db.auth.admin.deleteUser(buyer);if(h.seller)await db.auth.admin.deleteUser(h.seller);
 sql(`DELETE FROM public.business_events WHERE product_id='${product}';`);
});
describe('license restoration consumer contract',()=>{
 it.each(['intent','quick-pay'])('records delayed main and bump licenses as revoked during a %s dispute',async kind=>{
  await db.from('issued_licenses').delete().eq('id',license);
  license=randomUUID();
  if(kind==='quick-pay')order=transaction;
  const bump=randomUUID();additionalProducts.push(bump);
  expect((await db.from('products').insert({id:bump,name:'Delayed bump',slug:'late-bump-'+bump,price:1,currency:'PLN'})).error).toBeNull();
  await apply(created);
  await saveToken();
  expect((await db.from('issued_licenses').insert({seller_id:h.seller,original_seller_id:h.seller,product_id:bump,email,order_id:order,kid:pair.kid,license_key:'delayed-bump'})).error).toBeNull();
  const rows=await db.from('issued_licenses').select('revoked_at,revoked_by_dispute_id').eq('order_id',order);
  expect(rows.data).toHaveLength(2);expect(rows.data!.every(row=>row.revoked_at&&row.revoked_by_dispute_id)).toBe(true);
  await apply(won);
  expect((await db.from('issued_licenses').select('revoked_at').eq('order_id',order)).data!.every(row=>row.revoked_at===null)).toBe(true);
 });

 it.each(['intent','quick-pay'])('revokes and restores main and bump on %s disputes, but keeps a later refund permanent',async kind=>{
  if(kind==='quick-pay'){order=transaction;await saveToken();}
  const bump=randomUUID();additionalProducts.push(bump);
  expect((await db.from('products').insert({id:bump,name:'Licensed bump',slug:'bump-'+bump,price:1,currency:'PLN'})).error).toBeNull();
  expect((await db.from('issued_licenses').insert({seller_id:h.seller,original_seller_id:h.seller,product_id:bump,email,order_id:order,kid:pair.kid,license_key:'fixture-bump'})).error).toBeNull();
  await apply(created);
  let rows=await db.from('issued_licenses').select('revoked_at,revoked_by_dispute_id').eq('order_id',order);
  expect(rows.error).toBeNull();expect(rows.data).toHaveLength(2);expect(rows.data!.every(row=>row.revoked_at&&row.revoked_by_dispute_id)).toBe(true);
  await apply(won);
  rows=await db.from('issued_licenses').select('revoked_at,revoked_by_dispute_id').eq('order_id',order);
  expect(rows.data!.every(row=>row.revoked_at===null)).toBe(true);
  expect((await db.from('payment_transactions').update({status:'refunded',refunded_amount:wonCharge.amount}).eq('id',transaction)).error).toBeNull();
  expect((await db.from('issued_licenses').select('revoked_at,revocation_reason').eq('order_id',order)).data).toEqual([
    expect.objectContaining({revoked_at:expect.any(String),revocation_reason:'refund'}),
    expect.objectContaining({revoked_at:expect.any(String),revocation_reason:'refund'}),
  ]);
  expect((await state()).revoked).toBe(true);
 });

 it('makes the same signed token usable again and removes its CRL entry after won',async()=>{
  const original=token;expect((await state()).usable).toBe(true);
  await apply(created);expect((await state()).revoked).toBe(true);
  await drain();
  await apply(won);expect((await state()).usable).toBe(true);
  const row=await db.from('issued_licenses').select('license_key,revoked_at,expires_at').eq('id',license).single();expect(row.data!.revoked_at).toBeNull();expect(createHash('sha256').update(row.data!.license_key).digest('hex')).toBe(createHash('sha256').update(original).digest('hex'));expect(new Date(row.data!.expires_at!).getTime()).toBe(new Date(expiration).getTime());
  await drain();await apply(won);await apply(created);await drain();
  expect(received('license.restored')).toHaveLength(1);expect(received('license.revoked')).toHaveLength(1);
  const notice=received('license.restored')[0].data;
  expect(notice).toMatchObject({license:{id:license,order,email,domain:'buyer.example.test',revokedAt:null},product:{id:product}});
  expect(new Date(notice.license.expiresAt).getTime()).toBe(new Date(expiration).getTime());
  expect(notice.crlUrl).toContain('/api/licenses/revoked?seller='+h.seller);
  const closing=received('dispute.closed')[0].data.dispute;
  expect(closing.licenseRestored).toBe(true);expect(closing.restoredLicenses).toEqual(expect.arrayContaining([expect.objectContaining({id:license})]));
  for(const request of h.requests){
   expect(verifyWebhookSignature('fixture-license-event-secret',request.body,request.headers['X-Sellf-Signature'])).toBe(true);
   expect(request.body.includes(original)).toBe(false);expect(request.body.includes('license_key')).toBe(false);
  }
 });
 it('notifies a later manual revocation again without duplicating unchanged decisions',async()=>{
  await apply(created);await drain();await apply(won);await drain();
  await revoke();await drain();await revoke();await drain();
  expect(received('license.revoked')).toHaveLength(2);expect(received('license.restored')).toHaveLength(1);
  const ids=[...received('license.revoked'),...received('license.restored')].map(x=>x.id);expect(new Set(ids).size).toBe(3);
  expect((await state()).usable).toBe(false);
 });
 it.each(['before','after'])('keeps a license manually revoked %s the dispute revoked',async timing=>{
  if(timing==='before')await revoke();
  await apply(created);
  if(timing==='after')await revoke();
  await apply(won);expect((await state()).revoked).toBe(true);await drain();
  expect(received('license.restored')).toHaveLength(0);expect(received('dispute.closed')[0].data.dispute.licenseRestored).toBe(false);
 });
 it('restores its license without recreating product access the seller removed',async()=>{
  await apply(created);
  sql(`DELETE FROM public.user_product_access WHERE user_id='${buyer}' AND product_id='${product}';`);
  await apply(won);expect((await state()).usable).toBe(true);
  expect(received('dispute.closed')[0].data.dispute).toMatchObject({licenseRestored:true,accessRestored:false});
 });
 it('does not restore after a full refund during the dispute',async()=>{
  await apply(created);
  sql(`UPDATE public.payment_transactions SET status='refunded',refunded_amount=amount WHERE id='${transaction}';`);
  // Record the refund's permanent license decision through its shared operation.
  const {revokeLicensesForOrder}=await import('@/lib/license-keys/revoke');await revokeLicensesForOrder(db,{productId:product,orderIds:[order],reason:'refund'});
  const stripe={charges:{retrieve:async()=>({...refundedCharge,id:wonCharge.id,payment_intent:wonCharge.payment_intent})}} as unknown as Stripe;
  expect((await handleChargeDispute(won.data.object as unknown as Stripe.Dispute,db,stripe,true)).processed).toBe(true);
  expect((await state()).revoked).toBe(true);await drain();expect(received('license.restored')).toHaveLength(0);
 });
 it('keeps an order blocked when another license on it was manually revoked',async()=>{
  const other=randomUUID();additionalProducts.push(other);
  expect((await db.from('products').insert({id:other,name:'Other licensed product',slug:'other-'+other,price:5,currency:'PLN'})).error).toBeNull();
  const otherToken=signLicense({v:1,kid:pair.kid,product:'other-'+other,email,order,tier:'pro',iat:Math.floor(Date.now()/1000)-60,exp:null},pair.privateKeyPem);
  expect((await db.from('issued_licenses').insert({product_id:other,seller_id:h.seller,original_seller_id:h.seller,order_id:order,kid:pair.kid,license_key:otherToken,revoked_at:new Date().toISOString()})).error).toBeNull();
  await apply(created);await apply(won);expect((await state()).revoked).toBe(true);
  const current=await db.from('issued_licenses').select('revoked_at').eq('id',license).single();expect(current.data!.revoked_at).not.toBeNull();
  await drain();expect(received('license.restored')).toHaveLength(0);expect(received('dispute.closed')[0].data.dispute.licenseRestored).toBe(false);
 });
 it('reports the original signed tier when the product tier changed during the dispute',async()=>{
  await apply(created);expect((await db.from('products').update({license_tier:'enterprise'}).eq('id',product)).error).toBeNull();
  await apply(won);expect((await state()).usable).toBe(true);await drain();
  expect(received('license.restored')[0].data.license.tier).toBe('pro');
 });
 it('keeps an expired license at its original expiry when its dispute ends',async()=>{
  await saveToken(Math.floor(Date.now()/1000)-86400);await apply(created);await apply(won);
  const checked=await state();expect(checked.revoked).toBe(false);expect(checked.verified).toMatchObject({valid:false,reason:'expired'});
  const row=await db.from('issued_licenses').select('expires_at').eq('id',license).single();expect(new Date(row.data!.expires_at!).getTime()).toBe(new Date(expiration).getTime());
 });
 it('keeps lost revoked without a restored notification',async()=>{
  order=String(lostCharge.payment_intent);await db.from('payment_transactions').update({session_id:order,stripe_payment_intent_id:order}).eq('id',transaction);await saveToken();
  await apply(lost);await apply(lost);expect((await state()).revoked).toBe(true);await drain();
  expect(received('license.revoked')).toHaveLength(1);expect(received('license.restored')).toHaveLength(0);
 });
 it('does not publish or clear revocation when the rest of the state transaction fails',async()=>{
  await apply(created);await drain();h.requests=[];
  const d=won.data.object;
  expect(()=>sql(`BEGIN; SET LOCAL request.jwt.claims='{"role":"service_role"}';
    CREATE FUNCTION pg_temp.reject_resolution() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'State write unavailable'; END$$;
    CREATE TRIGGER reject_license_resolution BEFORE UPDATE ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_resolution();
    SELECT public.apply_payment_dispute('${transaction}','${d.id}','${d.status}',true,'${d.reason}',${d.amount},'${d.currency}',to_timestamp(${d.created})); COMMIT;`)).toThrow();
  expect((await state()).revoked).toBe(true);await drain();expect(received('license.restored')).toHaveLength(0);
 });
 it('retries the committed license event when queue handoff fails',async()=>{
  await apply(created);await drain();h.requests=[];await apply(won);
  const original=WebhookService.trigger.bind(WebhookService);let fail=true;
  const handoff=vi.spyOn(WebhookService,'trigger').mockImplementation(async(...args)=>{
   if(args[0]==='license.restored'&&fail){fail=false;throw new Error('Queue unavailable');}
   return original(...args);
  });
  expect((await runBusinessEvents(db)).errors).toBe(1);handoff.mockRestore();
  expect(received('license.restored')).toHaveLength(0);
  sql(`UPDATE public.business_events SET leased_until=now()-interval '1 second' WHERE product_id='${product}' AND event_type='license.restored';`);
  await drain();await drain();
  expect((await state()).usable).toBe(true);expect(received('license.restored')).toHaveLength(1);
 });
 it('does not dispatch license status changes after a downgrade',async()=>{
  await apply(created);h.pro=false;await drain();await apply(won);await drain();
  expect(received('license.revoked')).toHaveLength(0);expect(received('license.restored')).toHaveLength(0);expect((await state()).usable).toBe(true);
 });
 it('keeps license mutations and dispute tracking unavailable to anonymous callers',async()=>{
  const anon=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const mutation=await anon.rpc('revoke_issued_licenses',{p_license_ids:[license]});expect(mutation.error?.code).toBe('42501');
  const tracking=await anon.from('payment_disputes').select('revoked_license_ids');expect(tracking.error?.code).toBe('42501');
  expect((await state()).usable).toBe(true);
 });
 it('returns an uncached authoritative CRL response',async()=>{
  expect((await state()).response.headers.get('cache-control')).toContain('no-store');
 });
});
