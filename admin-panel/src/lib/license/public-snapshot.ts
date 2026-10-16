/** Local public-render tier; refreshed independently of requests. @see instrumentation.ts */
import 'server-only';
import { hasFeature } from '@/lib/license/features';
import { parseFallbackKeys, verifyPlatformLicenseToken } from '@/lib/license/resolve';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';
import { normalizeLicenseDomain } from '@/lib/license-keys/domain';
import bundled from '@/lib/license/platform-jwks.json';
import type { Feature, LicenseTier } from '@/lib/license/features';
import type { SellfPublicKey } from '@/lib/license-keys/sdk';

interface PublicLicenseState {
  tier: LicenseTier; until: number; keys: SellfPublicKey[];
  timer?: ReturnType<typeof setInterval>; pending?: Promise<void>;
}
const shared = globalThis as typeof globalThis & { sellfPublicLicense?: PublicLicenseState };
const state = shared.sellfPublicLicense ??= { tier: 'free', until: 0, keys: [] };

export function getPublicLicenseTier(): LicenseTier {
  return Date.now() < state.until ? state.tier : 'free';
}
export function checkPublicFeature(feature: Feature): boolean {
  return hasFeature(getPublicLicenseTier(), feature);
}

async function refreshTier(): Promise<void> {
  const readAt = Date.now();
  const unknown = () => { state.tier = 'free'; state.until = 0; };
  try {
    const domain = normalizeLicenseDomain(getCanonicalOriginOrNull());
    if (!domain) { unknown(); return; }
    const { data, error } = await createAdminClient().from('integrations_config').select('sellf_license').eq('id', 1).single();
    if (error) { unknown(); return; }
    const keys = [...bundled.keys, ...parseFallbackKeys(), ...state.keys];
    for (const token of [data?.sellf_license, process.env.SELLF_LICENSE_KEY]) {
      if (!token) continue;
      const verified = await verifyPlatformLicenseToken(token, domain, { keys });
      if (verified.valid) {
        state.tier = verified.tier;
        state.until = Math.min(readAt + 60_000, verified.expiry === null ? Infinity : verified.expiry * 1000);
        return;
      }
    }
    state.tier = 'free'; state.until = readAt + 60_000;
  } catch { unknown(); }
}

/** Called by the background scheduler; public readers never call or await it. */
export function refreshPublicLicenseSnapshot(): Promise<void> {
  if (state.pending) return state.pending;
  state.pending = (async () => {
    await refreshTier();
    try {
      const response = await fetch(process.env.SELLF_PLATFORM_JWKS_URL ?? 'https://sellf.techskills.academy/api/licenses/jwks?seller=83789f79-bdd7-4918-af1f-e56325fa5070', {
        headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5_000), cache: 'no-store',
      });
      if (!response.ok) return;
      const body = await response.json() as { keys?: unknown };
      if (!Array.isArray(body.keys) || body.keys.length > 32) return;
      const keys = body.keys.filter((key): key is SellfPublicKey => !!key && typeof key === 'object' &&
        typeof key.kid === 'string' && key.alg === 'ES256' && typeof key.pem === 'string' && key.pem.length <= 8192);
      if (keys.length) { state.keys = keys; await refreshTier(); }
    } catch { /* Retain the last local key set during an issuer outage. */ }
  })().finally(() => { state.pending = undefined; });
  return state.pending;
}

export function startPublicLicenseRefresh(): boolean {
  if (state.timer) return false;
  state.timer = setInterval(() => { void refreshPublicLicenseSnapshot(); }, 30_000);
  state.timer.unref();
  void refreshPublicLicenseSnapshot();
  return true;
}
export function stopPublicLicenseRefresh(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = undefined; state.tier = 'free'; state.until = 0; state.keys = []; state.pending = undefined;
}
