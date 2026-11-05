import { expect, it, vi } from 'vitest';
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';
it.each(['license.issued','order.participants_needed'])('retains %s delivery data for retries without storing readable credentials in logs', async eventType => {
 vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
 const payload = { id:'delivery-1', data:{licenseKey:'signed.key',reminder:{participantsUrl:'https://example.com/participants?token=personal'}} };
 let stored: unknown;
 const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
  if (name==='enqueue_webhook_delivery') stored=args.p_payload;
  return { data:[{ id:'delivery-1',endpoint_id:'e',event_type:eventType,payload:stored,attempt_count:0,max_attempts:5 }],error:null };
 });
 try {
  const queue = new SupabaseWebhookQueue({rpc} as never);
  const first = await queue.enqueue({endpointId:'e',eventType,payload,deliveryId:'delivery-1',deliveryKey:null});
  expect(JSON.stringify(stored)).not.toContain('signed.key');
  expect(JSON.stringify(stored)).not.toContain('personal');
  expect(first?.payload).toEqual(payload);
  expect((await queue.pickDue(1))[0].payload).toEqual(payload);
 } finally { vi.unstubAllEnvs(); }
});
it.each([
 ['purchase.completed',{ licenses:[{token:'purchase.key',productId:'p'}] }],
 ['lead.captured',{ license:{token:'free.key',kid:'k'} }],
] as const)('keeps existing %s license delivery credentials out of readable log fields', async (event, data) => {
 vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
 const {storeBuyerPayload,readBuyerPayload}=await import('@/lib/webhooks/buyer-payload-storage');
 const payload={id:'d',event,data};
 try {
  const stored=await storeBuyerPayload(event,payload);
  expect(JSON.stringify(stored)).not.toContain('.key');
  expect(stored).toMatchObject({id:'d',event});
  expect(await readBuyerPayload(stored)).toEqual(payload);
 } finally {vi.unstubAllEnvs();}
});
