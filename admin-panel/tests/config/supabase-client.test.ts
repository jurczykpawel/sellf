/**
 * Supabase Client Configuration Tests
 * Verifies that createAdminClient uses the correct env vars,
 * throws on missing config, and returns a usable Supabase client.
 *
 * No mocks — tests the real createAdminClient function and verifies
 * it produces a proper Supabase client with expected interface.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Supabase Admin Client', () => {
  let originalUrl: string | undefined;
  let originalPublicUrl: string | undefined;
  let originalKey: string | undefined;

  beforeEach(() => {
    originalUrl = process.env.SUPABASE_URL;
    originalPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    process.env.SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalPublicUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    vi.resetModules();
  });

  it('should return a client with expected Supabase methods', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key-456';

    const { createAdminClient } = await import('@/lib/supabase/admin');
    const client = createAdminClient();

    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
    expect(typeof client.auth.getUser).toBe('function');
    expect(typeof client.auth.getSession).toBe('function');
    expect(typeof client.rpc).toBe('function');
  });

  it('should create distinct client instances on each call', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key-789';

    const { createAdminClient } = await import('@/lib/supabase/admin');
    const client1 = createAdminClient();
    const client2 = createAdminClient();

    expect(client1).not.toBe(client2);
  });

  it('should throw if neither SUPABASE_URL nor NEXT_PUBLIC_SUPABASE_URL is defined', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    const { createAdminClient } = await import('@/lib/supabase/admin');

    expect(() => createAdminClient()).toThrow(/SUPABASE_URL.*is not defined/);
  });

  it('should fall back to NEXT_PUBLIC_SUPABASE_URL when SUPABASE_URL is unset', async () => {
    delete process.env.SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fallback.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    const { createAdminClient } = await import('@/lib/supabase/admin');

    expect(() => createAdminClient()).not.toThrow();
  });

  it('should throw if SUPABASE_SERVICE_ROLE_KEY is not defined', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { createAdminClient } = await import('@/lib/supabase/admin');

    expect(() => createAdminClient()).toThrow('SUPABASE_SERVICE_ROLE_KEY is not defined');
  });

  it('should read from SUPABASE_URL with NEXT_PUBLIC_SUPABASE_URL as fallback', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const source = readFileSync(
      resolve(__dirname, '../../src/lib/supabase/admin.ts'),
      'utf-8'
    );

    expect(source).toContain('process.env.SUPABASE_URL');
    expect(source).toContain('process.env.SUPABASE_SERVICE_ROLE_KEY');
    expect(source).toContain('process.env.NEXT_PUBLIC_SUPABASE_URL');
  });

  it('should prefer SUPABASE_URL over NEXT_PUBLIC_SUPABASE_URL when both are set', async () => {
    process.env.SUPABASE_URL = 'https://primary.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fallback.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const source = readFileSync(
      resolve(__dirname, '../../src/lib/supabase/admin.ts'),
      'utf-8'
    );

    expect(source).toMatch(/SUPABASE_URL\s*\|\|\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
  });
});
