import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * ============================================================================
 * UNIT TEST: Security Audit Server Action
 * ============================================================================
 *
 * Tests the security audit logic that checks Supabase configuration.
 * Mocks fetch() to simulate various Supabase API responses.
 *
 * @see lib/actions/security-audit.ts
 * ============================================================================
 */

// Mock Supabase client before importing the module
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: true }),
  }),
}));

// Must import after mocks
const { getSecurityAudit, runSecurityAudit } = await import('@/lib/actions/security-audit');

describe('Security Audit', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    // Reset module cache to clear cached audit results
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('runSecurityAudit', () => {
    it('returns 6 checks on success', async () => {
      // Mock all fetch calls to return "safe" responses
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/graphql/v1')) {
          return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
        }
        if (url.includes('/mcp')) {
          return Promise.resolve({ status: 404 });
        }
        if (url.includes('/rest/v1/rpc/')) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({ message: 'not found' }) });
        }
        if (url.includes('/rest/v1/')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({}),
          });
        }
        if (url.includes('/auth/v1/settings')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ mailer_autoconfirm: false }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, headers: new Headers({}), json: () => Promise.resolve({}) });
      });

      const result = await runSecurityAudit();

      expect(result.success).toBe(true);
      expect(result.checks).toHaveLength(15);
      expect(result.timestamp).toBeTruthy();
      expect(result.checks.every(c => c.id && c.name && c.status && c.message)).toBe(true);
    });

    it('detects GraphQL introspection enabled', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/graphql/v1')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: { __schema: { queryType: { name: 'Query' } } } }),
          });
        }
        return Promise.resolve({ ok: true, status: 404, headers: new Headers({}), json: () => Promise.resolve({}) });
      });

      const result = await runSecurityAudit();
      const check = result.checks.find(c => c.id === 'graphql-introspection');

      expect(check?.status).toBe('warn');
      expect(check?.fix).toBeTruthy();
    });

    it('detects MCP endpoint accessible', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/mcp')) {
          return Promise.resolve({ status: 406 }); // Not 404 = accessible
        }
        return Promise.resolve({ ok: true, status: 404, headers: new Headers({}), json: () => Promise.resolve({}) });
      });

      const result = await runSecurityAudit();
      const check = result.checks.find(c => c.id === 'mcp-endpoint');

      expect(check?.status).toBe('warn');
      expect(check?.message).toContain('406');
    });

    it('detects server version headers exposed', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/rest/v1/') && !url.includes('/rpc/')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({
              'server': 'postgrest/12.2.12',
              'via': 'kong/2.8.1',
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 404, headers: new Headers({}), json: () => Promise.resolve({}) });
      });

      const result = await runSecurityAudit();
      const check = result.checks.find(c => c.id === 'version-headers');

      expect(check?.status).toBe('warn');
      expect(check?.message).toContain('postgrest');
    });

    it('detects email autoconfirm enabled', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/auth/v1/settings')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ mailer_autoconfirm: true }),
          });
        }
        return Promise.resolve({ ok: true, status: 404, headers: new Headers({}), json: () => Promise.resolve({}) });
      });

      const result = await runSecurityAudit();
      const check = result.checks.find(c => c.id === 'email-autoconfirm');

      expect(check?.status).toBe('fail');
      expect(check?.fix).toContain('enable_confirmations');
    });

    it('detects product count leak via Prefer header', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/rest/v1/products')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-range': '0-12/13' }),
          });
        }
        return Promise.resolve({ ok: true, status: 404, headers: new Headers({}), json: () => Promise.resolve({}) });
      });

      const result = await runSecurityAudit();
      const check = result.checks.find(c => c.id === 'count-header-leak');

      expect(check?.status).toBe('warn');
      expect(check?.message).toContain('0-12/13');
    });

    it('detects RPC function name hints', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/rpc/nonexistent')) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({
              hint: 'Perhaps you meant to call the function public.log_admin_action',
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 404, headers: new Headers({}), json: () => Promise.resolve({}) });
      });

      const result = await runSecurityAudit();
      const check = result.checks.find(c => c.id === 'rpc-function-hints');

      expect(check?.status).toBe('warn');
      expect(check?.message).toContain('log_admin_action');
    });

    it('all pass when properly configured', async () => {
      // Set ALL env vars needed for every security check to pass
      process.env.SITE_URL = 'https://myapp.example.com';
      process.env.NEXT_PUBLIC_APP_URL = 'https://myapp.example.com';
      process.env.ALLOWED_ORIGINS = 'https://customer.com';
      process.env.ALTCHA_HMAC_KEY = 'test-hmac-key-for-captcha';
      // base64-encoded 32 bytes (openssl rand -base64 32 output format)
      process.env.APP_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      process.env.CRON_SECRET = 'test-cron-secret';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/graphql/v1')) {
          return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
        }
        if (url.includes('/mcp')) {
          return Promise.resolve({ status: 404 });
        }
        if (url.includes('/auth/v1/settings')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ mailer_autoconfirm: false }) });
        }
        if (url.includes('/rpc/nonexistent')) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({ message: 'not found' }) });
        }
        if (url.includes('/rest/v1/')) {
          return Promise.resolve({ ok: true, headers: new Headers({}) });
        }
        // HTTPS redirect check (http:// → 301 to https://)
        if (url.startsWith('http://')) {
          return Promise.resolve({ status: 301, headers: new Headers({ 'location': url.replace('http://', 'https://') }) });
        }
        // HSTS + cookie checks (https:// site URL)
        if (url.startsWith('https://')) {
          return Promise.resolve({
            ok: true, status: 200,
            headers: new Headers({ 'strict-transport-security': 'max-age=31536000; includeSubDomains' }),
            getSetCookie: () => ['NEXT_LOCALE=en; Path=/; Secure; SameSite=lax'],
          });
        }
        return Promise.resolve({ ok: true, status: 200, headers: new Headers({}), json: () => Promise.resolve({}) });
      });

      const result = await runSecurityAudit();

      expect(result.success).toBe(true);
      expect(result.checks.every(c => c.status === 'pass')).toBe(true);
      expect(result.checks.every(c => c.fix === undefined)).toBe(true);
    });
  });

  describe('getSecurityAudit (caching)', () => {
    it('returns cached result on second call', async () => {
      let fetchCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        fetchCount++;
        return Promise.resolve({ ok: true, status: 404, headers: new Headers({}), json: () => Promise.resolve({}) });
      });

      const first = await runSecurityAudit(); // populate cache
      fetchCount = 0;

      const second = await getSecurityAudit(); // should use cache

      expect(second.timestamp).toBe(first.timestamp);
      expect(fetchCount).toBe(0); // no new fetch calls
    });

    it('runSecurityAudit always bypasses cache', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve({ ok: true, status: 404, headers: new Headers({}), json: () => Promise.resolve({}) });
      });

      const first = await runSecurityAudit();

      // Small delay to get different timestamp
      await new Promise(r => setTimeout(r, 10));

      const second = await runSecurityAudit(); // should bypass cache

      expect(second.timestamp).not.toBe(first.timestamp);
    });
  });

  describe('authorization', () => {
    it('rejects non-admin users', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce({
        rpc: vi.fn().mockResolvedValue({ data: false }),
      } as never);

      const result = await runSecurityAudit();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthorized');
      expect(result.checks).toHaveLength(0);
    });
  });

  describe('missing configuration', () => {
    it('returns error when SUPABASE_URL is missing', async () => {
      delete process.env.SUPABASE_URL;

      const result = await runSecurityAudit();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing Supabase');
    });
  });

  describe('fetch error handling', () => {
    it('handles network errors gracefully', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://myapp.example.com';
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await runSecurityAudit();

      // Should still succeed — fetch-based checks return pass (unreachable = likely blocked)
      expect(result.success).toBe(true);
      expect(result.checks.length).toBeGreaterThan(0);
      // Supabase checks return pass on network error (unreachable = likely blocked)
      const supabaseChecks = result.checks.filter(c =>
        ['graphql-introspection', 'mcp-endpoint', 'version-headers', 'email-autoconfirm', 'count-header-leak', 'rpc-function-hints'].includes(c.id)
      );
      expect(supabaseChecks.every(c => c.status === 'pass')).toBe(true);
    });
  });
});
