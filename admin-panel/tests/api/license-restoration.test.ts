/** The same token and public CRL determine whether a buyer can use a restored license. */
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import created from '../fixtures/stripe/charge_dispute_created_needs_response.json';
import won from '../fixtures/stripe/charge_dispute_closed_won.json';
import charge from '../fixtures/stripe/dispute_charge_won.json';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { signLicense } from '@/lib/license-keys/format';
import { verifySellfLicense } from '@/lib/license-keys/sdk';
import { API_URL, supabaseAdmin } from './setup';

const db=supabaseAdmin();
const loginClient=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
let seller:string,buyer:string,product:string,transaction:string,license:string,token:string,auth:string,kid:string,buyerEmail:string;
const order=String(charge.payment_intent);
async function apply(event:typeof created|typeof won){
 const d=event.data.object;const result=await db.rpc('apply_payment_dispute',{p_transaction_id:transaction,p_dispute_id:d.id,p_status:d.status,p_closed:event.type==='charge.dispute.closed',p_reason:d.reason,p_amount:d.amount,p_currency:d.currency,p_created:new Date(d.created*1000).toISOString()});expect(result.error).toBeNull();return result.data;
}
async function usable(){
 const publicKeys=await fetch(API_URL+'/api/licenses/jwks?seller='+seller);expect(publicKeys.status).toBe(200);
 const hash=createHash('sha256').update(order).digest('hex');
 const response=await fetch(API_URL+'/api/licenses/revoked?seller='+seller+'&prefix='+hash.slice(0,4));expect(response.status).toBe(200);
 expect(response.headers.get('cache-control')).toContain('no-store');
 const revoked=(await response.json()).order_hashes.includes(hash);
 const checked=verifySellfLicense(token,{keys:(await publicKeys.json()).keys});
 return checked.valid&&checked.claims.product==='licence-api-'+product&&checked.claims.email===buyerEmail&&!revoked;
}
async function revoke(){
 const r=await fetch(API_URL+'/api/admin/licenses/'+license,{method:'DELETE',headers:{Authorization:'Bearer '+auth}});expect(r.status).toBe(200);expect(await r.json()).toEqual({revoked:true});
}
beforeEach(async()=>{
 const login=await loginClient.auth.signInWithPassword({email:'demo@sellf.app',password:'demo123'});expect(login.error).toBeNull();auth=login.data.session!.access_token;
 const issuer=await db.auth.admin.createUser({email:'restoration-seller-'+randomUUID()+'@example.com',email_confirm:true});expect(issuer.error).toBeNull();seller=issuer.data.user!.id;
 expect((await db.from('admin_users').insert({user_id:seller})).error).toBeNull();
 const customer=await db.auth.admin.createUser({email:'restoration-api-'+randomUUID()+'@example.com',email_confirm:true});expect(customer.error).toBeNull();buyer=customer.data.user!.id;buyerEmail=customer.data.user!.email!;
 product=randomUUID();transaction=randomUUID();license=randomUUID();
 const pair=generateSellerKeypair();kid=pair.kid;await storeSellerKey(db,{sellerId:seller,...pair,custody:'managed'});
 const now=Math.floor(Date.now()/1000),exp=now+30*86400;
 token=signLicense({v:1,kid,product:'licence-api-'+product,email:customer.data.user!.email!,order,tier:'pro',iat:now-60,exp},pair.privateKeyPem);
 expect((await db.from('products').insert({id:product,name:'License restoration API',slug:'licence-api-'+product,price:11,currency:'PLN'})).error).toBeNull();
 expect((await db.from('payment_transactions').insert({id:transaction,product_id:product,user_id:buyer,customer_email:customer.data.user!.email!,session_id:order,stripe_payment_intent_id:order,amount:charge.amount,currency:'PLN',status:'completed'})).error).toBeNull();
 expect((await db.from('issued_licenses').insert({id:license,seller_id:seller,original_seller_id:seller,user_id:buyer,product_id:product,email:customer.data.user!.email!,order_id:order,kid,license_key:token,issued_at:new Date((now-60)*1000).toISOString(),expires_at:new Date(exp*1000).toISOString()})).error).toBeNull();
});
afterEach(async()=>{
 await db.from('payment_transactions').delete().eq('id',transaction);await db.from('products').delete().eq('id',product);
 await db.from('seller_license_keys').delete().eq('kid',kid);if(buyer)await db.auth.admin.deleteUser(buyer);if(seller)await db.auth.admin.deleteUser(seller);
 await loginClient.auth.signOut({scope:'local'});
});
describe('license restoration HTTP contract',()=>{
 it('makes the original token usable after won using fresh public keys and CRL',async()=>{
  expect(await usable()).toBe(true);await apply(created);expect(await usable()).toBe(false);await apply(won);expect(await usable()).toBe(true);
 });
 it.each(['before','after'])('honors a manual revocation %s the dispute',async timing=>{
  if(timing==='before')await revoke();await apply(created);if(timing==='after'){await revoke();await revoke();}
  await apply(won);expect(await usable()).toBe(false);
 });
});
