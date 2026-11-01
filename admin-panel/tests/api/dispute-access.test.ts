/** Buyer access and payment API contracts after recorded dispute outcomes. */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import created from '../fixtures/stripe/charge_dispute_created_needs_response.json';
import won from '../fixtures/stripe/charge_dispute_closed_won.json';
import { del, get, supabaseAdmin } from './setup';

const db=supabaseAdmin();
const product=randomUUID(),tx=randomUUID(),access=randomUUID();
let user='';
const expires=new Date(Date.now()+30*86400000).toISOString();
async function apply(event: typeof created | typeof won, closed=false): Promise<void> {
 const d=event.data.object;
 const result=await db.rpc('apply_payment_dispute',{p_transaction_id:tx,p_dispute_id:d.id,p_status:d.status,p_closed:closed,p_reason:d.reason,p_amount:d.amount,p_currency:d.currency,p_created:new Date(d.created*1000).toISOString()});
 expect(result.error).toBeNull();
}
beforeEach(async()=>{
 const account=await db.auth.admin.createUser({email:`dispute-api-${product}@example.com`,email_confirm:true});expect(account.error).toBeNull();user=account.data.user!.id;
 expect((await db.from('products').insert({id:product,name:'Dispute API contract',slug:'dispute-api-'+product,price:11,currency:'PLN'})).error).toBeNull();
 expect((await db.from('payment_transactions').insert({id:tx,user_id:user,product_id:product,customer_email:account.data.user!.email!,session_id:'pi_api_'+product.replaceAll('-',''),amount:1100,currency:'PLN',status:'partially_refunded',refunded_amount:100})).error).toBeNull();
 expect((await db.from('user_product_access').insert({id:access,user_id:user,product_id:product,access_expires_at:expires})).error).toBeNull();
});
afterEach(async()=>{
 await db.from('payment_transactions').delete().eq('id',tx);await db.from('products').delete().eq('id',product);if(user)await db.auth.admin.deleteUser(user);
});
describe('dispute public API decisions',()=>{
 it('returns the restored partial payment and its original access expiration',async()=>{
  await apply(created);await apply(won,true);await apply(won,true);
  const payment=await get<{data:{status:string}}>('/api/v1/payments/'+tx);expect(payment.status).toBe(200);expect(payment.data.data.status).toBe('partially_refunded');
  const grant=await get<{data:{expires_at:string}}>('/api/v1/users/'+user+'/access/'+access);expect(grant.status).toBe(200);expect(new Date(grant.data.data.expires_at).toISOString()).toBe(expires);
 });
 it('lets the seller revoke suspended access and keeps that decision after won',async()=>{
  await apply(created);
  expect((await del('/api/v1/users/'+user+'/access/'+access)).status).toBe(204);
  await apply(won,true);
  expect((await get('/api/v1/users/'+user+'/access/'+access)).status).toBe(404);
 });
});
