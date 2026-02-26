/**
 * SECURITY TEST: Open Redirect in /api/auth/logout
 *
 * Vulnerability: The logout endpoint accepts returnUrl parameter
 * and redirects to it without validation, enabling phishing attacks.
 */

import { test, expect } from '@playwright/test';

test.describe('Open Redirect - Logout Endpoint', () => {
  test('SECURITY: Should reject external URLs in returnUrl', async ({ request }) => {
    const externalUrl = 'https://evil-phishing-site.com/fake-login';

    const response = await request.get(`/api/auth/logout?returnUrl=${encodeURIComponent(externalUrl)}`, {
      maxRedirects: 0, // Don't follow redirects
    });

    // Should be a redirect (302 or 307)
    expect([302, 307]).toContain(response.status());

    // Check the Location header
    const location = response.headers()['location'];
    expect(location, 'Expected Location header in redirect response').toBeTruthy();
    console.log(`\nExternal URL test:`);
    console.log(`  Requested returnUrl: ${externalUrl}`);
    console.log(`  Redirect Location: ${location}`);

    // Should NOT redirect to external domain
    expect(location).not.toContain('evil-phishing-site.com');

    // Should redirect to root instead (full URL or just /)
    expect(location).toMatch(/^(http:\/\/localhost:\d+)?\/$/)
  });

  test('SECURITY: Should reject protocol-relative URLs', async ({ request }) => {
    // //evil.com is a protocol-relative URL
    const protoRelativeUrl = '//evil.com/phishing';

    const response = await request.get(`/api/auth/logout?returnUrl=${encodeURIComponent(protoRelativeUrl)}`, {
      maxRedirects: 0,
    });

    expect([302, 307]).toContain(response.status());

    const location = response.headers()['location'];
    expect(location, 'Expected Location header in redirect response').toBeTruthy();
    console.log(`\nProtocol-relative URL test:`);
    console.log(`  Requested returnUrl: ${protoRelativeUrl}`);
    console.log(`  Redirect Location: ${location}`);

    expect(location).not.toContain('evil.com');
    expect(location).toMatch(/^(http:\/\/localhost:\d+)?\/$/);
  });

  test('SECURITY: Should reject javascript: URLs', async ({ request }) => {
    const jsUrl = 'javascript:alert(1)';

    const response = await request.get(`/api/auth/logout?returnUrl=${encodeURIComponent(jsUrl)}`, {
      maxRedirects: 0,
    });

    expect([302, 307]).toContain(response.status());

    const location = response.headers()['location'];
    expect(location, 'Expected Location header in redirect response').toBeTruthy();
    console.log(`\nJavaScript URL test:`);
    console.log(`  Requested returnUrl: ${jsUrl}`);
    console.log(`  Redirect Location: ${location}`);

    expect(location).not.toContain('javascript:');
    expect(location).toMatch(/^(http:\/\/localhost:\d+)?\/$/);
  });

  test('Should allow safe relative paths', async ({ request }) => {
    const safePath = '/dashboard';

    const response = await request.get(`/api/auth/logout?returnUrl=${encodeURIComponent(safePath)}`, {
      maxRedirects: 0,
    });

    expect([302, 307]).toContain(response.status());

    const location = response.headers()['location'];
    expect(location, 'Expected Location header in redirect response').toBeTruthy();
    console.log(`\nRelative path test:`);
    console.log(`  Requested returnUrl: ${safePath}`);
    console.log(`  Redirect Location: ${location}`);

    // Should redirect to the requested path
    expect(location).toContain('/dashboard');
  });

  test('Should default to / when no returnUrl', async ({ request }) => {
    const response = await request.get('/api/auth/logout', {
      maxRedirects: 0,
    });

    expect([302, 307]).toContain(response.status());

    const location = response.headers()['location'];
    expect(location, 'Expected Location header in redirect response').toBeTruthy();
    console.log(`\nNo returnUrl test:`);
    console.log(`  Redirect Location: ${location}`);

    expect(location).toMatch(/^(http:\/\/localhost:\d+)?\/$/)
  });
});
