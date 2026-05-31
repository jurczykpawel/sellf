import { describe, it, expect, afterEach } from 'vitest';

import {
  parseCustomerRedirect,
  siteOrigin,
  appendTokenToFragment,
} from '@/lib/loginwall/request';

describe('parseCustomerRedirect', () => {
  it('accepts a public https url', () => {
    const url = parseCustomerRedirect('https://customer.example/page');
    expect(url?.origin).toBe('https://customer.example');
  });

  it('rejects a non-http(s) protocol', () => {
    expect(parseCustomerRedirect('javascript:alert(1)')).toBeNull();
    expect(parseCustomerRedirect('ftp://x.example')).toBeNull();
  });

  it('rejects an internal hostname', () => {
    expect(parseCustomerRedirect('http://localhost/x')).toBeNull();
    expect(parseCustomerRedirect('http://127.0.0.1/x')).toBeNull();
  });

  it('rejects garbage', () => {
    expect(parseCustomerRedirect('not a url')).toBeNull();
  });
});

describe('siteOrigin', () => {
  const prev = { site: process.env.NEXT_PUBLIC_SITE_URL, alt: process.env.SITE_URL };
  afterEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = prev.site;
    process.env.SITE_URL = prev.alt;
  });

  it('reads NEXT_PUBLIC_SITE_URL origin', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://sellf.example/path';
    expect(siteOrigin()).toBe('https://sellf.example');
  });

  it('returns null when unset', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.SITE_URL;
    expect(siteOrigin()).toBeNull();
  });
});

describe('appendTokenToFragment', () => {
  it('appends token to a url with no fragment', () => {
    const out = appendTokenToFragment(new URL('https://x.example/p'), 'TKN');
    expect(out).toBe('https://x.example/p#_sf_token=TKN');
  });

  it('preserves an existing fragment', () => {
    const out = appendTokenToFragment(new URL('https://x.example/p#section'), 'TKN');
    expect(out).toBe('https://x.example/p#section&_sf_token=TKN');
  });
});
