import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { waitForEmail, extractMagicLink, deleteAllMessages } from './helpers/mailpit';
import { acceptAllCookies } from './helpers/consent';

// Enforce single worker because we modify global DB state (products)
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Funnel Mechanics (Redirects & OTO)', () => {
  
  test.beforeAll(async () => {
    try { await deleteAllMessages(); } catch {}
  });

  test('Scenario 1: DB Configured Redirect (Free Product -> OTO)', async ({ page }) => {
    const otoSlug = `oto-db-${Date.now()}`;
    const productSlug = `free-db-${Date.now()}`;
    
    // 1. Create OTO Product (Target)
    await supabaseAdmin.from('products').insert({
      name: 'OTO Target DB',
      slug: otoSlug,
      price: 10,
      is_active: true
    });

    // 2. Create Free Product with DB Redirect
    // We redirect to the CHECKOUT of the OTO product to simulate a funnel
    const redirectUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3777'}/checkout/${otoSlug}`;
    
    await supabaseAdmin.from('products').insert({
      name: 'Free Trigger DB',
      slug: productSlug,
      price: 0,
      is_active: true,
      success_redirect_url: redirectUrl,
      pass_params_to_redirect: true
    });

    // 3. Purchase Flow
    await acceptAllCookies(page);
    await page.goto(`/p/${productSlug}`); // Should redirect to checkout/slug for free product
    
    const email = `funnel-db-${Date.now()}@example.com`;
    await page.locator('input[type="email"]').fill(email);
    
    const terms = page.locator('label').filter({ hasText: /agree|akceptuję/i });
    if (await terms.count() > 0) await terms.click();
    
    // Wait for Captcha to auto-solve (dev mode)
    await page.waitForTimeout(4000); 

    const submitBtn = page.getByRole('button', { name: /Get|Odbierz|Send|Wyślij/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Check if security verification error appeared
    const securityError = page.getByText(/security verification|weryfikację/i);
    if (await securityError.isVisible()) {
      await page.waitForTimeout(3000); // Wait more
      await submitBtn.click();
    }

    // 4. Handle Magic Link
    await expect(page.getByText(/Check your email|sprawdź swoją skrzynkę/i).first()).toBeVisible({ timeout: 15000 });
    const message = await waitForEmail(email);
    const magicLink = extractMagicLink(message.Text!);
    
    // 5. Verify Redirect
    await page.goto(magicLink!);
    
    // Should pass through payment-status and land on OTO Checkout
    await expect(page).toHaveURL(new RegExp(`/checkout/${otoSlug}`), { timeout: 30000 });
  });

  test('Scenario 2: URL Override Redirect (Free Product -> Custom OTO)', async ({ page }) => {
    const otoSlug = `oto-link-${Date.now()}`;
    const productSlug = `free-link-${Date.now()}`;
    
    // 1. Create Products
    await supabaseAdmin.from('products').insert({
      name: 'OTO Target Link',
      slug: otoSlug,
      price: 10,
      is_active: true
    });
    
    // Free product WITHOUT configured redirect (default behavior)
    await supabaseAdmin.from('products').insert({
      name: 'Free Trigger Link',
      slug: productSlug,
      price: 0,
      is_active: true
    });

    // 2. Construct Override URL
    const targetUrl = `/checkout/${otoSlug}`; // Relative URL
    const entryUrl = `/checkout/${productSlug}?success_url=${encodeURIComponent(targetUrl)}`;

    // 3. Purchase Flow with Override
    await acceptAllCookies(page);
    await page.goto(entryUrl);
    
    const email = `funnel-link-${Date.now()}@example.com`;
    await page.locator('input[type="email"]').fill(email);
    
    const terms = page.locator('label').filter({ hasText: /agree|akceptuję/i });
    if (await terms.count() > 0) await terms.click();
    
    // Wait for Captcha
    await page.waitForTimeout(4000);

    const submitBtn = page.getByRole('button', { name: /Get|Odbierz|Send|Wyślij/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Check if security verification error appeared
    const securityError = page.getByText(/security verification|weryfikację/i);
    if (await securityError.isVisible()) {
      await page.waitForTimeout(3000); // Wait more
      await submitBtn.click();
    }

    // 4. Handle Magic Link
    await expect(page.getByText(/Check your email|sprawdź swoją skrzynkę/i).first()).toBeVisible({ timeout: 15000 });
    const message = await waitForEmail(email);
    const magicLink = extractMagicLink(message.Text!);
    
    // The magic link itself should contain the success_url param (encoded) if our code works
    expect(magicLink).toContain('success_url');

    // 5. Verify Redirect
    await page.goto(magicLink!);
    
    // Should land on Custom OTO
    await expect(page).toHaveURL(new RegExp(`/checkout/${otoSlug}`), { timeout: 30000 });
  });

});