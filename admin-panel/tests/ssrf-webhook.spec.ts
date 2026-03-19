/**
 * SECURITY TEST: SSRF in Webhook URL Configuration
 *
 * Vulnerability: Admin can configure webhooks to internal IP addresses,
 * potentially accessing internal services, cloud metadata, etc.
 */

import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession } from './helpers/admin-auth';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Helper to login as admin via browser
async function loginAsAdmin(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await setAuthSession(page, email, password);

  await page.waitForTimeout(500);
}

test.describe('SSRF - Webhook URL Validation', () => {
  test.describe.configure({ mode: 'serial' });

  let adminUserId: string;
  let adminEmail: string;
  const password = 'TestPassword123!';

  test.beforeAll(async () => {
    const suffix = Date.now().toString();
    adminEmail = `ssrf-admin-${suffix}@example.com`;

    // Create admin user
    const { data: adminData, error: adminError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
    });
    if (adminError) throw adminError;
    adminUserId = adminData.user!.id;

    // Make user an admin
    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    console.log(`Created admin user: ${adminUserId}`);
  });

  test.afterAll(async () => {
    // Cleanup
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  const ssrfUrls = [
    { url: 'http://127.0.0.1:8080/internal', name: 'localhost IPv4' },
    { url: '/api', name: 'localhost hostname' },
    { url: 'http://10.0.0.1/admin', name: 'private IP (10.x)' },
    { url: 'http://192.168.1.1/admin', name: 'private IP (192.168.x)' },
    { url: 'http://172.16.0.1/admin', name: 'private IP (172.16.x)' },
    { url: 'http://169.254.169.254/latest/meta-data/', name: 'AWS metadata' },
    { url: 'http://metadata.google.internal/', name: 'GCP metadata' },
    { url: 'http://[::1]:8080/internal', name: 'localhost IPv6' },
  ];

  for (const { url, name } of ssrfUrls) {
    test(`SECURITY: Should reject ${name} URL`, async ({ page }) => {
      await loginAsAdmin(page, adminEmail, password);

      console.log(`\nSSRF Test (${name}):`);
      console.log(`  URL: ${url}`);

      // Try to create webhook with internal URL
      const response = await page.evaluate(async (webhookUrl) => {
        const res = await fetch('/api/v1/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: webhookUrl,
            events: ['payment.completed'],
            description: 'SSRF test webhook',
          }),
        });
        return { status: res.status, ok: res.ok, body: await res.json() };
      }, url);

      console.log(`  Response status: ${response.status}`);
      console.log(`  Response: ${JSON.stringify(response.body)}`);

      // Should reject internal URLs with 400 Bad Request
      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('URL');

      // Cleanup if the URL was incorrectly accepted (vulnerability detected)
      if (response.status === 201 || response.status === 200) {
        console.log(`  VULNERABILITY: Internal URL was accepted!`);
        if (response.body?.id) {
          await supabaseAdmin.from('webhook_endpoints').delete().eq('id', response.body.id);
        }
      }
    });
  }

  test('Should allow valid external URLs', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, password);

    const validUrl = 'https://example.com/webhook';

    console.log(`\nValid URL Test:`);
    console.log(`  URL: ${validUrl}`);

    const response = await page.evaluate(async (webhookUrl) => {
      const res = await fetch('/api/v1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          events: ['payment.completed'],
          description: 'Valid test webhook',
        }),
      });
      return { status: res.status, ok: res.ok, body: await res.json() };
    }, validUrl);

    console.log(`  Response status: ${response.status}`);

    // Should accept valid external URLs
    expect(response.ok).toBe(true);
    expect(response.body.data.url).toBe(validUrl);

    // Cleanup
    if (response.body?.data?.id) {
      await supabaseAdmin.from('webhook_endpoints').delete().eq('id', response.body.data.id);
    }
  });
});
