/**
 * Optional Redis Cache Layer (Upstash)
 *
 * This module provides optional Redis caching for improved performance.
 * If Upstash is not configured, all operations gracefully return null
 * and the application falls back to database queries.
 *
 * Benefits with Upstash:
 * - <10ms latency for cached data
 * - Reduces database load by 50-70%
 * - Global edge network (16+ regions)
 *
 * Setup:
 * 1. Create free account: https://console.upstash.com
 * 2. Create Redis database
 * 3. Add to .env:
 *    UPSTASH_REDIS_REST_URL=https://your-region.upstash.io
 *    UPSTASH_REDIS_REST_TOKEN=your_token
 * 4. Restart app - caching activates automatically
 */

import { Redis } from '@upstash/redis'

let redisClient: Redis | null = null
let initAttempted = false

/**
 * Get Redis client instance (lazy-loaded, singleton)
 * Returns null if Upstash is not configured - app continues to work normally
 */
export function getRedisCache(): Redis | null {
  // Return existing client if already initialized
  if (redisClient) return redisClient

  // Don't retry initialization if already failed
  if (initAttempted && !redisClient) return null

  initAttempted = true

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    console.log('ℹ️  Upstash Redis not configured - using database fallback (this is OK)')
    return null
  }

  try {
    redisClient = new Redis({ url, token })
    console.log('✅ Upstash Redis connected - caching enabled')
    return redisClient
  } catch (error) {
    console.error('❌ Redis connection failed:', error)
    console.log('ℹ️  Falling back to database (app will work normally)')
    return null
  }
}

/**
 * Get value from cache
 * Returns null if Redis is not configured or key not found
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedisCache()
  if (!redis) return null

  try {
    const value = await redis.get<T>(key)
    return value
  } catch (error) {
    console.error(`Redis GET error for key "${key}":`, error)
    return null
  }
}

/**
 * Set value in cache with TTL (time to live)
 * Returns true if successful, false if Redis not configured or error
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number = 3600
): Promise<boolean> {
  const redis = getRedisCache()
  if (!redis) return false

  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value))
    return true
  } catch (error) {
    console.error(`Redis SET error for key "${key}":`, error)
    return false
  }
}

/**
 * Delete value from cache
 * Returns true if successful, false if Redis not configured or error
 */
export async function cacheDel(key: string): Promise<boolean> {
  const redis = getRedisCache()
  if (!redis) return false

  try {
    await redis.del(key)
    return true
  } catch (error) {
    console.error(`Redis DEL error for key "${key}":`, error)
    return false
  }
}

/**
 * Delete multiple keys matching a pattern
 * Returns number of keys deleted, 0 if Redis not configured or error
 */
export async function cacheDelPattern(pattern: string): Promise<number> {
  const redis = getRedisCache()
  if (!redis) return 0

  try {
    // Scan for keys matching pattern
    let cursor: string | number = 0
    let deletedCount = 0

    do {
      const result: [string | number, string[]] = await redis.scan(cursor, { match: pattern, count: 100 })
      cursor = typeof result[0] === 'string' ? parseInt(result[0], 10) : result[0]
      const keys = result[1]

      if (keys.length > 0) {
        await redis.del(...keys)
        deletedCount += keys.length
      }
    } while (cursor !== 0)

    return deletedCount
  } catch (error) {
    console.error(`Redis DEL pattern error for "${pattern}":`, error)
    return 0
  }
}

/**
 * Check if Redis is configured and working
 */
export async function isRedisAvailable(): Promise<boolean> {
  const redis = getRedisCache()
  if (!redis) return false

  try {
    await redis.ping()
    return true
  } catch {
    return false
  }
}

/**
 * Cache key prefixes for different data types
 * Helps organize cache and enables pattern-based invalidation
 */
export const CacheKeys = {
  SHOP_CONFIG: 'shop:config',
  PRODUCT: (slug: string) => `product:${slug}`,
  PRODUCT_LIST: 'products:list',
  USER_PURCHASES: (userId: string) => `user:${userId}:purchases`,
  ANALYTICS: (type: string, period: string) => `analytics:${type}:${period}`,
} as const

/**
 * Cache TTL (time to live) presets in seconds
 */
export const CacheTTL = {
  SHORT: 60, // 1 minute
  MEDIUM: 300, // 5 minutes
  LONG: 3600, // 1 hour
  VERY_LONG: 86400, // 24 hours
} as const
