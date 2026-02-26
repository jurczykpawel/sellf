/**
 * Tests for script-cache.ts
 * Testing: MemoryCache, ScriptCache, generateHash, embedCache
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateHash,
  MemoryCache,
  ScriptCache,
  embedCache,
} from '@/lib/script-cache';

describe('generateHash', () => {
  it('returns consistent hash for same input', () => {
    const input = 'test content';
    const hash1 = generateHash(input);
    const hash2 = generateHash(input);
    expect(hash1).toBe(hash2);
  });

  it('returns different hash for different input', () => {
    const hash1 = generateHash('content A');
    const hash2 = generateHash('content B');
    expect(hash1).not.toBe(hash2);
  });

  it('returns string hash', () => {
    const hash = generateHash('test');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('handles empty string', () => {
    const hash = generateHash('');
    expect(typeof hash).toBe('string');
  });

  it('handles unicode content', () => {
    const hash = generateHash('Zażółć gęślą jaźń 中文 🎉');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });
});

describe('MemoryCache', () => {
  let cache: MemoryCache<string>;

  beforeEach(() => {
    cache = new MemoryCache<string>({ ttl: 1000 }); // 1 second TTL for tests
  });

  describe('getOrGenerate', () => {
    it('generates value on first call', () => {
      const generator = vi.fn(() => 'generated value');
      const result = cache.getOrGenerate('key1', generator);

      expect(generator).toHaveBeenCalledTimes(1);
      expect(result.data).toBe('generated value');
      expect(typeof result.hash).toBe('string');
      expect(result.hash.length).toBeGreaterThan(0);
      expect(result.generatedAt).toBeLessThanOrEqual(Date.now());
    });

    it('returns cached value on subsequent calls', () => {
      const generator = vi.fn(() => 'generated value');

      cache.getOrGenerate('key1', generator);
      const result = cache.getOrGenerate('key1', generator);

      expect(generator).toHaveBeenCalledTimes(1); // Not called again
      expect(result.data).toBe('generated value');
    });

    it('regenerates after TTL expires', async () => {
      const cache = new MemoryCache<string>({ ttl: 50 }); // 50ms TTL
      let callCount = 0;
      const generator = vi.fn(() => `value-${++callCount}`);

      const result1 = cache.getOrGenerate('key1', generator);
      expect(result1.data).toBe('value-1');

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 60));

      const result2 = cache.getOrGenerate('key1', generator);
      expect(result2.data).toBe('value-2');
      expect(generator).toHaveBeenCalledTimes(2);
    });

    it('uses custom hash function when provided', () => {
      const generator = () => 'value';
      const customHash = vi.fn(() => 'custom-hash');

      const result = cache.getOrGenerate('key1', generator, customHash);

      expect(customHash).toHaveBeenCalledWith('value');
      expect(result.hash).toBe('custom-hash');
    });

    it('handles different keys independently', () => {
      const result1 = cache.getOrGenerate('key1', () => 'value1');
      const result2 = cache.getOrGenerate('key2', () => 'value2');

      expect(result1.data).toBe('value1');
      expect(result2.data).toBe('value2');
    });
  });

  describe('get', () => {
    it('returns undefined for missing key', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('returns cached item for valid key', () => {
      cache.set('key1', 'value1');
      const result = cache.get('key1');

      expect(result).not.toBeNull();
      expect(result?.data).toBe('value1');
    });

    it('returns undefined for expired key', async () => {
      const cache = new MemoryCache<string>({ ttl: 50 });
      cache.set('key1', 'value1');

      await new Promise((r) => setTimeout(r, 60));

      expect(cache.get('key1')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns false for missing key', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('returns true for existing valid key', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
    });

    it('returns false for expired key', async () => {
      const cache = new MemoryCache<string>({ ttl: 50 });
      cache.set('key1', 'value1');

      await new Promise((r) => setTimeout(r, 60));

      expect(cache.has('key1')).toBe(false);
    });
  });

  describe('set', () => {
    it('stores value with auto-generated hash', () => {
      const result = cache.set('key1', 'value1');

      expect(result.data).toBe('value1');
      expect(typeof result.hash).toBe('string');
      expect(result.hash.length).toBeGreaterThan(0);
      expect(result.generatedAt).toBeLessThanOrEqual(Date.now());
    });

    it('stores value with custom hash', () => {
      const result = cache.set('key1', 'value1', 'my-custom-hash');

      expect(result.hash).toBe('my-custom-hash');
    });

    it('overwrites existing value', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');

      expect(cache.get('key1')?.data).toBe('value2');
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });
  });

  describe('size', () => {
    it('returns 0 for empty cache', () => {
      expect(cache.size).toBe(0);
    });

    it('returns correct count', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      expect(cache.size).toBe(2);
    });
  });
});

describe('ScriptCache', () => {
  let cache: ScriptCache;

  beforeEach(() => {
    cache = new ScriptCache({ ttl: 1000 });
  });

  describe('getOrGenerate', () => {
    it('returns content with a non-empty string hash', () => {
      const result = cache.getOrGenerate('key1', () => 'script content');

      expect(result.data).toBe('script content');
      expect(typeof result.hash).toBe('string');
      expect(result.hash.length).toBeGreaterThan(0);
    });

    it('returns different hashes for different content', () => {
      const result1 = cache.getOrGenerate('key1', () => 'content A');
      const result2 = cache.getOrGenerate('key2', () => 'content B');

      expect(result1.hash).not.toBe(result2.hash);
    });
  });

  describe('checkConditionalRequest', () => {
    it('returns null when no If-None-Match header', () => {
      const request = new Request('http://test.com');
      const cached = { data: 'content', hash: 'abc123', generatedAt: Date.now() };

      const result = cache.checkConditionalRequest(request, cached);

      expect(result).toBeNull();
    });

    it('returns null when ETag does not match', () => {
      const request = new Request('http://test.com', {
        headers: { 'If-None-Match': 'different-hash' },
      });
      const cached = { data: 'content', hash: 'abc123', generatedAt: Date.now() };

      const result = cache.checkConditionalRequest(request, cached);

      expect(result).toBeNull();
    });

    it('returns 304 response when ETag matches', () => {
      const request = new Request('http://test.com', {
        headers: { 'If-None-Match': 'abc123' },
      });
      const cached = { data: 'content', hash: 'abc123', generatedAt: Date.now() };

      const result = cache.checkConditionalRequest(request, cached);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(304);
      expect(result?.headers.get('ETag')).toBe('abc123');
    });

    it('includes additional headers in 304 response', () => {
      const request = new Request('http://test.com', {
        headers: { 'If-None-Match': 'abc123' },
      });
      const cached = { data: 'content', hash: 'abc123', generatedAt: Date.now() };

      const result = cache.checkConditionalRequest(request, cached, {
        'X-Custom': 'value',
      });

      expect(result?.headers.get('X-Custom')).toBe('value');
    });
  });

  describe('createResponse', () => {
    it('returns response with correct content', async () => {
      const cached = { data: 'script content', hash: 'abc123', generatedAt: Date.now() };

      const response = cache.createResponse(cached);
      const body = await response.text();

      expect(body).toBe('script content');
    });

    it('includes correct headers', () => {
      const cached = { data: 'content', hash: 'abc123', generatedAt: Date.now() };

      const response = cache.createResponse(cached);

      expect(response.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8');
      expect(response.headers.get('ETag')).toBe('abc123');
      expect(response.headers.get('Cache-Control')).toContain('max-age=3600');
      expect(response.headers.get('Cache-Control')).toContain('stale-while-revalidate');
    });

    it('includes additional headers', () => {
      const cached = { data: 'content', hash: 'abc123', generatedAt: Date.now() };

      const response = cache.createResponse(cached, { 'X-Custom': 'value' });

      expect(response.headers.get('X-Custom')).toBe('value');
    });
  });
});

describe('embedCache singleton', () => {
  beforeEach(() => {
    embedCache.clear();
  });

  afterEach(() => {
    embedCache.clear();
  });

  it('is instance of ScriptCache', () => {
    expect(embedCache).toBeInstanceOf(ScriptCache);
  });

  it('persists across imports', () => {
    embedCache.set('test-key', 'test-value');
    expect(embedCache.get('test-key')?.data).toBe('test-value');
  });
});
