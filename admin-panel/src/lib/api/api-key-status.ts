/**
 * Client-safe API key lifecycle status, matching verify_api_key.
 * is_active denotes normal operation; retired keys can still have a grace window.
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */
interface ApiKeyLifecycle {
  is_active: boolean;
  revoked_at: string | null;
  expires_at: string | null;
  rotation_grace_until: string | null;
}

type ApiKeyStatus = 'active' | 'grace' | 'inactive' | 'expired' | 'revoked';

export function getApiKeyStatus(key: ApiKeyLifecycle, now: number = Date.now()): ApiKeyStatus {
  if (key.revoked_at) return 'revoked';
  if (key.expires_at && Date.parse(key.expires_at) < now) return 'expired';
  if (key.is_active) return 'active';
  if (key.rotation_grace_until) {
    return Date.parse(key.rotation_grace_until) > now ? 'grace' : 'expired';
  }
  return 'inactive';
}
