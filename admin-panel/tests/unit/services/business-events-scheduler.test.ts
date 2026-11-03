/** Runtime expiry processing starts once and stays off during builds and test fixtures. */
import { afterEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn(async (name: string) => ({ data: name === 'claim_business_events' ? [] : 0, error: null })));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));
import { startBusinessEvents, stopBusinessEvents } from '@/lib/services/business-events';
afterEach(() => { stopBusinessEvents(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('periodically captures expiries and drains committed changes in the production runtime', async () => {
  vi.useFakeTimers(); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NEXT_PHASE', 'phase-production-server'); vi.stubEnv('E2E_MODE', 'false');
  startBusinessEvents(); startBusinessEvents();
  await vi.advanceTimersByTimeAsync(30000);
  expect(rpc.mock.calls.map(call => call[0])).toEqual(['capture_expired_access', 'capture_expired_licenses', 'claim_business_events']);
  stopBusinessEvents(); await vi.advanceTimersByTimeAsync(60000); expect(rpc).toHaveBeenCalledTimes(3);
});
it('does not process data while producing a build', async () => {
  vi.useFakeTimers(); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NEXT_PHASE', 'phase-production-build'); vi.stubEnv('E2E_MODE', 'false');
  startBusinessEvents(); await vi.advanceTimersByTimeAsync(30000); expect(rpc).not.toHaveBeenCalled();
});
it('finishes the current batch before starting another interval cycle', async () => {
  vi.useFakeTimers(); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NEXT_PHASE', 'phase-production-server'); vi.stubEnv('E2E_MODE', 'false');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  rpc.mockImplementationOnce(async () => { await held; return { data: 0, error: null }; });
  startBusinessEvents(); await vi.advanceTimersByTimeAsync(90000);
  const duringBatch = rpc.mock.calls.length;
  release(); await vi.advanceTimersByTimeAsync(0);
  expect(duringBatch).toBe(1);
});
