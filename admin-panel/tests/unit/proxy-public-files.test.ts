import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from '@/proxy';

const { getUser, intl } = vi.hoisted(() => ({
  getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
  intl: vi.fn(() => new Response(null, { headers: { 'x-test-intl': '1' } })),
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser } }) }));
vi.mock('next-intl/middleware', () => ({ default: () => intl }));

const request = (path: string) => new NextRequest(`http://localhost${path}`);
const publicFiles = readdirSync(resolve('public'), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => resolve(entry.parentPath, entry.name).slice(resolve('public').length));

describe('public files through proxy', () => {
  it.each(['/icon.svg', '/_next/static/chunks/app.js', '/_next/image'])('serves %s outside proxy', path => {
    expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(false);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DISABLE_HSTS', 'false');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([...publicFiles,
    '/embed/v1/checkout.js', '/sitemap.xml', '/api/loginwall/gate.js',
    '/api/loginwall/login.js', '/api/v1/openapi.json',
    '/_next/static/chunks/app.js', '/_next/image',
  ])('serves %s without locale or session handling and with shared headers', async path => {
    const response = await proxy(request(`${path}?download=1`));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
    expect(intl).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(response.headers.get('Content-Security-Policy')).toContain("'nonce-");
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=');
  });

  it.each([
    '/pl/login', '/pl/llms.txt', '/missing.txt', '/auth-email-templates', '/private.md',
    '/package.json', '/src/proxy.ts', '/public/llms.txt',
    '/%2e%2e%2fpackage.json', '/%E0%A4%A', '/llms.txt/extra',
  ])('keeps normal locale routing for %s', async path => {
    await proxy(request(path));
    expect(intl).toHaveBeenCalledOnce();
    expect(getUser).toHaveBeenCalledTimes(path === '/pl/login' ? 1 : 0);
  });

  it.each(['/pl/admin/export.txt', '/dashboard/report.html', '/my-products/course.js'])('keeps session checks for %s', async path => {
    const response = await proxy(request(path));
    expect(getUser).toHaveBeenCalledOnce();
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
  });
});
