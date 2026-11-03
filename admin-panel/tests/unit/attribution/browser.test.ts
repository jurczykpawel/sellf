// @vitest-environment happy-dom
/** On Sellf's own checkout pages the consent banner decides between URL-only and stored attribution. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBrowserAttribution, consentFromCookie } from '@/lib/attribution/browser';

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  const api = {
    getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); },
    removeItem: (k: string) => { storage.delete(k); }, clear: () => storage.clear(), get length() { return storage.size; },
  };
  vi.stubGlobal('localStorage', api);
  Object.defineProperty(window, 'localStorage', { value: api, configurable: true });
});
afterEach(() => {
  document.cookie = 'sellf_consent_v3=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('browser attribution', () => {
  it('reads the cookie banner categories', () => {
    expect(consentFromCookie('')).toBe('none');
    const v = encodeURIComponent(JSON.stringify({ categories: ['necessary', 'analytics'] }));
    expect(consentFromCookie(`a=1; sellf_consent_v3=${v}`)).toBe('analytics');
    const m = encodeURIComponent(JSON.stringify({ categories: ['necessary', 'analytics', 'marketing'] }));
    expect(consentFromCookie(`sellf_consent_v3=${m}`)).toBe('marketing');
  });

  it('without consent sends the landing URL and leaves no trace in the browser', () => {
    window.history.replaceState(null, '', '/checkout/course?utm_source=listmonk&utm_medium=email&utm_campaign=mail-05');
    expect(readBrowserAttribution()).toMatchObject({ consent: 'none', mode: 'url', last: { source: 'listmonk', campaign: 'mail-05' } });
    expect(storage.size).toBe(0);
  });

  it('with consent remembers the first touch across visits', () => {
    document.cookie = `sellf_consent_v3=${encodeURIComponent(JSON.stringify({ categories: ['necessary', 'analytics'] }))}; path=/`;
    window.history.replaceState(null, '', '/?utm_source=facebook&utm_medium=paid_social');
    readBrowserAttribution();
    window.history.replaceState(null, '', '/checkout/course?utm_source=listmonk&utm_medium=email');
    expect(readBrowserAttribution()).toMatchObject({ mode: 'stored', first: { source: 'facebook' }, last: { source: 'listmonk' } });
  });
});
