/**
 * In-process telemetry scheduler. Mirrors src/lib/supabase/keep-alive.ts:
 * module-level timers, idempotent start, defer first attempt off cold start,
 * then tick on an interval while the (long-lived PM2) process is alive.
 *
 * The DB claim (claimSend) is the real cadence gate — the interval just wakes
 * the cycle up; runTelemetryCycle() no-ops when the send window hasn't elapsed.
 *
 * @see ./send.ts — runTelemetryCycle (claim -> collect -> post -> confirm)
 * @see ./config.ts — isTelemetryEnabled / isNonDeploymentHost
 * @see ./constants.ts — BOOT_DELAY_MS / POLL_INTERVAL_MS
 */
import { BOOT_DELAY_MS, POLL_INTERVAL_MS } from './constants';
import { isNonDeploymentHost, isTelemetryEnabled } from './config';
import { runTelemetryCycle } from './send';

let intervalTimer: ReturnType<typeof setInterval> | undefined;
let initialTimer: ReturnType<typeof setTimeout> | undefined;

/** Resolve the deployment hostname from the configured public/base URL env vars. */
function hostFromEnv(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || process.env.MAIN_DOMAIN || '';
  try {
    return raw ? new URL(raw.includes('://') ? raw : `https://${raw}`).hostname : '';
  } catch {
    return raw;
  }
}

/**
 * Idempotent — returns `true` if scheduling happened, `false` otherwise.
 *
 * No-op when:
 *   - already armed
 *   - NODE_ENV !== 'production'
 *   - telemetry is disabled (opt-out via SELLF_TELEMETRY_DISABLED / SELLF_TELEMETRY_ENABLED)
 *   - the deployment host is a non-deployment host (localhost / private / dotless)
 *
 * NOTE: timers are intentionally NOT unref()'d — the long-lived PM2 process
 * should keep firing the cycle.
 */
export function startTelemetry(): boolean {
  if (intervalTimer) return false;
  if (process.env.NODE_ENV !== 'production') return false;
  if (!isTelemetryEnabled()) return false;
  if (isNonDeploymentHost(hostFromEnv())) return false;

  initialTimer = setTimeout(() => {
    void runTelemetryCycle();
  }, BOOT_DELAY_MS);

  intervalTimer = setInterval(() => {
    void runTelemetryCycle();
  }, POLL_INTERVAL_MS);

  return true;
}

/** Stop scheduled cycles. Mainly for tests. */
export function stopTelemetry(): void {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = undefined;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = undefined;
  }
}

/** Whether a telemetry timer is currently scheduled. */
export function isTelemetryRunning(): boolean {
  return Boolean(intervalTimer);
}
