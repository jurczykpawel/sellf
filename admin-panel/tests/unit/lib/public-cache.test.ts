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

describe('neutral catalogue cache', () => {
  it('caches empty groups, isolates locale/group/size, bypasses filters and expires absent scheduled products exactly', async () => {
    const { loadCataloguePage } = await import('@/lib/storefront-templates/catalogue');
    let boundary: string | null = new Date(105_000).toISOString();
    const rpc = vi.fn(async (name: string) => ({ data: name === 'storefront_catalogue_boundary' ? boundary : [], error: null }));
    const client = { rpc } as unknown as SupabaseClient<Database>;
    const get = (extra = {}) => loadCataloguePage(client, { locale: 'en', group: 'featured', pageSize: 12, ...extra });
    expect(await get()).toMatchObject({ success: true });
    await get();
    expect(rpc.mock.calls.filter(([name]) => name === 'storefront_catalogue_page')).toHaveLength(1);
    vi.advanceTimersByTime(4999); await get();
    expect(rpc.mock.calls.filter(([name]) => name === 'storefront_catalogue_page')).toHaveLength(1);
    boundary = null; vi.advanceTimersByTime(1); await get();
    expect(rpc.mock.calls.filter(([name]) => name === 'storefront_catalogue_page')).toHaveLength(2);
    for (const extra of [{ locale: 'pl' }, { group: 'free' }, { pageSize: 24 }]) await get(extra);
    expect(state.entries.size).toBe(4);
    for (const extra of [{ search: 'needle' }, { priceKind: 'free' }, { format: 'course' }, { categoryIds: ['10000000-0000-4000-8000-000000000001'] }]) {
      await get(extra); await get(extra);
    }
    expect(state.entries.size).toBe(4);
    vi.advanceTimersByTime(60_000); await get({ locale: 'pl' });
    expect(rpc.mock.calls.filter(([name]) => name === 'storefront_catalogue_page')).toHaveLength(14);
  });
  it('does not cache or return uncertain boundary reads', async () => {
    const { loadCataloguePage } = await import('@/lib/storefront-templates/catalogue');
    const rpc = vi.fn(async (name: string) => ({ data: name === 'storefront_catalogue_boundary' ? null : [], error: name === 'storefront_catalogue_boundary' ? { message: 'offline' } : null }));
    expect(await loadCataloguePage({ rpc } as unknown as SupabaseClient<Database>, { locale: 'en' })).toEqual({ success: false, error: 'UNAVAILABLE' });
  });
});
it('omits catalogue results when a slow page read crosses its scheduled boundary and fails open on cache storage errors', async () => {
  const { loadCataloguePage } = await import('@/lib/storefront-templates/catalogue');
  let slow = true;
  const rpc = vi.fn(async (name: string) => {
    if (name === 'storefront_catalogue_boundary') return { data: new Date(Date.now() + 1000).toISOString(), error: null };
    if (slow) vi.advanceTimersByTime(1000);
    return { data: [], error: null };
  });
  const client = { rpc } as unknown as SupabaseClient<Database>;
  expect(await loadCataloguePage(client, { locale: 'en' })).toEqual({ success: false, error: 'UNAVAILABLE' });
  slow = false; state.failCache = true;
  expect(await loadCataloguePage(client, { locale: 'en' })).toMatchObject({ success: true, data: { products: [] } });
});
