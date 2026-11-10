/** Real refund entry points must commit revocation of every order license. */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import recorded from '../../fixtures/stripe/refund_list_full.json';

const h=vi.hoisted(()=>({db:null as SupabaseClient<Database>|null,actor:''}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn(),revalidateTag:vi.fn()}));
vi.mock('@/lib/auth-server',()=>({requireAdminApiWithRequest:async()=>({user:{id:h.actor}})}));
vi.mock('@/lib/actions/admin-auth',()=>({withAdminClient:async(fn:(ctx:{user:{id:string};dataClient:SupabaseClient<Database>})=>Promise<unknown>)=>fn({user:{id:h.actor},dataClient:h.db!})}));
vi.mock('@/lib/api',async original=>({...await original<typeof import('@/lib/api')>(),authenticate:async()=>({supabase:h.db,admin:{userId:h.actor},method:'session'})}));
vi.mock('@/lib/rate-limiting',async original=>({...await original<typeof import('@/lib/rate-limiting')>(),checkRateLimit:async()=>true}));
vi.mock('@/lib/stripe/server',()=>({getStripeServer:async()=>({refunds:{create:async()=>recorded.data[0]}})}));
import { createAdminClient } from '@/lib/supabase/admin';
import { processRefund } from '@/lib/actions/payment';
import { POST as adminRefund } from '@/app/api/admin/payments/refund/route';
import { POST as apiRefund } from '@/app/api/v1/payments/[id]/refund/route';
import { PATCH as approve } from '@/app/api/v1/refund-requests/[id]/route';
const db=createAdminClient();h.db=db;
let tx:string,main:string,bump:string;
beforeEach(async()=>{
  tx=randomUUID();main=randomUUID();bump=randomUUID();
  const user=await db.auth.admin.createUser({email:`entry-${tx}@example.com`,email_confirm:true});expect(user.error).toBeNull();h.actor=user.data.user!.id;
  expect((await db.from('products').insert([{id:main,name:'Refund main',slug:main,price:10,currency:'PLN',seller_id:h.actor},{id:bump,name:'Refund bump',slug:bump,price:1,currency:'PLN',seller_id:h.actor}])).error).toBeNull();
  expect((await db.from('payment_transactions').insert({id:tx,product_id:main,customer_email:'buyer@example.com',amount:recorded.data[0].amount,currency:'PLN',status:'completed',payment_provider:'bank_transfer',settled_via:'stripe',pricing_snapshot_version:1,stripe_payment_intent_id:`pi_${tx.replaceAll('-','')}`})).error).toBeNull();
  expect((await db.from('issued_licenses').insert([main,bump].map(product_id=>({product_id,seller_id:h.actor,email:'buyer@example.com',order_id:tx,kid:'fixture',license_key:`original-${product_id}`})))).error).toBeNull();
});
afterEach(async()=>{
  await db.from('payment_transactions').delete().eq('id',tx);
  await db.from('products').delete().in('id',[main,bump]);
  await db.auth.admin.deleteUser(h.actor);
});
describe('full refund entry points on quick-pay order with licensed bump',()=>{
  it.each(['admin API','server action','API v1','buyer approval'])('%s revokes both licenses in the database transaction',async entry=>{
    if(entry==='server action')expect(await processRefund({transactionId:tx,reason:'requested_by_customer'})).toMatchObject({success:true});
    else{
      let response:Response;
      if(entry==='buyer approval'){
        const id=randomUUID();
        expect((await db.from('refund_requests').insert({id,transaction_id:tx,product_id:main,customer_email:'buyer@example.com',requested_amount:recorded.data[0].amount,currency:'PLN',status:'pending'})).error).toBeNull();
        response=await approve(new NextRequest('http://localhost/api/v1/refund-requests/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve'})}),{params:Promise.resolve({id})});
      }else{
        const request=new NextRequest('http://localhost/api/refund',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transactionId:tx,reason:'requested_by_customer'})});
        response=entry==='admin API'?await adminRefund(request):await apiRefund(request,{params:Promise.resolve({id:tx})});
      }
      expect(response.ok,await response.text()).toBe(true);
    }
    const licenses=await db.from('issued_licenses').select('revoked_at,revocation_reason,license_key').eq('order_id',tx);
    expect(licenses.error).toBeNull();expect(licenses.data).toHaveLength(2);
    expect(licenses.data!.every(row=>row.revoked_at&&row.revocation_reason==='refund'&&row.license_key.startsWith('original-'))).toBe(true);
    expect((await db.from('business_events').select('id').eq('event_type','license.revoked').in('product_id',[main,bump])).data).toHaveLength(2);
  });
});
