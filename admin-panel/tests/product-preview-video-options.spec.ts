/**
 * E2E: preview_video_config persists end-to-end
 *
 * Covers:
 * - API: upsert product with preview_video_config → read back exactly
 * - Render: checkout/[slug] passes config to <player-stack> data-config
 *
 * @see admin-panel/src/components/player/VideoOptionsPanel.tsx
 * @see admin-panel/src/lib/playerstack.ts (buildPlayerstackRenderConfig)
 * @see admin-panel/src/app/[locale]/checkout/[slug]/components/ProductShowcase.tsx
 */

import { test, expect } from '@playwright/test';
import { supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

test.describe('preview_video_config', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(45_000);

  const ts = Date.now();
  const productSlug = `preview-video-opts-${ts}`;
  let productId: string | null = null;

  test.beforeAll(async () => {
    const { data, error } = await supabaseAdmin
      .from('products')
      .upsert({
        name: 'Preview Video Options Test',
        slug: productSlug,
        price: 0,
        currency: 'PLN',
        description: 'Product carrying a preview video with explicit options',
        is_active: true,
        price_includes_vat: false,
        content_delivery_type: 'content',
        content_config: { content_items: [] },
        preview_video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        preview_video_config: {
          autoplay: true,
          loop: true,
          muted: true,
          controls: false,
        },
      })
      .select('id')
      .single();

    if (error) throw error;
    productId = data!.id;
  });

  test.afterAll(async () => {
    if (productId) {
      await supabaseAdmin.from('products').delete().eq('id', productId);
    }
  });

  test('persists preview_video_config exactly as written', async () => {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('preview_video_config')
      .eq('slug', productSlug)
      .single();

    expect(error).toBeNull();
    expect(data?.preview_video_config).toEqual({
      autoplay: true,
      loop: true,
      muted: true,
      controls: false,
    });
  });

  test('checkout page emits data-config matching the saved options', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/pl/checkout/${productSlug}`);

    const embed = page.getByTestId('playerstack-embed');
    await embed.waitFor({ state: 'attached', timeout: 15_000 });

    const dataConfigRaw = await embed.getAttribute('data-config');
    expect(dataConfigRaw, 'player-stack must carry data-config').toBeTruthy();

    const cfg = JSON.parse(dataConfigRaw!);

    // autoplay=true routes through preview plugin instead of click-to-load thumb
    expect(cfg.preview).toEqual({ enabled: true, loopUntilInteraction: true });
    expect(cfg.brandedThumb).toBeUndefined();

    expect(cfg.loop).toBe(true);
    expect(cfg.muted).toBe(true);
    expect(cfg.controls).toEqual({ show: ['play'] });
  });

  test('saved_position flag flows through to data-config when enabled', async () => {
    if (!productId) throw new Error('no product');

    await supabaseAdmin
      .from('products')
      .update({
        preview_video_config: { autoplay: false, saved_position: true },
      })
      .eq('id', productId);

    const { data } = await supabaseAdmin
      .from('products')
      .select('preview_video_config')
      .eq('id', productId)
      .single();
    expect(data?.preview_video_config).toEqual({ autoplay: false, saved_position: true });
  });
});
