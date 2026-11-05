import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/security/safe-fetch', async original => ({ ...await original<typeof import('@/lib/security/safe-fetch')>(), getSsrfSafeAgent: () => undefined }));
vi.mock('@/lib/validations/webhook', async original => ({ ...await original<typeof import('@/lib/validations/webhook')>(), validateWebhookUrlAsync: async () => ({ valid: true }) }));
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';
import { handleWebhookDeliveriesRetry } from '@/app/api/cron/route';
import { verifyWebhookSignature } from '@/lib/services/webhook-queue/signature';
const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
it.each(['license.issued','order.participants_needed'])('retries %s as a signed complete message while keeping logs private', async event => {
 const secret=crypto.randomUUID(), id=crypto.randomUUID();
 const payload={id,event,data:{licenseKey:'delivery.signed-key',reminder:{participantsUrl:'https://example.com/participants?token=private-link'}}};
 const received: unknown[]=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  received.push({body,valid:verifyWebhookSignature(secret,body,String(req.headers['x-sellf-signature']))});
  res.writeHead(200).end(body);
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw Error('No receiver');
 let endpointId:string|undefined;
 try {
  const ep=await db.from('webhook_endpoints').insert({url:`http://127.0.0.1:${address.port}/hook`,secret,events:[event],is_active:true}).select('id').single();
  expect(ep.error).toBeNull();endpointId=ep.data!.id;
  const queue=new SupabaseWebhookQueue(db);
  await queue.enqueue({endpointId,eventType:event,payload,deliveryId:id,deliveryKey:null});
  await queue.forceRetryNow(id);
  expect((await handleWebhookDeliveriesRetry()).errors).toBe(0);
  expect(received).toEqual([{body:JSON.stringify(payload),valid:true}]);
  const log=await db.from('webhook_logs').select('payload,response_body,status').eq('id',id).single();
  expect(log.error).toBeNull();expect(log.data!.status).toBe('success');
  expect(log.data!.response_body).toBeNull();
  expect(JSON.stringify(log.data)).not.toContain('delivery.signed-key');
  expect(JSON.stringify(log.data)).not.toContain('private-link');
 } finally {
  if(endpointId){await db.from('webhook_logs').delete().eq('endpoint_id',endpointId);await db.from('webhook_endpoints').delete().eq('id',endpointId);}
  await new Promise<void>(resolve=>server.close(()=>resolve()));
 }
});
