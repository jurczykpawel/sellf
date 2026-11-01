/** Restored license notifications follow the same seller feature contract as revocation. */
import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({ feature:vi.fn(),endpoints:vi.fn() }));
vi.mock('@/lib/webhooks/endpoint-selection',()=>({fetchEligibleEndpoints:mocks.endpoints}));
vi.mock('@/lib/license/resolve',()=>({checkFeature:mocks.feature}));
import { WebhookService } from '@/lib/services/webhook-service';
import { findDeniedEventFeature } from '@/lib/webhooks/event-feature-gate';
import { WEBHOOK_EVENTS } from '@/types/webhooks';
import { WEBHOOK_EVENT_TYPES } from '@/lib/validations/webhook';
beforeEach(()=>{vi.clearAllMocks();mocks.feature.mockResolvedValue(false);mocks.endpoints.mockResolvedValue([]);});
it('offers the restored event in endpoint subscriptions and API validation',()=>{
 expect(WEBHOOK_EVENTS.some(x=>x.value==='license.restored')).toBe(true);
 expect(WEBHOOK_EVENT_TYPES).toContain('license.restored');
});
it('denies a restored-event subscription without the existing Pro license notification feature',async()=>{
 expect(await findDeniedEventFeature(['license.restored'])).toEqual({event:'license.restored',feature:'license-revoked-webhook'});
});

it.each(['license.revoked','license.restored'])('does not materialize %s deliveries without Pro',async event=>{
 await WebhookService.trigger(event,{license:{id:'license-fixture'}},{from:()=>{throw Error('Unexpected data read');}});
 expect(mocks.feature).toHaveBeenCalledWith('license-revoked-webhook',expect.anything());
 expect(mocks.endpoints).not.toHaveBeenCalled();
});
