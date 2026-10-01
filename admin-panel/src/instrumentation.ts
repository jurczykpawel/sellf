export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionStartupConfig } = await import('@/lib/security/startup-assertions');
    assertProductionStartupConfig();

    // Best-effort background starts: a load-time or runtime throw in either must
    // never break register()/boot, so each is wrapped independently.
    try {
      const { startKeepAlive } = await import('@/lib/supabase/keep-alive');
      startKeepAlive();
    } catch (error) {
      console.warn('[keep-alive] failed to start:', error);
    }

    // One-time conversion of a Meta CAPI token saved before encryption at rest.
    // Runs in the background; on any failure the stored value stays as it is
    // and is converted on the next server read instead.
    try {
      const { upgradeStoredLegacyCapiToken } = await import('@/lib/integrations/capi-token');
      const { createAdminClient } = await import('@/lib/supabase/admin');
      void upgradeStoredLegacyCapiToken(createAdminClient()).then((converted) => {
        if (converted) console.log('[capi-token] Stored Meta CAPI token converted to encrypted storage.');
      });
    } catch (error) {
      console.warn('[capi-token] legacy token conversion skipped:', error);
    }

    try {
      const { startTelemetry } = await import('@/lib/telemetry/scheduler');
      if (startTelemetry()) {
        console.log('[telemetry] Sellf sends anonymous, opt-out usage telemetry (no PII, no revenue). Disable with SELLF_TELEMETRY_DISABLED=true.');
      }
    } catch (error) {
      console.warn('[telemetry] failed to start:', error);
    }
  }
}
