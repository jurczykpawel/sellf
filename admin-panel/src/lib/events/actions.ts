'use server';
/** Private event operations. @see @/lib/events/schema */
import { getLocale, getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { withAdminAuth } from '@/lib/actions/admin-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { resolveCurrentTier } from '@/lib/license/resolve';
import { hasFeature } from '@/lib/license/features';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';
import { participantCsv } from '@/lib/events/presentation';
import type { ActionResponse } from '@/lib/actions/admin-auth';
import type { PurchasedEvent, EventOrder } from '@/lib/events/presentation';
interface Availability { starts_at: string; timezone: string; title: string | null; venue: string | null; extra_days: string | null; id: string; remaining: number | null; sold_out: boolean; current_tier: { price: number; seats_left: number | null; ends_at: string | null } | null; next_tier_price: number | null; cheaper_sold_out: boolean }
export interface EventAdminInfo { availability: Availability; sold: number; held: number; orders: EventOrder[] }
export async function getEventAdmin(sessionId: string, offset = 0): Promise<ActionResponse<EventAdminInfo>> {
  return withAdminAuth<EventAdminInfo>(async () => {
    if (!z.string().uuid().safeParse(sessionId).success || !Number.isSafeInteger(offset) || offset < 0) return { success: false, error: 'Invalid session' };
    const { data, error } = await createAdminClient().rpc('event_session_admin', { p_session_id: sessionId, p_offset: offset });
    return error || !data ? { success: false, error: 'Event unavailable' } : { success: true, data: data as unknown as EventAdminInfo };
  });
}
export async function exportEventParticipants(sessionId: string): Promise<ActionResponse<string>> {
  return withAdminAuth<string>(async ({ user }) => {
    if (!z.string().uuid().safeParse(sessionId).success) return { success: false, error: 'Invalid session' };
    if (!hasFeature(await resolveCurrentTier(), 'csv-export')) return { success: false, error: 'CSV export requires a Sellf license' };
    if (!await checkRateLimit(RATE_LIMITS.ADMIN_EXPORT.actionType, RATE_LIMITS.ADMIN_EXPORT.maxRequests, RATE_LIMITS.ADMIN_EXPORT.windowMinutes, user.id)) return { success: false, error: 'Rate limit exceeded' };
    const db = createAdminClient(); const orders: EventOrder[] = [];
    const locale = await getLocale(); const t = await getTranslations('events');
    let session: EventAdminInfo['availability'];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await db.rpc('event_session_admin', { p_session_id: sessionId, p_offset: offset });
      if (error || !data) return { success: false, error: 'Event unavailable' };
      session = (data as unknown as EventAdminInfo).availability;
      const page = (data as unknown as EventAdminInfo).orders; orders.push(...page);
      if (page.length < 100) break;
    }
    return { success: true, data: participantCsv(orders.filter(o => o.status === 'confirmed'), { locale, t, session: session! }) };
  });
}
export async function getMyEventSessions(productId: string): Promise<PurchasedEvent[]> {
  if (!z.string().uuid().safeParse(productId).success) return [];
  const db = await createClient(); const { data: { user } } = await db.auth.getUser(); if (!user) return [];
  const { data, error } = await db.rpc('my_event_sessions', { p_product_id: productId });
  return error ? [] : data as unknown as PurchasedEvent[];
}
