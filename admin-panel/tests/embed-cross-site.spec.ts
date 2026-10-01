/**
 * Cross-site embed loading — covers the exact gap the previous CORP
 * regression hid: the embed checkout loader and the login-wall / gating
 * loader scripts are meant to be pulled in via `<script src>` from a
 * seller's own page, which is a genuinely different SITE from the Sellf
 * app, not just a different port on the same host. A same-site check
 * (e.g. two localhost ports) would pass even when the browser would
 * actually block a real cross-site load.
 *
 * To get a real cross-site boundary without any DNS/hosts setup, the
 * "seller page" is served from `127.0.0.1` while the app runs on
 * `localhost` (or vice versa) — different hostnames are always a
 * different site, regardless of port.
 *
 * Run directly:
 *   bunx playwright test tests/embed-cross-site.spec.ts --project=chromium
 *
 * (Playwright's own `webServer` config starts the app; no DB/session setup
 * is needed — none of the three loader routes touch the database, they
 * only need a syntactically valid product id / slug.)
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

function crossSiteHost(sellfOrigin: string): string {
  // "Site" = scheme + registrable domain; different hostnames are always
  // a different site (no shared eTLD+1), regardless of port.
  return new URL(sellfOrigin).hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1';
}

async function startSellerPage(host: string, html: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${host}:${port}/`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test.describe('Embed loader scripts on a real cross-site seller page', () => {
  test('checkout.js, login.js and gate.js load without a CORP block', async ({ page, baseURL }) => {
    const sellfOrigin = baseURL ?? 'http://localhost:3777';
    const productId = randomUUID();

    const html = `<!doctype html>
<html><body>
  <div data-sellf-embed data-product-slug="demo-product"></div>
  <script src="${sellfOrigin}/embed/v1/checkout.js"></script>
  <script src="${sellfOrigin}/api/loginwall/login.js?id=${productId}"></script>
  <script src="${sellfOrigin}/api/loginwall/gate.js?products=demo-product"></script>
</body></html>`;

    const seller = await startSellerPage(crossSiteHost(sellfOrigin), html);
    try {
      // Only the three loader scripts are under test. What they fetch afterwards
      // (e.g. checkout-session) follows the seller's origin allowlist, which this
      // throwaway page is not on.
      const loaderPaths = ['/embed/v1/checkout.js', '/api/loginwall/login.js', '/api/loginwall/gate.js'];
      const blocked: string[] = [];
      page.on('requestfailed', (req) => {
        const url = req.url();
        if (loaderPaths.some((path) => url.startsWith(`${sellfOrigin}${path}`))) {
          blocked.push(`${req.url()} :: ${req.failure()?.errorText ?? 'unknown'}`);
        }
      });

      const [checkoutRes, loginRes, gateRes] = await Promise.all([
        page.waitForResponse((res) => res.url() === `${sellfOrigin}/embed/v1/checkout.js`),
        page.waitForResponse((res) => res.url().startsWith(`${sellfOrigin}/api/loginwall/login.js`)),
        page.waitForResponse((res) => res.url().startsWith(`${sellfOrigin}/api/loginwall/gate.js`)),
        page.goto(seller.url),
      ]);

      expect(blocked, `Requests blocked by the browser: ${blocked.join(', ')}`).toEqual([]);

      for (const res of [checkoutRes, loginRes, gateRes]) {
        expect(res.status(), res.url()).toBe(200);
        expect(res.headers()['cross-origin-resource-policy'], res.url()).toBe('cross-origin');
      }

      // login.js / gate.js also carry their own short public cache — this is
      // the header that used to lose to the generic API no-store default.
      expect(loginRes.headers()['cache-control']).toBe('public, max-age=300, s-maxage=300');
      expect(gateRes.headers()['cache-control']).toBe('public, max-age=300, s-maxage=300');
    } finally {
      await seller.close();
    }
  });
});
