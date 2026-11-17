/**
 * Maintenance mode at the proxy: which requests get the 503 maintenance answer, that the server file
 * works without any database request, and that the database switch reaches the proxy.
 * @see src/proxy.ts
 * @see src/lib/maintenance/surfaces.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyMaintenancePath } from '@/lib/maintenance/surfaces';
import { invalidateMaintenanceCache } from '@/lib/maintenance/state';
import { proxy } from '@/proxy';

vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }) }));
vi.mock('next-intl/middleware', () => ({
  default: () => () => new Response(null, { status: 200, headers: { 'x-test-intl': '1' } }),
}));

const request = (pathname: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(new URL(`http://localhost${pathname}`), init);

describe('classifyMaintenancePath', () => {
  it.each([
    ['/', 'page'], ['/pl', 'page'], ['/store', 'page'], ['/en/store', 'page'],
    ['/p/course', 'page'], ['/pl/p/course', 'page'], ['/product/course', 'page'],
    ['/checkout', 'page'], ['/checkout/course', 'page'], ['/pl/checkout/course', 'page'],
    ['/offer/course', 'page'], ['/v/group-1', 'page'],
    ['/loginwall/protect', 'page'], ['/pl/loginwall/gate', 'page'],
    ['/api/create-payment-intent', 'api'], ['/api/embed/checkout-session', 'api'], ['/api/embed/free-access', 'api'],
    ['/api/orders/bank-transfer', 'api'], ['/api/orders/0b7f1d0e-3a2c-4e55-9a51-2f8b9c1d2e3f/pay', 'api'],
    ['/api/public/products/course/grant-access', 'api'],
    ['/api/coupons/verify', 'api'], ['/api/coupons/auto-apply', 'api'], ['/api/order-bumps', 'api'],
    ['/api/loginwall/gate.js', 'api'], ['/api/loginwall/login.js', 'api'], ['/api/loginwall/verify', 'api'],
  ] as const)('%s is paused (%s)', (pathname, surface) => {
    expect(classifyMaintenancePath(pathname)).toBe(surface);
  });

  it.each([
    // Admin panel, sign-in and the buyer's account keep working.
    '/admin', '/dashboard', '/dashboard/settings', '/pl/dashboard/products', '/login', '/pl/login', '/auth/callback',
    '/my-products', '/my-purchases', '/profile',
    // Purchases started before the break finish: Stripe webhooks, the return pages and payment confirmation.
    '/api/webhooks/stripe', '/p/course/payment-status', '/pl/p/course/payment-status', '/payment/success',
    '/api/verify-payment', '/api/update-payment-metadata', '/api/orders/bank-transfer/declare',
    // Operations, API v1, health and legal pages.
    '/api/health', '/api/status', '/api/cron', '/api/v1/products', '/api/v1/system/maintenance', '/api/admin/payments',
    '/api/runtime-config', '/terms', '/privacy', '/pl/legal/terms', '/embed/v1/checkout.js',
  ])('%s keeps working', pathname => {
    expect(classifyMaintenancePath(pathname)).toBeNull();
  });
});

describe('proxy in maintenance mode', () => {
  let dir = '';
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let databaseEnabled = false;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'sellf-proxy-maintenance-'));
    vi.stubEnv('SELLF_MAINTENANCE_FILE', path.join(dir, 'MAINTENANCE'));
    vi.stubEnv('SELLF_MAINTENANCE', '');
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:9');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
    databaseEnabled = false;
    invalidateMaintenanceCache();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/rpc/get_maintenance_mode')) {
        return new Response(JSON.stringify([{ enabled: databaseEnabled, message: databaseEnabled ? 'Inventory day' : null, expected_end_at: null }]), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const maintenanceCalls = () => fetchSpy.mock.calls.filter(([input]) => String(input).includes('get_maintenance_mode')).length;

  it('the server file answers 503 before any database request, even when the database is unreachable @J653', async () => {
    fetchSpy.mockImplementation(async () => { throw new TypeError('fetch failed'); });
    writeFileSync(path.join(dir, 'MAINTENANCE'), JSON.stringify({ reason: 'upgrade', message: 'Updating', expected_end_at: new Date(Date.now() + 120_000).toISOString() }));

    const page = await proxy(request('/pl/p/course'));
    expect(page.status).toBe(503);
    expect(Number(page.headers.get('Retry-After'))).toBeGreaterThanOrEqual(60);
    expect(page.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(page.headers.get('Content-Type')).toContain('text/html');
    expect(page.headers.get('Cache-Control')).toContain('no-store');
    const html = await page.text();
    expect(html).toContain('<html lang="pl"');
    expect(html).toContain('Przerwa techniczna');
    expect(html).toContain('Updating');

    const api = await proxy(request('/api/create-payment-intent', { method: 'POST' }));
    expect(api.status).toBe(503);
    expect(await api.json()).toMatchObject({ code: 'MAINTENANCE', maintenance: { message: 'Updating' } });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('English page by Accept-Language, message escaped as text', async () => {
    writeFileSync(path.join(dir, 'MAINTENANCE'), '<script>alert(1)</script>');
    const page = await proxy(request('/checkout/course', { headers: { 'accept-language': 'en-US,en;q=0.9' } }));
    const html = await page.text();
    expect(html).toContain('<html lang="en"');
    expect(html).toContain('down for maintenance');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });

  it('Stripe webhooks, the admin panel and the payment return page pass through while the file is present @J651', async () => {
    writeFileSync(path.join(dir, 'MAINTENANCE'), '');
    for (const pathname of ['/api/webhooks/stripe', '/dashboard', '/p/course/payment-status', '/api/health']) {
      const response = await proxy(request(pathname, { method: pathname.startsWith('/api/webhooks') ? 'POST' : 'GET' }));
      expect(response.status, pathname).not.toBe(503);
    }
  });

  it('the database switch pauses the checkout API; switching it off and invalidating the cache resumes it @J650', async () => {
    expect((await proxy(request('/api/embed/checkout-session', { method: 'POST' }))).status).not.toBe(503);

    databaseEnabled = true;
    invalidateMaintenanceCache();
    const paused = await proxy(request('/api/embed/checkout-session', { method: 'POST' }));
    expect(paused.status).toBe(503);
    expect(await paused.json()).toMatchObject({ code: 'MAINTENANCE', maintenance: { message: 'Inventory day' } });
    expect(paused.headers.get('Retry-After')).toBe('300');

    databaseEnabled = false;
    invalidateMaintenanceCache();
    expect((await proxy(request('/api/embed/checkout-session', { method: 'POST' }))).status).not.toBe(503);
  });

  it('reads the database switch at most once per cache window, and never for admin traffic', async () => {
    await proxy(request('/dashboard'));
    await proxy(request('/api/v1/products'));
    expect(maintenanceCalls()).toBe(0);
    await proxy(request('/store'));
    await proxy(request('/p/course'));
    expect(maintenanceCalls()).toBe(1);
  });

  it('an unreachable database does not put the shop into maintenance', async () => {
    fetchSpy.mockImplementation(async () => { throw new TypeError('fetch failed'); });
    expect((await proxy(request('/store'))).status).not.toBe(503);
  });
});
