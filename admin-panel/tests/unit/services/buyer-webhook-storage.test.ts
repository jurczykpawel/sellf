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
  expect(stored).toMatchObject(['sellf:buyer-payload:v1',{id:'d',event},expect.any(Object)]);
  expect(await readBuyerPayload(stored)).toEqual(payload);
 } finally {vi.unstubAllEnvs();}
});
it('continues a due batch after an unreadable delivery and records its attempt', async () => {
 vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
 const {storeBuyerPayload}=await import('@/lib/webhooks/buyer-payload-storage');
 try {
  const broken=await storeBuyerPayload('license.issued',{data:{licenseKey:'private-value'}});
  function changeTag(value: unknown): void {
   if (!value || typeof value !== 'object') return;
   if ('encryption_tag' in value) value.encryption_tag=Buffer.alloc(16).toString('base64');
   else Object.values(value).forEach(changeTag);
  }
  changeTag(broken);
  const rpc=vi.fn(async (name: string) => ({error:null,data:name==='pick_due_webhook_deliveries' ? [
   {id:'broken',endpoint_id:'e',event_type:'license.issued',payload:broken,attempt_count:2,max_attempts:5},
   {id:'healthy',endpoint_id:'e',event_type:'order.placed',payload:{data:{orderId:'order'}},attempt_count:1,max_attempts:5},
  ] : null}));
  const queue=new SupabaseWebhookQueue({rpc} as never);
  expect(await queue.pickDue(50)).toEqual([{id:'healthy',endpointId:'e',eventType:'order.placed',payload:{data:{orderId:'order'}},attemptCount:1,maxAttempts:5}]);
  expect(rpc).toHaveBeenCalledWith('increment_webhook_attempt',expect.objectContaining({p_log_id:'broken',p_status:'permanently_failed',p_error_message:'Stored delivery payload is unavailable',p_response_body:null,p_next_retry_at:null,p_failed_permanently_at:expect.any(String)}));
 } finally {vi.unstubAllEnvs();}
});
it.each(['order.placed','purchase.completed','license.issued'])('preserves custom storage-like fields for %s and legacy logs', async event => {
 vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
 const {storeBuyerPayload,readBuyerPayload}=await import('@/lib/webhooks/buyer-payload-storage');
 const payload={id:'d',event,buyerDelivery:{source:'crm'},data:{sealedBuyerValue:{source:'custom'},licenseKey:'signed.key',nested:[{sealedBuyerValue:'customer value',token:'another.key'}]}};
 try {
  expect(await readBuyerPayload(payload)).toEqual(payload);
  const stored=await storeBuyerPayload(event,payload);
  expect(JSON.stringify(stored)).not.toContain('signed.key');
  expect(JSON.stringify(stored)).not.toContain('another.key');
  expect(await readBuyerPayload(stored)).toEqual(payload);
 } finally {vi.unstubAllEnvs();}
});
