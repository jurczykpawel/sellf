import { afterEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: () => ({ rpc }) }));

import { checkRateLimit, checkRateLimitForIdentifier } from '@/lib/rate-limiting';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rpc.mockReset();
});

describe('rate limit backend results', () => {
  for (const mode of ['development', 'test', 'production']) {
    for (const explicitIdentifier of [false, true]) {
      for (const failure of ['response', 'exception']) {
        it(`denies ${failure} errors in ${mode} with explicit identifier ${explicitIdentifier}`, async () => {
          vi.stubEnv('NODE_ENV', mode);
          vi.stubEnv('RATE_LIMIT_TEST_MODE', 'true');
          vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
          vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
          vi.spyOn(console, 'error').mockImplementation(() => {});
          if (failure === 'response') {
            rpc.mockResolvedValue({ data: null, error: { message: 'An invalid response was received from the upstream server' } });
          } else {
            rpc.mockRejectedValue(new Error('Connection closed'));
          }
          const allowed = explicitIdentifier
            ? await checkRateLimitForIdentifier('api_key:test', 5, 1, 'key:test')
            : await checkRateLimit('api_key:test', 5, 1);
          expect(rpc).toHaveBeenCalledOnce();
          expect(allowed).toBe(false);
        });
      }
    }
  }

  it('allows at most five concurrent calls when one backend response fails', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RATE_LIMIT_TEST_MODE', 'true');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 5; i++) rpc.mockResolvedValueOnce({ data: true, error: null });
    for (let i = 0; i < 4; i++) rpc.mockResolvedValueOnce({ data: false, error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'An invalid response was received from the upstream server' } });
    const results = await Promise.all(Array.from({ length: 10 }, () => checkRateLimit('api_key:test', 5, 1)));
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it('keeps disabled local limits disabled', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('RATE_LIMIT_TEST_MODE', 'false');
    expect(await checkRateLimit('test', 5, 1)).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('uses the database decision for successful responses', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RATE_LIMIT_TEST_MODE', 'true');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await checkRateLimit('test', 5, 1)).toBe(true);
    expect(await checkRateLimit('test', 5, 1)).toBe(false);
  });
});
