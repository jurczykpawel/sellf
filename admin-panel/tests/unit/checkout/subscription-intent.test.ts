import { expect, it, vi } from 'vitest';
import recorded from '../../fixtures/stripe/dispute_payment_intent_won.json';
import type Stripe from 'stripe';
const state=vi.hoisted(()=>({list:vi.fn(async()=>({data:[]}))}));
vi.mock('@/lib/stripe/server',()=>({getStripeServer:async()=>({checkout:{sessions:{list:state.list}}})}));
import { handlePaymentIntentSucceeded } from '@/app/api/webhooks/stripe/onetime-handlers';
it('leaves a recurring support intent to its invoice handler',async()=>{
  const from=vi.fn(()=>{throw new Error('Unexpected one-time order read');});
  const intent={...recorded,receipt_email:'buyer@example.com',metadata:{product_id:'11111111-1111-4111-8111-111111111111',product_type:'subscription',subscription_id:'sub_recorded'}} as unknown as Stripe.PaymentIntent;
  expect(await handlePaymentIntentSucceeded(intent,{from} as never)).toMatchObject({processed:true});
  expect(from).not.toHaveBeenCalled();
});
