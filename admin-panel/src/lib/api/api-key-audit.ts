/**
 * Shared writer for api_key_audit_log rows.
 *
 * api_key_audit_log only grants authenticated a SELECT policy (admins reading
 * the history of their own keys) — every insert must go through the
 * service-role (platform) client, never the session-scoped one.
 *
 * A failed audit write must never fail the caller's request: this helper
 * swallows and logs the error instead of throwing, so every call site shares
 * the same fail-open behavior.
 */

import { createPlatformClient } from '@/lib/supabase/admin';
import type { Json } from '@/types/database';

export type ApiKeyAuditEventType =
  | 'created'
  | 'rotated'
  | 'revoked'
  | 'deactivated'
  | 'reactivated'
  | 'expired'
  | 'used_after_revoke';

export async function logApiKeyAuditEvent(
  apiKeyId: string,
  eventType: ApiKeyAuditEventType,
  eventData: Record<string, Json> = {}
): Promise<void> {
  const platformClient = createPlatformClient();
  const { error } = await platformClient.from('api_key_audit_log').insert({
    api_key_id: apiKeyId,
    event_type: eventType,
    event_data: eventData,
  });

  if (error) {
    console.error('[logApiKeyAuditEvent] Error logging event:', eventType, error);
  }
}
