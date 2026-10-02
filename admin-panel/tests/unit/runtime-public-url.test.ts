import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCanonicalOriginOrNull, getPublicBaseUrl } from '@/lib/utils/canonical-url';
import { assertPublicBaseUrl } from '@/lib/security/startup-assertions';

const keys = ['SITE_URL', 'MAIN_DOMAIN', 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_BASE_URL', 'NEXT_PUBLIC_APP_URL'];
beforeEach(() => {
  for (const key of keys) vi.stubEnv(key, '');
  vi.stubGlobal('window', undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('runtime public URL', () => {
  it('prefers SITE_URL, then MAIN_DOMAIN, then legacy public env', () => {
    vi.stubEnv('SITE_URL', 'https://runtime.example.org///');
    vi.stubEnv('MAIN_DOMAIN', 'main.example.org');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://legacy.example.org');
    expect(getPublicBaseUrl()).toBe('https://runtime.example.org');
    vi.stubEnv('SITE_URL', '');
    expect(getPublicBaseUrl()).toBe('https://main.example.org');
    vi.stubEnv('MAIN_DOMAIN', '');
    expect(getPublicBaseUrl()).toBe('https://legacy.example.org');
  });
  it.each(['placeholder.example.com', 'your-domain.com', 'placeholder.supabase.co'])(
    'rejects %s in every URL source', host => {
      vi.stubEnv('SITE_URL', `https://${host}`);
      vi.stubEnv('MAIN_DOMAIN', host);
      for (const key of keys.slice(2)) vi.stubEnv(key, `https://${host}`);
      expect(getCanonicalOriginOrNull()).toBeNull();
      vi.stubEnv('NODE_ENV', 'production');
      expect(() => assertPublicBaseUrl()).toThrow(/SITE_URL/);
      expect(() => getPublicBaseUrl()).toThrow(/SITE_URL/);
    },
  );
  it('does not let a build placeholder shadow MAIN_DOMAIN', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://placeholder.example.com');
    vi.stubEnv('MAIN_DOMAIN', 'shop.example.org');
    expect(getPublicBaseUrl()).toBe('https://shop.example.org');
  });
  it('uses browser origin for shared validators', () => {
    vi.stubGlobal('window', { location: { origin: 'https://browser.example.org' } });
    vi.stubEnv('SITE_URL', 'https://server.example.org');
    expect(getCanonicalOriginOrNull()).toBe('https://browser.example.org');
  });
  it.each([['https://', 'user:pass@', 'example.org'].join(''), 'https://example.org/path', 'https://example.org?x=1', 'javascript:alert(1)'])(
    'rejects non-origin input %s', value => {
      vi.stubEnv('SITE_URL', value);
      expect(getCanonicalOriginOrNull()).toBeNull();
    },
  );
});
