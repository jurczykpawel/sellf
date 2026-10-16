/** Tagged public reads with an absolute deadline. @see storefront-templates/repository.ts */
import 'server-only';
import { createHash } from 'node:crypto';
import { unstable_cache } from 'next/cache';
import { getRuntimeSupabaseUrl } from '@/lib/config/runtime-env';
import { cacheGet, cacheSet } from '@/lib/redis/cache';

interface PublicEntry<T> { value: T; readAt: number; expiresAt: number }
interface PublicReadOptions<T> { boundary?: (value: T, readAt: number) => number; redis?: boolean }

export function publicCacheKey(key: string[]): string {
  const instance = createHash('sha256').update(getRuntimeSupabaseUrl() ?? '').digest('hex');
  return 'public-v1:' + instance + ':' + createHash('sha256').update(JSON.stringify(key)).digest('hex');
}

/** Call only with bounded keys and explicit public projections, without caller identity. */
export async function boundedPublicRead<T>(key: string[], tags: string[], read: () => Promise<T | null>, options: PublicReadOptions<T> = {}): Promise<T | null> {
  const redisKey = publicCacheKey(key);
  const parts = [redisKey];
  const fresh = (entry: PublicEntry<T> | null): entry is PublicEntry<T> => {
    const now = Date.now();
    return !!entry && Number.isFinite(entry.readAt) && Number.isFinite(entry.expiresAt)
      && entry.readAt <= now && now < Math.min(entry.expiresAt, entry.readAt + 60_000);
  };
  const authoritative = async (): Promise<PublicEntry<T> | null> => {
    const readAt = Date.now();
    const value = await read();
    if (value === null) return null;
    return { value, readAt, expiresAt: Math.min(readAt + 60_000, options.boundary?.(value, readAt) ?? Infinity) };
  };
  try {
    if (options.redis) {
      try {
        const stored = await cacheGet<PublicEntry<T>>(redisKey);
        if (fresh(stored)) return stored.value;
      } catch { /* Continue with the tagged cache or authoritative read. */ }
    }
    let entry: PublicEntry<T> | null = null;
    try { entry = await unstable_cache(authoritative, parts, { revalidate: 60, tags })(); } catch { /* Read directly below. */ }
    if (!fresh(entry)) entry = await authoritative();
    if (!fresh(entry)) return null;
    if (options.redis) {
      try { await cacheSet(redisKey, entry, Math.max(1, Math.floor((entry.expiresAt - Date.now()) / 1000))); } catch { /* The authoritative result is still usable. */ }
    }
    return fresh(entry) ? entry.value : null;
  } catch { return null; }
}

export function productCacheBoundary(product: { available_from?: string | null; available_until?: string | null; sale_price_until?: string | null }, readAt: number): number {
  return Math.min(Infinity, ...[product.available_from, product.available_until, product.sale_price_until]
    .flatMap(value => { const time = value ? Date.parse(value) : NaN; return time > readAt ? [time] : []; }));
}
