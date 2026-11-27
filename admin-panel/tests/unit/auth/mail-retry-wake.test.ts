/**
 * A link parked while the purchase is still being stored is due after 20 s; the in-process worker
 * runs once a minute, so parking it also wakes the worker just past its due time (W351, QA3-G U2).
 * @see src/lib/auth/magic-link/retry.ts
 */
import { afterEach, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules(); });

async function loadWorker(production: boolean) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', production ? 'production' : 'test');
  vi.stubEnv('E2E_MODE', 'false');
  vi.stubEnv('NEXT_PHASE', '');
  rpc.mockReset().mockImplementation(async (name: string) => ({ data: name === 'queue_auth_mail_retry' ? true : [], error: null }));
  return import('@/lib/auth/magic-link/retry');
}
const claims = () => rpc.mock.calls.filter(([name]) => name === 'claim_auth_mail_retries').length;
const park = (worker: Awaited<ReturnType<typeof loadWorker>>, code: 'purchase_pending' | 'send_failed') => worker.queueAuthMailRetry({
  email: 'buyer@example.com', redirectTo: 'https://shop.example.com/auth/callback?redirect_to=%2Fp%2Fcourse', data: { purchase_mail_pending: 'true' }, kind: 'post_checkout', code,
});

it('wakes the worker about 21 s after a link is parked for a purchase still being stored', async () => {
  vi.useFakeTimers();
  const worker = await loadWorker(true);
  worker.startAuthMailRetries();
  // The buyer-facing result stays a queued send, never the internal queue code.
  expect(await park(worker, 'purchase_pending')).toEqual({ ok: false, code: 'send_failed', queued: true });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(claims()).toBe(0);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(claims()).toBe(1);
});

it('other refusals wait for the regular minute cycle', async () => {
  vi.useFakeTimers();
  const worker = await loadWorker(true);
  worker.startAuthMailRetries();
  await park(worker, 'send_failed');
  await vi.advanceTimersByTimeAsync(30_000);
  expect(claims()).toBe(0);
});

it('does not start a worker where the in-process worker does not run', async () => {
  vi.useFakeTimers();
  const worker = await loadWorker(false);
  worker.startAuthMailRetries();
  await park(worker, 'purchase_pending');
  await vi.advanceTimersByTimeAsync(120_000);
  expect(claims()).toBe(0);
});
