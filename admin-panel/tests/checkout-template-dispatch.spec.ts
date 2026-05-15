import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Render-time E2E for the per-product checkout template dispatcher.
// `tip-jar-template.spec.ts` already covers 'tip-jar' end-to-end; this spec
// fills the gap for 'default' and 'oto':
//   - default → standard ProductPurchaseView, no BMC sidebar, no countdown
//   - oto without ?oto=1 → standard form (template stays graceful for direct visits)
//   - oto with ?oto=1&coupon=... → countdown banner + decline button visible
//
// Funnel decline navigation is covered separately by
// funnel-mechanics.spec.ts:Scenario 4; here we verify the template ITSELF.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function createProduct(template: 'default' | 'oto', label: string) {
  const slug = `ctmpl-${template}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      name: `${label} ${Date.now()}`,
      slug,
      price: 49.99,
      currency: 'USD',
      is_active: true,
      checkout_template: template,
    })
    .select('id, slug, name')
    .single();
  if (error || !data) throw error;
  return data as { id: string; slug: string; name: string };
}

test.describe('Checkout template dispatch (default / oto)', () => {
  test.describe.configure({ mode: 'parallel' });

  test('default template renders standard checkout (no BMC sidebar, no countdown)', async ({ page }) => {
    const p = await createProduct('default', 'Default Template');
    try {
      await page.goto(`/pl/checkout/${p.slug}`);
      await expect(page.getByRole('heading', { name: p.name })).toBeVisible({ timeout: 15000 });
      // No BMC-style sidebar (tip-jar exclusive)
      await expect(page.getByText(/Ostatni wspierający|Recent supporters/i)).toHaveCount(0);
      // No OTO countdown banner
      await expect(page.getByTestId('oto-countdown-banner')).toHaveCount(0);
      // No decline button
      await expect(page.getByTestId('oto-decline-button')).toHaveCount(0);
    } finally {
      await supabaseAdmin.from('products').delete().eq('id', p.id);
    }
  });

  test('oto template without ?oto=1 renders standard form (graceful direct visit)', async ({ page }) => {
    const p = await createProduct('oto', 'OTO Template Direct');
    try {
      await page.goto(`/pl/checkout/${p.slug}`);
      // The product form renders normally
      await expect(page.getByRole('heading', { name: p.name })).toBeVisible({ timeout: 15000 });
      // No countdown — countdown is conditional on URL ?oto=1
      await expect(page.getByTestId('oto-countdown-banner')).toHaveCount(0);
      // No decline button — needs downsell_coupon + downsell_slug + oto=1
      await expect(page.getByTestId('oto-decline-button')).toHaveCount(0);
    } finally {
      await supabaseAdmin.from('products').delete().eq('id', p.id);
    }
  });

  test('oto template with ?oto=1 + valid coupon renders countdown + decline button', async ({ page }) => {
    // Need real OTO coupon for useOto to validate via /api/oto/info — set up
    // a minimal source→upsell+downsell offer and pre-mint via the RPC, then
    // visit the upsell checkout directly with both branches in URL.
    const stamp = Date.now();
    const source = await createProduct('default', 'Render Source');
    const upsell = await createProduct('oto', 'Render Upsell');
    const downsell = await createProduct('default', 'Render Downsell');
    try {
      const { data: offer } = await supabaseAdmin
        .from('oto_offers')
        .insert({
          source_product_id: source.id,
          oto_product_id: upsell.id,
          discount_type: 'percentage',
          discount_value: 25,
          duration_minutes: 15,
          downsell_product_id: downsell.id,
          downsell_discount_type: 'percentage',
          downsell_discount_value: 50,
          downsell_duration_minutes: 15,
          is_active: true,
        })
        .select('id')
        .single();
      expect(offer).toBeDefined();

      const email = `ctmpl-render-${stamp}@example.com`;
      const { data: tx } = await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: `cs_test_ctmpl_${stamp}`,
          product_id: source.id,
          customer_email: email,
          amount: 49.99,
          currency: 'USD',
          status: 'completed',
        })
        .select('id')
        .single();

      const { data: rpc } = await supabaseAdmin.rpc('generate_oto_coupon', {
        source_product_id_param: source.id,
        customer_email_param: email,
        transaction_id_param: tx!.id,
      });
      const result = rpc as Record<string, unknown>;
      const upsellCode = (result.upsell_code ?? result.coupon_code) as string;
      const downsellCode = result.downsell_code as string;
      expect(upsellCode).toMatch(/^OTO-/);
      expect(downsellCode).toMatch(/^OTO-/);

      await page.goto(
        `/checkout/${upsell.slug}?oto=1&coupon=${upsellCode}`
          + `&email=${encodeURIComponent(email)}`
          + `&downsell_coupon=${downsellCode}&downsell_slug=${downsell.slug}`,
      );

      await expect(page.getByTestId('oto-countdown-banner')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('oto-decline-button')).toBeVisible();
    } finally {
      await supabaseAdmin.from('products').delete().eq('id', source.id);
      await supabaseAdmin.from('products').delete().eq('id', upsell.id);
      await supabaseAdmin.from('products').delete().eq('id', downsell.id);
    }
  });
});
