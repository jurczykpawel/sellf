export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionStartupConfig } = await import('@/lib/security/startup-assertions');
    assertProductionStartupConfig();

    const { startKeepAlive } = await import('@/lib/supabase/keep-alive');
    startKeepAlive();

    const { startTelemetry } = await import('@/lib/telemetry/scheduler');
    if (startTelemetry()) {
      console.log('[telemetry] Sellf sends anonymous, opt-out usage telemetry (no PII, no revenue). Disable with SELLF_TELEMETRY_DISABLED=true.');
    }
  }
}
