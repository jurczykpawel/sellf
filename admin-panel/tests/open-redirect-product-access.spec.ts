/** Product content return navigation. @see src/app/[locale]/p/[slug]/components/ProductAccessView.tsx */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { ContentItem } from '@/types';
import { setAuthSession } from './helpers/admin-auth';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const contentLabel = 'Return navigation fixture';

test.describe('Product access return navigation', () => {
  test.describe.configure({ mode: 'serial' });
  let userId: string;
  let email: string;
  let productId: string;
  let slug: string;
  const password = 'TestPassword123!';

  test.beforeAll(async () => {
    const suffix = Date.now();
    email = `product-return-${suffix}@example.com`;
    slug = `product-return-${suffix}`;
    const { data: auth, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    expect(authError).toBeNull();
    userId = auth.user!.id;
    const contentItems: ContentItem[] = [{
      id: 'return-file', type: 'download_link', title: contentLabel,
      config: { download_url: 'https://example.com/course.pdf' }, order: 0, is_active: true,
    }];
    const { data: product, error: productError } = await supabaseAdmin.from('products').insert({
      name: 'Product return navigation', slug, price: 0, currency: 'USD', is_active: true,
      content_delivery_type: 'content',
      content_config: { content_items: contentItems },
    }).select('id').single();
    expect(productError).toBeNull();
    productId = product!.id;
    const { error: accessError } = await supabaseAdmin.from('user_product_access').insert({
      product_id: productId, user_id: userId, access_expires_at: null,
    });
    expect(accessError).toBeNull();
  });

  test.afterAll(async () => {
    if (productId) {
      const { error } = await supabaseAdmin.from('products').delete().eq('id', productId);
      expect(error).toBeNull();
    }
    if (userId) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      expect(error).toBeNull();
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await setAuthSession(page, email, password);
  });

  for (const [kind, returnUrl] of [
    ['external', 'https://evil-phishing-site.com/fake-login'],
    ['protocol-relative', '//evil.com/phishing'],
    ['script', 'javascript:alert(document.cookie)'],
  ]) {
    test(`keeps the product view for the ${kind} return location`, async ({ page }) => {
      const origin = new URL(page.url()).origin;
      let dialogShown = false;
      page.on('dialog', async dialog => { dialogShown = true; await dialog.dismiss(); });
      await page.goto(`/pl/p/${slug}?payment=success&return_url=${encodeURIComponent(returnUrl)}`);
      // The content appears after the completed countdown, proving the buyer view ran.
      await expect(page.getByText(contentLabel, { exact: true })).toBeVisible({ timeout: 15000 });
      expect(new URL(page.url()).origin).toBe(origin);
      expect(new URL(page.url()).pathname).toBe(`/pl/p/${slug}`);
      expect(dialogShown).toBe(false);
    });
  }

  test('follows a relative return path after the countdown', async ({ page }) => {
    const origin = new URL(page.url()).origin;
    await page.goto(`/pl/p/${slug}?payment=success&return_url=${encodeURIComponent('/pl/my-products')}`);
    await expect(page).toHaveURL(`${origin}/pl/my-products`, { timeout: 15000 });
    await expect(page.locator('body')).not.toContainText('Application error');
  });
});
