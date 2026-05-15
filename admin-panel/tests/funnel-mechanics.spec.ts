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

  test('Scenario 4: Decline upsell → land on downsell checkout with downsell coupon applied', async ({ page }) => {
    const stamp = Date.now();
    const sourceSlug = `src-decline-${stamp}`;
    const upsellSlug = `up-decline-${stamp}`;
    const downsellSlug = `down-decline-${stamp}`;

    const { data: source } = await supabaseAdmin
      .from('products')
      .insert({ name: `Src Decline ${stamp}`, slug: sourceSlug, price: 49.99, currency: 'USD', is_active: true })
      .select()
      .single();
    const { data: upsell } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Up Decline ${stamp}`,
        slug: upsellSlug,
        price: 99.99,
        currency: 'USD',
        is_active: true,
        // Upsell uses the new 'oto' template so the decline button is rendered.
        checkout_template: 'oto',
      })
      .select()
      .single();
    const { data: downsell } = await supabaseAdmin
      .from('products')
      .insert({ name: `Down Decline ${stamp}`, slug: downsellSlug, price: 29.99, currency: 'USD', is_active: true })
      .select()
      .single();

    const { data: offer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: source!.id,
        oto_product_id: upsell!.id,
        discount_type: 'percentage',
        discount_value: 30,
        duration_minutes: 15,
        downsell_product_id: downsell!.id,
        downsell_discount_type: 'percentage',
        downsell_discount_value: 50,
        downsell_duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();
    expect(offer, 'oto_offer with downsell columns must accept insert').toBeDefined();

    // Pre-generate both coupons via RPC (simulating the webhook side-effect after source purchase)
    const email = `funnel-decline-${stamp}@example.com`;
    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: `cs_test_decline_${stamp}`,
        product_id: source!.id,
        customer_email: email,
        amount: 49.99,
        currency: 'USD',
        status: 'completed',
      })
      .select()
      .single();

    const { data: rpc, error: rpcErr } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: source!.id,
      customer_email_param: email,
      transaction_id_param: tx!.id,
    });
    expect(rpcErr).toBeNull();
    const upsellCode = (rpc as any).upsell_code ?? (rpc as any).coupon_code;
    const downsellCode = (rpc as any).downsell_code;
    expect(upsellCode).toMatch(/^OTO-/);
    expect(downsellCode, 'downsell coupon code must be generated').toMatch(/^OTO-/);

    // Visit upsell checkout in OTO mode (countdown + decline button).
    // payment-status injects downsell_coupon + downsell_slug into the URL;
    // we replicate that here since the test bypasses the source purchase.
    await acceptAllCookies(page);
    await page.goto(
      `/checkout/${upsellSlug}?oto=1&coupon=${upsellCode}`
        + `&email=${encodeURIComponent(email)}`
        + `&downsell_coupon=${downsellCode}`
        + `&downsell_slug=${downsellSlug}`,
    );
    await expect(page.getByTestId('oto-countdown-banner')).toBeVisible({ timeout: 15000 });

    // Decline → should land on downsell checkout with downsell coupon param
    const declineBtn = page.getByTestId('oto-decline-button');
    await expect(declineBtn).toBeVisible();
    await declineBtn.click();

    await expect(page).toHaveURL(new RegExp(`/checkout/${downsellSlug}`), { timeout: 15000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('coupon')).toBe(downsellCode);
    expect(url.searchParams.get('oto')).toBe('1');
    expect(url.searchParams.get('email')).toBe(email);
  });

  test('Scenario 5: Chain emergent — A→B accept → B→C automatic via payment-status', async () => {
    // Pure DB-level check: two oto_offers chained (source A→upsell B; source B→upsell C)
    // After purchasing A then B in sequence, both transactions must produce
    // a generate_oto_coupon RPC result with has_oto=true and the right target.
    const stamp = Date.now();
    const { data: a } = await supabaseAdmin
      .from('products')
      .insert({ name: `Chain A ${stamp}`, slug: `chain-a-${stamp}`, price: 10, currency: 'USD', is_active: true })
      .select()
      .single();
    const { data: b } = await supabaseAdmin
      .from('products')
      .insert({ name: `Chain B ${stamp}`, slug: `chain-b-${stamp}`, price: 20, currency: 'USD', is_active: true })
      .select()
      .single();
    const { data: c } = await supabaseAdmin
      .from('products')
      .insert({ name: `Chain C ${stamp}`, slug: `chain-c-${stamp}`, price: 30, currency: 'USD', is_active: true })
      .select()
      .single();

    await supabaseAdmin.from('oto_offers').insert([
      {
        source_product_id: a!.id,
        oto_product_id: b!.id,
        discount_type: 'percentage',
        discount_value: 30,
        duration_minutes: 15,
        is_active: true,
      },
      {
        source_product_id: b!.id,
        oto_product_id: c!.id,
        discount_type: 'percentage',
        discount_value: 30,
        duration_minutes: 15,
        is_active: true,
      },
    ]);

    const email = `funnel-chain-${stamp}@example.com`;

    // Buy A → has_oto should point to B
    const { data: txA } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: `cs_test_chain_a_${stamp}`,
        product_id: a!.id,
        customer_email: email,
        amount: 10,
        currency: 'USD',
        status: 'completed',
      })
      .select()
      .single();

    const { data: rpcA } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: a!.id,
      customer_email_param: email,
      transaction_id_param: txA!.id,
    });
    expect((rpcA as any).has_oto).toBe(true);
    expect((rpcA as any).oto_product_id).toBe(b!.id);

    // Buy B → has_oto should point to C (emergent, no special config needed)
    const { data: txB } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: `cs_test_chain_b_${stamp}`,
        product_id: b!.id,
        customer_email: email,
        amount: 20,
        currency: 'USD',
        status: 'completed',
      })
      .select()
      .single();

    const { data: rpcB } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: b!.id,
      customer_email_param: email,
      transaction_id_param: txB!.id,
    });
    expect((rpcB as any).has_oto).toBe(true);
    expect((rpcB as any).oto_product_id).toBe(c!.id);
  });

});