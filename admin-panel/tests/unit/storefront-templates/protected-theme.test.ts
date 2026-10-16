/** Published-only appearance on core route layouts. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, D_CONFIG } from '@/lib/storefront-templates/fixtures';
import { CORE_TOKENS } from '@/lib/storefront-templates/public-theme';
import { loadProtectedThemeData } from '@/lib/theme-loader';
const mocks = vi.hoisted(() => ({ published: vi.fn(), tier: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/actions/theme', () => ({ getActiveTheme: async () => null }));
vi.mock('@/lib/license/public-snapshot', () => ({ getPublicLicenseTier: mocks.tier, checkPublicFeature: () => ['pro', 'business'].includes(mocks.tier()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.client }));
vi.mock('@/lib/storefront-templates/repository', () => ({ readPublishedConfig: mocks.published }));
vi.mock('@/lib/actions/shop-config', () => ({ getShopConfig: async () => ({ checkout_theme: 'dark' }) }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/PublicThemeShell.module.css', () => ({ default: {} }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.client.mockReturnValue({}); mocks.tier.mockReturnValue('pro');
  mocks.published.mockResolvedValue({ success: true, data: DEFAULT_CONFIG });
});
it('loads published appearance once and clamps shapes and sizes while retaining the approved font', async () => {
  const config = { ...DEFAULT_CONFIG, tokens: { format: 1, typography: { font: 'dm-sans', baseSizePx: 18 }, shapes: { radiusSmPx: 8 } } };
  const saved = JSON.stringify(config); mocks.published.mockResolvedValue({ success: true, data: config });
  const result = await loadProtectedThemeData();
  expect(result.tokens.typography).toEqual({ ...CORE_TOKENS.typography, font: 'dm-sans' });
  expect(result.tokens.shapes).toEqual(CORE_TOKENS.shapes);
  expect(mocks.published).toHaveBeenCalledExactlyOnceWith({});
  expect(JSON.stringify(config)).toBe(saved);
});
it('applies current D defaults and falls back after downgrade', async () => {
  mocks.published.mockResolvedValue({ success: true, data: D_CONFIG });
  expect((await loadProtectedThemeData()).tokens.light.accent).toBe('#075C43');
  mocks.tier.mockReturnValue('free');
  expect((await loadProtectedThemeData()).tokens).toEqual(CORE_TOKENS);
});
it('ignores unlicensed overrides and retains core output when storage or license lookup is unavailable', async () => {
  mocks.tier.mockReturnValue('free');
  mocks.published.mockResolvedValue({ success: true, data: { ...DEFAULT_CONFIG, tokens: { format: 1, typography: { font: 'dm-sans' } } } });
  expect(await loadProtectedThemeData()).toMatchObject({ diagnostics: ['ENTITLEMENT'], tokens: CORE_TOKENS });
  mocks.published.mockRejectedValue(new Error('Unavailable'));
  expect((await loadProtectedThemeData()).tokens).toEqual(CORE_TOKENS);
});
it('server-renders the same restricted shell on each declared protected layout', async () => {
  const layouts = await Promise.all([
    import('@/app/[locale]/p/[slug]/layout'), import('@/app/[locale]/checkout/[slug]/layout'),
    import('@/app/[locale]/login/layout'), import('@/app/[locale]/terms/layout'), import('@/app/[locale]/privacy/layout'),
  ]);
  for (const { default: Layout } of layouts) {
    const element = await Layout({ children: createElement('p', null, 'Core content') });
    const resolved = element.type === (await import('@/components/storefront/ProtectedThemeLayout')).default
      ? await element.type(element.props) : element;
    const html = renderToStaticMarkup(resolved);
    expect(html).toContain('data-sf-surface="protected"'); expect(html).toContain('data-sf-mode="dark"'); expect(html).toContain('Core content');
  }
});
