import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { isSessionWriteAllowed } from '@/lib/security/session-write-guard';

const SITE_URL = 'https://shop.example.com';

function makeRequest(options: {
  method: string;
  origin?: string | null;
  secFetchSite?: string | null;
  contentType?: string | null;
  contentLength?: number | null;
}): NextRequest {
  const headers = new Headers();
  if (options.origin) headers.set('origin', options.origin);
  if (options.secFetchSite) headers.set('sec-fetch-site', options.secFetchSite);
  if (options.contentType) headers.set('content-type', options.contentType);
  if (options.contentLength !== undefined && options.contentLength !== null) {
    headers.set('content-length', String(options.contentLength));
  }
  return new NextRequest('http://localhost/api/v1/api-keys', {
    method: options.method,
    headers,
  });
}

describe('isSessionWriteAllowed', () => {
  const originalSiteUrl = process.env.SITE_URL;

  beforeEach(() => {
    process.env.SITE_URL = SITE_URL;
  });

  afterEach(() => {
    process.env.SITE_URL = originalSiteUrl;
  });

  it('always allows GET/HEAD/OPTIONS regardless of origin', () => {
    expect(isSessionWriteAllowed(makeRequest({ method: 'GET', origin: 'https://evil.example' }))).toBe(true);
    expect(isSessionWriteAllowed(makeRequest({ method: 'HEAD' }))).toBe(true);
    expect(isSessionWriteAllowed(makeRequest({ method: 'OPTIONS' }))).toBe(true);
  });

  it('allows a same-origin JSON POST', () => {
    const req = makeRequest({
      method: 'POST',
      origin: SITE_URL,
      contentType: 'application/json',
      contentLength: 42,
    });
    expect(isSessionWriteAllowed(req)).toBe(true);
  });

  it('rejects a POST with a JSON body sent as text/plain', () => {
    const req = makeRequest({
      method: 'POST',
      origin: SITE_URL,
      contentType: 'text/plain',
      contentLength: 42,
    });
    expect(isSessionWriteAllowed(req)).toBe(false);
  });

  it('rejects a POST from another origin', () => {
    const req = makeRequest({
      method: 'POST',
      origin: 'https://other.example.com',
      contentType: 'application/json',
      contentLength: 42,
    });
    expect(isSessionWriteAllowed(req)).toBe(false);
  });

  it('falls back to Sec-Fetch-Site when Origin is absent', () => {
    const sameOrigin = makeRequest({
      method: 'DELETE',
      secFetchSite: 'same-origin',
    });
    expect(isSessionWriteAllowed(sameOrigin)).toBe(true);

    const sameSite = makeRequest({
      method: 'DELETE',
      secFetchSite: 'same-site',
    });
    expect(isSessionWriteAllowed(sameSite)).toBe(false);

    const crossSite = makeRequest({
      method: 'DELETE',
      secFetchSite: 'cross-site',
    });
    expect(isSessionWriteAllowed(crossSite)).toBe(false);
  });

  it('allows a JSON request from a non-browser client (neither Origin nor Sec-Fetch-Site)', () => {
    const req = makeRequest({ method: 'POST', contentType: 'application/json' });
    expect(isSessionWriteAllowed(req)).toBe(true);
  });

  it('still requires a JSON body from a non-browser client', () => {
    const req = makeRequest({ method: 'POST', contentType: 'text/plain' });
    expect(isSessionWriteAllowed(req)).toBe(false);
  });

  it('rejects a browser request whose Sec-Fetch-Site is cross-site even without Origin', () => {
    const req = makeRequest({ method: 'POST', secFetchSite: 'same-site', contentType: 'application/json' });
    expect(isSessionWriteAllowed(req)).toBe(false);
  });

  it('allows a bodyless DELETE from the site origin without a Content-Type', () => {
    const req = makeRequest({ method: 'DELETE', origin: SITE_URL });
    expect(isSessionWriteAllowed(req)).toBe(true);
  });

  it('rejects when SITE_URL is not configured', () => {
    delete process.env.SITE_URL;
    const req = makeRequest({ method: 'POST', origin: SITE_URL, contentType: 'application/json' });
    expect(isSessionWriteAllowed(req)).toBe(false);
  });
});
