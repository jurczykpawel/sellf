/**
 * Script Cache Helper
 *
 * Provides in-memory caching with ETag support for serving JavaScript files.
 * Used by /api/sellf and /api/config endpoints.
 */

import { NextResponse } from 'next/server';

export interface CachedItem<T = unknown> {
  data: T;
  hash: string;
  generatedAt: number;
}

export interface CacheOptions {
  /** Cache TTL in milliseconds (default: 1 hour) */
  ttl?: number;
}

export interface HttpCacheOptions {
  /** HTTP max-age in seconds (default: 3600) */
  maxAge?: number;
  /** Stale-while-revalidate in seconds (default: 86400) */
  staleWhileRevalidate?: number;
}

const DEFAULT_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Generate a simple hash (djb2 algorithm)
 * Used for ETags and cache keys
 */
export function generateHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generic in-memory cache with TTL
 * Used by generators and endpoints for consistent caching
 */
export class MemoryCache<T> {
  private cache = new Map<string, CachedItem<T>>();
  private ttl: number;

  constructor(options: CacheOptions = {}) {
    this.ttl = options.ttl ?? DEFAULT_TTL;
  }

  /**
   * Get cached item or generate new one
   */
  getOrGenerate(
    cacheKey: string,
    generator: () => T,
    hashFn?: (data: T) => string
  ): CachedItem<T> {
    const now = Date.now();
    const cached = this.cache.get(cacheKey);

    // Return cached if valid
    if (cached && (now - cached.generatedAt) < this.ttl) {
      return cached;
    }

    // Generate new item
    const data = generator();
    const hash = hashFn ? hashFn(data) : generateHash(JSON.stringify(data));

    const result: CachedItem<T> = {
      data,
      hash,
      generatedAt: now,
    };

    this.cache.set(cacheKey, result);
    this.cleanup(now);

    return result;
  }

  /**
   * Check if cache has valid entry
   */
  has(cacheKey: string): boolean {
    const cached = this.cache.get(cacheKey);
    if (!cached) return false;
    return (Date.now() - cached.generatedAt) < this.ttl;
  }

  /**
   * Get cached item (or undefined if expired/missing)
   */
  get(cacheKey: string): CachedItem<T> | undefined {
    const cached = this.cache.get(cacheKey);
    if (!cached) return undefined;
    if ((Date.now() - cached.generatedAt) >= this.ttl) {
      this.cache.delete(cacheKey);
      return undefined;
    }
    return cached;
  }

  /**
   * Set cache item directly
   */
  set(cacheKey: string, data: T, hash?: string): CachedItem<T> {
    const result: CachedItem<T> = {
      data,
      hash: hash ?? generateHash(JSON.stringify(data)),
      generatedAt: Date.now(),
    };
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Clean expired entries
   */
  private cleanup(now: number): void {
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.generatedAt > this.ttl) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Helper function for conditional request handling
 * Returns 304 Not Modified if ETag matches
 */
export function handleConditionalRequest(
  request: Request,
  hash: string,
  additionalHeaders: Record<string, string> = {}
): NextResponse | null {
  const ifNoneMatch = request.headers.get('if-none-match');

  if (ifNoneMatch && ifNoneMatch === hash) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        'ETag': hash,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        ...additionalHeaders,
      },
    });
  }

  return null;
}

/**
 * Create a JavaScript response with caching headers
 */
export function createScriptResponse(
  content: string,
  hash: string,
  additionalHeaders: Record<string, string> = {}
): NextResponse {
  return new NextResponse(content, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'ETag': hash,
      'X-Cache-TTL': '3600',
      ...additionalHeaders,
    },
  });
}

/**
 * Script-specific cache with HTTP response helpers
 */
export class ScriptCache extends MemoryCache<string> {
  constructor(options: CacheOptions = {}) {
    super(options);
  }

  /**
   * Get cached script or generate new one
   */
  getOrGenerate(
    cacheKey: string,
    generator: () => string
  ): CachedItem<string> {
    return super.getOrGenerate(cacheKey, generator, generateHash);
  }

  /**
   * Check If-None-Match header and return 304 if content unchanged
   */
  checkConditionalRequest(
    request: Request,
    cached: CachedItem<string>,
    additionalHeaders: Record<string, string> = {}
  ): NextResponse | null {
    return handleConditionalRequest(request, cached.hash, additionalHeaders);
  }

  /**
   * Create a full response with proper caching headers
   */
  createResponse(
    cached: CachedItem<string>,
    additionalHeaders: Record<string, string> = {}
  ): NextResponse {
    return createScriptResponse(cached.data, cached.hash, additionalHeaders);
  }
}
