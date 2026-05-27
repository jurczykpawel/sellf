/**
 * Daily Supabase no-op ping to keep the free-tier project from auto-pausing
 * after 7 days of zero activity. Runs once at startup and every 24h while the
 * server process is alive.
 *
 * Self-contained: opt-out with `SUPABASE_KEEP_ALIVE=false`, skipped outside
 * production, no impact on cold-start latency (initial ping deferred 30s).
 */
import { createAdminClient } from '@/lib/supabase/admin';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 30 * 1000;

let intervalTimer: ReturnType<typeof setInterval> | undefined;
let initialTimer: ReturnType<typeof setTimeout> | undefined;

async function ping(): Promise<void> {
  try {
    const client = createAdminClient();
    const start = Date.now();
    const { error } = await client
      .from('products')
      .select('id', { head: true, count: 'estimated' })
      .limit(0);
    const ms = Date.now() - start;
    if (error) {
      console.warn(`[supabase-keep-alive] ping failed (${ms}ms): ${error.message}`);
    } else {
      console.log(`[supabase-keep-alive] ping ok (${ms}ms)`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.warn(`[supabase-keep-alive] ping error: ${msg}`);
  }
}

/**
 * Idempotent — returns `true` if scheduling happened, `false` otherwise.
 *
 * No-op when:
 *   - NODE_ENV !== 'production'
 *   - SUPABASE_KEEP_ALIVE is set to 'false' (opt-out)
 *   - SUPABASE_SERVICE_ROLE_KEY missing (can't authenticate ping)
 *   - SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL both missing
 *   - already scheduled
 */
export function startKeepAlive(): boolean {
  if (intervalTimer) return false;
  if (process.env.NODE_ENV !== 'production') return false;
  if (process.env.SUPABASE_KEEP_ALIVE === 'false') return false;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) return false;

  initialTimer = setTimeout(() => {
    void ping();
  }, INITIAL_DELAY_MS);

  intervalTimer = setInterval(() => {
    void ping();
  }, TWENTY_FOUR_HOURS_MS);

  return true;
}

/** Stop scheduled pings. Mainly for tests. */
export function stopKeepAlive(): void {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = undefined;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = undefined;
  }
}

/** Whether a keep-alive timer is currently scheduled. */
export function isKeepAliveRunning(): boolean {
  return Boolean(intervalTimer);
}
