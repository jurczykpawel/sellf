/** Hard public-cache expiry through two independently warmed cache replicas. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boundedPublicRead, productCacheBoundary } from '@/lib/public-cache';
import { readPublishedConfig } from '@/lib/storefront-templates/repository';
import { DEFAULT_CONFIG } from '@/lib/storefront-templates/fixtures';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const state = vi.hoisted(() => ({ entries: new Map<string, unknown>(), redis: new Map<string, unknown>(), failCache: false, replica: "a", slowRedisWrite: false }));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => Promise<unknown>, key: string[]) => async () => {
    if (state.failCache) throw new Error('cache unavailable');
    const id = state.replica + key.join(':');
    if (!state.entries.has(id)) state.entries.set(id, await fn());
    // Deliberately retain old entries: lost invalidation and delayed revalidation.
    return state.entries.get(id);
  },
}));
vi.mock('@/lib/redis/cache', () => ({
  cacheGet: async (key: string) => state.redis.get(key) ?? null,
  cacheSet: async (key: string, value: unknown) => { state.redis.set(key, value); if (state.slowRedisWrite) vi.advanceTimersByTime(60_000); },
}));
beforeEach(() => { state.entries.clear(); state.redis.clear(); state.failCache = false; state.slowRedisWrite = false; vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => vi.useRealTimers());

describe('public cache freshness', () => {
  it('bounds two warm replicas despite dropped invalidation and stale cache hits', async () => {
    let price = 10;
    const read = vi.fn(async () => ({ price }));
    const a = () => { state.replica = 'a'; return boundedPublicRead(['catalogue', 'en'], ['storefront-products'], read); };
    const b = () => { state.replica = 'b'; return boundedPublicRead(['catalogue', 'en'], ['storefront-products'], read); };
    expect(await a()).toEqual({ price: 10 }); expect(await b()).toEqual({ price: 10 });
    price = 20; vi.advanceTimersByTime(59_999);
    expect(await a()).toEqual({ price: 10 });
    vi.advanceTimersByTime(1);
    expect(await a()).toEqual({ price: 20 }); expect(await b()).toEqual({ price: 20 });
    price = 0;
    expect(await a()).toEqual({ price: 0 });
  });
  it('expires at the scheduled boundary, including slow reads crossing it', async () => {
    let available = true;
    const read = async () => ({ available });
    const get = () => boundedPublicRead(['scheduled'], [], read, { boundary: (_value, readAt) => productCacheBoundary({ sale_price_until: new Date(105_000).toISOString() }, readAt) });
    expect(await get()).toEqual({ available: true });
    available = false; vi.advanceTimersByTime(5000);
    expect(await get()).toEqual({ available: false });
    const slow = async () => { vi.advanceTimersByTime(60_000); return { price: 10 }; };
    expect(await boundedPublicRead(['slow'], [], slow)).toBeNull();
  });
  it('does not let Redis renew the original age or accept old unversioned objects', async () => {
    const read = vi.fn(async () => ({ title: 'original' }));
    const get = (replica: string) => { state.replica = replica; return boundedPublicRead(['shop-config'], [], read, { redis: true }); };
    await get('one');
    const saved = [...state.redis.values()][0];
    vi.advanceTimersByTime(59_999);
    expect(await get('two')).toEqual({ title: 'original' });
    vi.advanceTimersByTime(1); read.mockResolvedValue({ title: 'edited' });
    // Redis ignores its TTL, and even serves the same object in another process.
    for (const key of state.redis.keys()) state.redis.set(key, saved);
    expect(await get('two')).toEqual({ title: 'edited' });
    expect(read).toHaveBeenCalledTimes(2);
    state.entries.clear(); for (const key of state.redis.keys()) state.redis.set(key, { title: 'legacy' });
    expect(await get('one')).toEqual({ title: 'edited' });
  });
  it('uses an authoritative read on cache failure and omits data on uncertain freshness', async () => {
    const read = vi.fn(async (): Promise<{ price: number } | null> => ({ price: 10 }));
    await boundedPublicRead(['price'], [], read);
    vi.advanceTimersByTime(60_000); read.mockResolvedValue(null);
    expect(await boundedPublicRead(['price'], [], read)).toBeNull();
    state.failCache = true; read.mockResolvedValue({ price: 20 });
    expect(await boundedPublicRead(['price'], [], read)).toEqual({ price: 20 });
    read.mockRejectedValue(new Error('database unavailable'));
    expect(await boundedPublicRead(['price'], [], read)).toBeNull();
  });
  it('uses the published repository projection on both replicas without sharing private snapshots', async () => {
    let published = structuredClone(DEFAULT_CONFIG);
    const single = vi.fn<() => Promise<{ data: { published: typeof DEFAULT_CONFIG } | null; error: { message: string } | null }>>(async () => ({ data: { published }, error: null }));
    const select = vi.fn((columns: string) => { expect(columns).toBe('published'); return { eq: () => ({ single }) }; });
    const client = { from: () => ({ select }) } as unknown as SupabaseClient<Database>;
    for (const replica of ['a', 'b']) { state.replica = replica; expect(await readPublishedConfig(client)).toMatchObject({ success: true, data: DEFAULT_CONFIG }); }
    published = { ...published, settingsByTemplate: { d: { density: 'compact' } } };
    vi.advanceTimersByTime(60_000);
    for (const replica of ['a', 'b']) {
      state.replica = replica;
      expect(await readPublishedConfig(client)).toMatchObject({ success: true, data: published });
    }
    expect(select.mock.calls.every(call => call[0] === 'published')).toBe(true);
    expect(JSON.stringify([...state.entries.values()])).not.toMatch(/draft|customer|cookie|content_config/);
    single.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect(await readPublishedConfig(client)).toMatchObject({ success: false });
  });
  it('checks the deadline again after a delayed Redis write', async () => {
    state.slowRedisWrite = true;
    expect(await boundedPublicRead(['slow-write'], [], async () => ({ price: 10 }), { redis: true })).toBeNull();
  });
  it('isolates instance and locale keys and stores only the supplied public projection', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://one.example');
    await boundedPublicRead(['catalogue', 'en'], [], async () => ({ title: 'EN' }));
    await boundedPublicRead(['catalogue', 'pl'], [], async () => ({ title: 'PL' }));
    vi.stubEnv('SUPABASE_URL', 'https://two.example');
    expect(await boundedPublicRead(['catalogue', 'en'], [], async () => ({ title: 'other' }))).toEqual({ title: 'other' });
    expect(state.entries.size).toBe(3);
    vi.unstubAllEnvs();
  });
});
