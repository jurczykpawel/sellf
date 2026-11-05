/** Receiver decisions through the Stripe HTTP route, real local SQL and signed delivery queue. */
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { NextRequest } from 'next/server';
import created from '../fixtures/stripe/charge_dispute_created_needs_response.json';
import won from '../fixtures/stripe/charge_dispute_closed_won.json';
import charge from '../fixtures/stripe/dispute_charge_won.json';
import payment from '../fixtures/stripe/dispute_payment_intent_won.json';
import refundedCharge from '../fixtures/stripe/charge_full_current.json';
import { getTestDatabaseContainer } from '../helpers/database-container';
import { createAdminClient } from '@/lib/supabase/admin';

const mock = vi.hoisted(() => ({ stripe: {} as Record<string, unknown>, signature: '', deliveries: [] as Array<{ body: string; headers: Record<string,string> }> }));
vi.mock('@/lib/stripe/server', () => ({ getStripeServer: async () => mock.stripe,
  verifyWebhookSignature: async (body: string, signature: string) => new Stripe('sk_test_fixture').webhooks.constructEvent(body,signature,'whsec_fixture') }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'stripe-signature': mock.signature }) }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, RATE_LIMITS: { STRIPE_WEBHOOK: {} } }));
vi.mock('@/lib/validations/webhook', async original => ({ ...await original<typeof import('@/lib/validations/webhook')>(), validateWebhookUrlAsync: async () => ({ valid: true }) }));
vi.mock('undici', async original => ({ ...await original<typeof import('undici')>(), fetch: async (_url: string, init: { body: string; headers: Record<string,string> }) => {
  mock.deliveries.push({ body: init.body, headers: init.headers });return new Response('{}',{ status: 200 });
} }));
import { POST } from '@/app/api/webhooks/stripe/route';
import { verifyPaymentSession } from '@/lib/payment/verify-payment';

const product=payment.metadata.product_id;
const buyer='e1172000-0000-4000-a000-000000000002';
const tx='e1172000-0000-4000-a000-000000000003';
const endpoint='e1172000-0000-4000-a000-000000000004';
function sql(value: string): void { execFileSync('docker',['exec','-i',getTestDatabaseContainer(),'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:value,stdio:['pipe','pipe','pipe']}); }
function storePayment(status = 'completed'): void {
 sql(`INSERT INTO public.payment_transactions(id,user_id,product_id,customer_email,session_id,stripe_payment_intent_id,amount,currency,status)
 VALUES('${tx}','${buyer}','${product}','dispute-route@example.com','${charge.payment_intent}','${charge.payment_intent}',${charge.amount},'PLN','${status}');
 INSERT INTO public.user_product_access(user_id,product_id,access_granted_at,access_expires_at) VALUES('${buyer}','${product}',now()-interval '1 day',now()+interval '30 days');`);
}
async function deliver(record: typeof created | typeof won, object: unknown = record.data.object, envelopeCreated = Math.floor(Date.now()/1000)): Promise<Response> {
 // The recorded business object is unchanged; the local delivery has a fresh envelope time/signature.
 const body=JSON.stringify({ ...record,created:envelopeCreated,data:{...record.data,object} });
 mock.signature=Stripe.webhooks.generateTestHeaderString({ payload:body,secret:'whsec_fixture' });
 return POST(new NextRequest('http://localhost/api/webhooks/stripe',{method:'POST',body}));
}
beforeEach(()=>{
 mock.deliveries=[];
 mock.stripe={ charges:{ retrieve:vi.fn().mockResolvedValue(charge) },disputes:{ retrieve:vi.fn().mockResolvedValue(created.data.object) },
   paymentIntents:{ retrieve:vi.fn().mockResolvedValue(payment) },checkout:{sessions:{list:vi.fn().mockResolvedValue({data:[]})}} };
 sql(`INSERT INTO public.products(id,name,slug,price,currency) VALUES('${product}','Dispute receiver','dispute-receiver',11,'PLN');
 INSERT INTO auth.users(id,email) VALUES('${buyer}','dispute-route@example.com');
 INSERT INTO public.webhook_endpoints(id,url,secret,events,is_active) VALUES('${endpoint}','https://receiver.example/contract','fixture-receiver-secret',ARRAY['dispute.created','dispute.closed'],true);`);
});
afterEach(()=>sql(`DELETE FROM public.webhook_endpoints WHERE id='${endpoint}'; DELETE FROM public.payment_transactions WHERE product_id='${product}'; DELETE FROM public.products WHERE id='${product}'; DELETE FROM auth.users WHERE id='${buyer}';`));
describe('dispute HTTP consumer contract',()=>{
 it('does not report an expired suspended grant as restored on the cached payment path',async()=>{
  storePayment();
  sql(`UPDATE public.user_product_access SET access_granted_at=now()-interval '2 days',access_expires_at=now()-interval '1 day' WHERE user_id='${buyer}';`);
  const result=await verifyPaymentSession(String(charge.payment_intent));
  expect(result.access_granted).toBe(false);
 });
 it('requests redelivery before storage, then restores access and emits one signed closing decision',async()=>{
  expect((await deliver(created)).status).toBe(500);
  storePayment();
  expect((await deliver(created)).status).toBe(200);
  expect((await deliver(won)).status).toBe(200);
  expect((await deliver(won)).status).toBe(200);
  expect((await deliver(created)).status).toBe(200);
  expect(mock.deliveries).toHaveLength(2);
  for(const delivery of mock.deliveries){
   const parts=Object.fromEntries(delivery.headers['X-Sellf-Signature'].split(',').map(x=>x.split('=')));
   expect(parts.v1).toBe(createHmac('sha256','fixture-receiver-secret').update(parts.t+'.'+delivery.body).digest('hex'));
  }
  const closing=mock.deliveries.map(x=>JSON.parse(x.body)).find(x=>x.event==='dispute.closed');
  expect(closing.data).toMatchObject({customer:{userId:buyer},product:{id:product,name:'Dispute receiver',slug:'dispute-receiver'},payment:{id:tx,paymentIntentId:charge.payment_intent,statusAfter:'completed'},
   dispute:{stripeDisputeId:won.data.object.id,status:'won',amount:won.data.object.amount,currency:'PLN',accessRevoked:false,accessRestored:true,licenseRestored:false}});
  sql(`DO $test$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.user_product_access WHERE user_id='${buyer}' AND access_expires_at>now()) THEN RAISE EXCEPTION 'Buyer has no access'; END IF; END $test$;`);
 });
 it('notifies the receiver once when a guest entitlement returns after won',async()=>{
  storePayment();
  sql(`DELETE FROM public.user_product_access WHERE user_id='${buyer}';
   UPDATE public.payment_transactions SET user_id=NULL WHERE id='${tx}';
   UPDATE public.products SET auto_grant_duration_days=30 WHERE id='${product}';
   INSERT INTO public.guest_purchases(product_id,customer_email,session_id,transaction_amount,transaction_id,created_at)
    VALUES('${product}','dispute-route@example.com','${charge.payment_intent}',${charge.amount},'${tx}',now()-interval '1 day');
   UPDATE public.webhook_endpoints SET events=ARRAY['dispute.closed','access.updated'] WHERE id='${endpoint}';`);
  expect((await deliver(created)).status).toBe(200);
  expect((await deliver(won)).status).toBe(200);
  expect((await deliver(won)).status).toBe(200);
  const events=mock.deliveries.map(x=>JSON.parse(x.body));
  const restored=events.find(x=>x.event==='dispute.closed').data.dispute.restoredAccess[0];
  expect(events.filter(x=>x.event==='access.updated')).toHaveLength(1);
  const savedOrder=await createAdminClient().from('payment_transactions').select('order_number').eq('id',tx).single();
  expect(savedOrder.error).toBeNull();
  expect(events.find(x=>x.event==='access.updated').data).toMatchObject({
   customer:{userId:null,email:'dispute-route@example.com'},product:{id:product,name:'Dispute receiver',slug:'dispute-receiver'},
   sourceOrder:{id:tx,orderNumber:savedOrder.data!.order_number},
   actor:{type:'system',id:null},
   reason:'dispute_won',accessGrantedAt:restored.grantedAt,accessExpiresAt:restored.expiresAt,
   access:{id:restored.guestPurchaseId,grantedAt:restored.grantedAt,expiresAt:restored.expiresAt,statusAfter:'active'},
  });
 });
 it('does not announce restoration for a guest whose original term elapsed',async()=>{
  storePayment();
  sql(`DELETE FROM public.user_product_access WHERE user_id='${buyer}';
   UPDATE public.payment_transactions SET user_id=NULL WHERE id='${tx}';
   UPDATE public.products SET auto_grant_duration_days=1 WHERE id='${product}';
   INSERT INTO public.guest_purchases(product_id,customer_email,session_id,transaction_amount,transaction_id,created_at)
    VALUES('${product}','dispute-route@example.com','${charge.payment_intent}',${charge.amount},'${tx}',now()-interval '2 days');
   UPDATE public.webhook_endpoints SET events=ARRAY['dispute.closed','access.updated'] WHERE id='${endpoint}';`);
  expect((await deliver(created)).status).toBe(200);
  expect((await deliver(won)).status).toBe(200);
  expect(mock.deliveries.map(x=>JSON.parse(x.body))).toMatchObject([
   {event:'dispute.closed',data:{dispute:{accessRestored:false,restoredAccess:[]}}},
  ]);
 });
 it('includes the resolved intent even for a legacy transaction stored by session only',async()=>{
  storePayment();sql(`UPDATE public.payment_transactions SET stripe_payment_intent_id=NULL WHERE id='${tx}';`);
  expect((await deliver(created)).status).toBe(200);
  expect(JSON.parse(mock.deliveries[0].body).data.payment.paymentIntentId).toBe(charge.payment_intent);
 });
 it('resolves a missing event intent from the provider before treating the dispute as unrelated',async()=>{
  storePayment();const c=structuredClone(charge) as Partial<typeof charge>;delete c.payment_intent;
  const d=structuredClone(created.data.object) as Partial<typeof created.data.object>;delete d.payment_intent;
  mock.stripe.charges={retrieve:vi.fn().mockResolvedValue(c)};
  expect((await deliver(created,d)).status).toBe(200);expect(mock.deliveries).toHaveLength(1);
 });
 it('keeps a delayed local dispute retriable until its payment is stored',async()=>{
  expect((await deliver(created,created.data.object,created.created)).status).toBe(500);
 });
 it('waits for a locally pending payment before suspending its rights',async()=>{
  storePayment('pending');
  expect((await deliver(created)).status).toBe(500);expect(mock.deliveries).toHaveLength(0);
  sql(`UPDATE public.payment_transactions SET status='completed' WHERE id='${tx}';`);
  expect((await deliver(created)).status).toBe(200);
  expect((await deliver(won)).status).toBe(200);
  expect(JSON.parse(mock.deliveries.at(-1)!.body).data.dispute.accessRestored).toBe(true);
 });
 it('waits for a provider-confirmed full refund before applying won',async()=>{
  storePayment();expect((await deliver(created)).status).toBe(200);
  // Normalize only resource identifiers between the two recorded charge states.
  mock.stripe.charges={retrieve:vi.fn().mockResolvedValue({...refundedCharge,id:charge.id,payment_intent:charge.payment_intent})};
  expect((await deliver(won)).status).toBe(500);expect(mock.deliveries).toHaveLength(1);
  sql(`UPDATE public.payment_transactions SET status='refunded',refunded_amount=amount WHERE id='${tx}'; DELETE FROM public.user_product_access WHERE user_id='${buyer}';`);
  expect((await deliver(won)).status).toBe(200);
  expect(JSON.parse(mock.deliveries.at(-1)!.body).data).toMatchObject({payment:{statusAfter:'refunded'},dispute:{accessRestored:false,restoredAccess:[]}});
 });
 it('also requests redelivery for a closing notification before payment storage',async()=>{
  expect((await deliver(won)).status).toBe(500);expect(mock.deliveries).toHaveLength(0);
 });
 it('uses the dispute payment binding when the optional charge payment intent is absent',async()=>{
  storePayment();const c=structuredClone(charge) as Partial<typeof charge>;delete c.payment_intent;
  mock.stripe.charges={retrieve:vi.fn().mockResolvedValue(c)};
  expect((await deliver(created)).status).toBe(200);expect(mock.deliveries).toHaveLength(1);
 });
 it('delivers the terminal outcome when resolving an older incomplete notification',async()=>{
  storePayment();const d=structuredClone(created.data.object) as Partial<typeof created.data.object>;delete d.charge;
  mock.stripe.disputes={retrieve:vi.fn().mockResolvedValue(won.data.object)};
  expect((await deliver(created,d)).status).toBe(200);
  expect(mock.deliveries.map(x=>JSON.parse(x.body))).toMatchObject([{event:'dispute.closed',data:{dispute:{status:'won',accessRestored:false}}}]);
 });
 it('retrieves optional charge information instead of losing the outcome',async()=>{
  storePayment();const d=structuredClone(created.data.object) as Partial<typeof created.data.object>;delete d.charge;
  expect((await deliver(created,d)).status).toBe(200);expect(mock.deliveries).toHaveLength(1);
 });
});
