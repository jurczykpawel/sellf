/** Minute worker keeps the existing authenticated cron entry point. */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }), createPlatformClient: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimitForIdentifier: vi.fn(async () => true) }));
import { GET } from '@/app/api/cron/route';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('seat-reservations-expire cron', () => {
  it('requires the shared cron credential', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-key');
    expect((await GET(new NextRequest('http://localhost/api/cron?job=seat-reservations-expire'))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('returns the count released by the SQL worker', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-key'); rpc.mockResolvedValue({ data: 4, error: null });
    const response = await GET(new NextRequest('http://localhost/api/cron?job=seat-reservations-expire', { headers: { Authorization: 'Bearer test-cron-key' } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: 'seat-reservations-expire', processed: 4, errors: 0 });
    expect(rpc).toHaveBeenCalledWith('expire_seat_reservations');
  });
  it('reports a worker failure for scheduler retries', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-key'); rpc.mockResolvedValue({ data: null, error: { message: 'database unavailable' } });
    expect((await GET(new NextRequest('http://localhost/api/cron?job=seat-reservations-expire', { headers: { Authorization: 'Bearer test-cron-key' } }))).status).toBe(500);
  });
});
