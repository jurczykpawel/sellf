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
