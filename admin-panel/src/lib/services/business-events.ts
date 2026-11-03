/** Committed business changes handed to the signed, persistent delivery queue. @see supabase/migrations/20261028184757_business_event_delivery.sql */
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { minorOrderLines } from '@/lib/orders/event-money';
import { WebhookService } from '@/lib/services/webhook-service';
import { buildLicenseRevokeWebhookData, buildLicenseRestoreWebhookData } from '@/lib/services/license-revoke-webhook-payload';
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';
import type { RevokedLicenseRow } from '@/lib/services/license-revoke-webhook-payload';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { AuthResult } from '@/lib/api';

export interface EventActor { type: 'user' | 'api_key'; id: string }
export function accessActor(auth: AuthResult): EventActor {
  return { type: auth.method === 'api_key' ? 'api_key' : 'user', id: auth.method === 'api_key' ? auth.apiKey.id : auth.admin.userId };
}
export function mutateAccess(db: SupabaseClient<Database>, action: 'grant' | 'update' | 'revoke', userId: string, actor: EventActor, values: Record<string, string | number | null> = {}, accessId?: string, productId?: string) {
  return db.rpc('mutate_access', { p_action: action, p_user_id: userId, p_actor: { ...actor }, p_values: values, p_access_id: accessId, p_product_id: productId });
}
export async function runBusinessEvents(db = createAdminClient()): Promise<{ processed: number; errors: number }> {
  const swept = await db.rpc('capture_expired_access');
  const lapsed = await db.rpc('capture_expired_licenses');
  const claimed = await db.rpc('claim_business_events');
  if (swept.error || lapsed.error || claimed.error) { console.error('[business-events] Queue unavailable'); return { processed: 0, errors: 1 }; }
  let processed = 0, errors = 0;
  for (const event of claimed.data ?? []) {
    try {
      const data = event.payload as Record<string, any>;
      let payload: unknown = event.event_type === 'order.abandoned' ? { ...data, lines: minorOrderLines(data.lines ?? []) } : data;
      if (event.event_type.startsWith('license.')) {
        const row = data.licenseRow as RevokedLicenseRow;
        const origin = getCanonicalOriginOrNull() ?? '';
        const licensePayload = event.event_type === 'license.restored'
          ? buildLicenseRestoreWebhookData(row, origin, event.created_at)
          : buildLicenseRevokeWebhookData(row, origin);
        payload = { ...licensePayload, ...(data.disputeId && { dispute: { stripeDisputeId: data.disputeId } }) };
      }
      const productIds = event.event_type === 'order.abandoned'
        ? [...new Set([event.product_id, ...(data.lines ?? []).map((line: { product_id: string | null }) => line.product_id).filter(Boolean)])] : event.product_id;
      await WebhookService.trigger(event.event_type, payload, db, productIds, `business_${event.id}`);
      const saved = await db.from('business_events').update({ dispatched_at: new Date().toISOString() }).eq('id', event.id);
      if (saved.error) throw Error('Event handoff unavailable');
      processed++;
    } catch { console.error('[business-events] Event awaiting retry:', event.id); errors++; }
  }
  return { processed, errors };
}
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
/** PM2 runtime handles expiry and pending changes even without an external cron. */
export function startBusinessEvents(): void {
  if (timer || process.env.E2E_MODE === 'true' || process.env.NODE_ENV !== 'production' || process.env.NEXT_PHASE === 'phase-production-build') return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void runBusinessEvents().catch(() => console.error('[business-events] Cycle unavailable')).finally(() => { running = false; });
  }, 30_000);
  timer.unref();
}
export function stopBusinessEvents(): void { if (timer) clearInterval(timer); timer = undefined; }
