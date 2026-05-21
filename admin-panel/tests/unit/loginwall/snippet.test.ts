import { describe, it, expect } from 'vitest';

import {
  buildLoginwallScript,
  buildLoginwallSnippet,
  loginwallVariableHash,
} from '@/lib/loginwall/snippet';

const PRODUCT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
const SF_ORIGIN = 'https://sellf.example.com';

describe('loginwallVariableHash', () => {
  it('returns a 10-16 char alphanumeric token derived from the product id', () => {
    const hash = loginwallVariableHash(PRODUCT_ID);
    expect(hash).toMatch(/^[a-z0-9]{10,16}$/);
  });

  it('is deterministic for the same product id', () => {
    expect(loginwallVariableHash(PRODUCT_ID)).toBe(loginwallVariableHash(PRODUCT_ID));
  });

  it('differs across product ids', () => {
    const other = '00000000-0000-0000-0000-000000000000';
    expect(loginwallVariableHash(PRODUCT_ID)).not.toBe(loginwallVariableHash(other));
  });
});

describe('buildLoginwallSnippet', () => {
  it('returns the three-block HTML snippet sellers paste on their page', () => {
    const snippet = buildLoginwallSnippet({ productId: PRODUCT_ID, sellfOrigin: SF_ORIGIN });
    const hash = loginwallVariableHash(PRODUCT_ID);

    expect(snippet).toContain(`<script src="${SF_ORIGIN}/api/loginwall/login.js?id=${PRODUCT_ID}"></script>`);
    expect(snippet).toContain(`!window._SF_LW_${hash}`);
    expect(snippet).toContain(`${SF_ORIGIN}/loginwall/protect?id=${PRODUCT_ID}`);
    expect(snippet).toContain('<noscript>');
    expect(snippet).toContain('<meta http-equiv="refresh"');
  });

  it('encodes the redirect URL for the inline fallback', () => {
    const snippet = buildLoginwallSnippet({ productId: PRODUCT_ID, sellfOrigin: SF_ORIGIN });
    expect(snippet).toContain('encodeURIComponent(location.href)');
  });

  it('rejects an invalid product id', () => {
    expect(() => buildLoginwallSnippet({ productId: 'not-a-uuid', sellfOrigin: SF_ORIGIN })).toThrow();
  });

  it('rejects an empty sellf origin', () => {
    expect(() => buildLoginwallSnippet({ productId: PRODUCT_ID, sellfOrigin: '' })).toThrow();
  });
});

describe('buildLoginwallScript', () => {
  it('returns IIFE JavaScript including the product id and origin', () => {
    const script = buildLoginwallScript({ productId: PRODUCT_ID, sellfOrigin: SF_ORIGIN });
    expect(script).toMatch(/^\(function\s*\(\)\s*\{/);
    expect(script).toContain(PRODUCT_ID);
    expect(script).toContain(SF_ORIGIN);
  });

  it('uses the same per-product hash as the inline snippet', () => {
    const script = buildLoginwallScript({ productId: PRODUCT_ID, sellfOrigin: SF_ORIGIN });
    expect(script).toContain(`_SF_LW_${loginwallVariableHash(PRODUCT_ID)}`);
  });

  it('includes an anti-double-execute guard', () => {
    const script = buildLoginwallScript({ productId: PRODUCT_ID, sellfOrigin: SF_ORIGIN });
    expect(script).toContain('_SF_LOGINWALL_EXECUTED');
  });

  it('includes a pageshow bfcache reload listener', () => {
    const script = buildLoginwallScript({ productId: PRODUCT_ID, sellfOrigin: SF_ORIGIN });
    expect(script).toMatch(/pageshow/);
    expect(script).toMatch(/persisted/);
    expect(script).toMatch(/location\.reload/);
  });

  it('reads the _sf_token from the URL fragment, not the query string', () => {
    const script = buildLoginwallScript({ productId: PRODUCT_ID, sellfOrigin: SF_ORIGIN });
    expect(script).toContain('_sf_token');
    expect(script).toContain('location.hash');
    expect(script).not.toContain('searchParams.get("_sf_token")');
  });

  it('uses history.replaceState to strip the token from the URL', () => {
    const script = buildLoginwallScript({ productId: PRODUCT_ID, sellfOrigin: SF_ORIGIN });
    expect(script).toContain('history.replaceState');
  });

  it('redirects to /loginwall/protect when no token is present', () => {
    const script = buildLoginwallScript({ productId: PRODUCT_ID, sellfOrigin: SF_ORIGIN });
    expect(script).toContain(`${SF_ORIGIN}/loginwall/protect?id=${PRODUCT_ID}`);
  });

  it('does not embed any secret in the script body', () => {
    const script = buildLoginwallScript({ productId: PRODUCT_ID, sellfOrigin: SF_ORIGIN });
    expect(script.toLowerCase()).not.toContain('secret');
    expect(script.toLowerCase()).not.toContain('hmac');
  });

  it('rejects an invalid product id', () => {
    expect(() => buildLoginwallScript({ productId: 'nope', sellfOrigin: SF_ORIGIN })).toThrow();
  });
});
