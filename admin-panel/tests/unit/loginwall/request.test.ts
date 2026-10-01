import { describe, it, expect, afterEach } from 'vitest';

import {
  parseCustomerRedirect,
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
