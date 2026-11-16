/** GET /api/v1/openapi.json: public, cacheable, the generated document. @see src/app/api/v1/openapi.json/route.ts */
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, OPTIONS } from '@/app/api/v1/openapi.json/route';

const url = 'http://localhost/api/v1/openapi.json';

describe('GET /api/v1/openapi.json', () => {
  it('serves the OpenAPI 3.1 document without credentials', async () => {
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const spec = await response.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths['/products'].post.operationId).toBe('create_product');
    expect(spec.servers).toEqual([{ url: '/api/v1', description: 'This Sellf instance' }]);
  });

  it('answers 304 to a matching If-None-Match', async () => {
    const first = await GET(new NextRequest(url));
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    const second = await GET(new NextRequest(url, { headers: { 'if-none-match': etag! } }));
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('ignores a forged Host header (relative server URL)', async () => {
    const response = await GET(new NextRequest(url, { headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' } }));
    expect(await response.text()).not.toContain('evil.example');
  });

  it('allows a cross-origin preflight', async () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
  });
});
