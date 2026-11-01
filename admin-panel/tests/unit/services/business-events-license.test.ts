/** Committed license changes become stable consumer notifications. */
import { beforeEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({trigger:vi.fn(),saved:[] as string[],pending:true}));
vi.mock('@/lib/services/webhook-service',()=>({WebhookService:{trigger:h.trigger}}));
vi.mock('@/lib/utils/canonical-url',()=>({getCanonicalOriginOrNull:()=> 'https://shop.example'}));
import { runBusinessEvents } from '@/lib/services/business-events';
const row={id:'license-id',product_id:'product-id',email:'buyer@example.com',order_id:'order-id',seller_id:'seller-id',original_seller_id:'seller-id',license_domain:null,issuance_source:'purchase',issued_at:'2026-01-01T00:00:00Z',expires_at:'2026-12-01T00:00:00Z',revoked_at:null,products:{name:'Course',slug:'course',license_tier:'pro'},license_key:'not-part-of-the-notification'};
const event={id:'event-id',event_type:'license.restored',product_id:'product-id',created_at:'2026-02-01T00:00:00Z',payload:{licenseRow:row,disputeId:'dispute-id'}};
const db={rpc:vi.fn(async(name:string)=>({data:name==='claim_business_events'&&h.pending?[event]:[],error:null})),from:()=>({update:()=>({eq:async(_key:string,id:string)=>{h.saved.push(id);h.pending=false;return{error:null};}})})};
beforeEach(()=>{h.saved=[];h.pending=true;vi.clearAllMocks();h.trigger.mockResolvedValue(undefined);});
it('publishes the license contract and retains the committed delivery identity',async()=>{
 expect(await runBusinessEvents(db as never)).toEqual({processed:1,errors:0});
 expect(h.trigger).toHaveBeenCalledWith('license.restored',expect.objectContaining({license:expect.objectContaining({id:'license-id',expiresAt:row.expires_at,revokedAt:null,restoredAt:event.created_at}),dispute:{stripeDisputeId:'dispute-id'}}),db,'product-id','business_event-id');
 expect(JSON.stringify(h.trigger.mock.calls)).not.toContain('not-part-of-the-notification');
 await runBusinessEvents(db as never);expect(h.trigger).toHaveBeenCalledTimes(1);
});
it('keeps a failed queue handoff pending rather than consuming the committed change',async()=>{
 h.trigger.mockRejectedValueOnce(new Error('Queue unavailable'));
 expect(await runBusinessEvents(db as never)).toEqual({processed:0,errors:1});expect(h.saved).toEqual([]);
 expect(await runBusinessEvents(db as never)).toEqual({processed:1,errors:0});
});
