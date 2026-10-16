/** Public page loading and shell branches. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { D_CONFIG, DEFAULT_CONFIG } from '@/lib/storefront-templates/fixtures';
import { loadPublicStorefront } from '@/lib/storefront-templates/public-page';
const mocks = vi.hoisted(() => ({ rate: vi.fn(), client: vi.fn(), config: vi.fn(), groups: vi.fn(), bindings: vi.fn(), page: vi.fn(), tier: vi.fn() }));
vi.mock('@/components/storefront/PublicStorefrontPage', () => ({ default: () => null }));
vi.mock('@/lib/license/public-snapshot', () => ({ getPublicLicenseTier: mocks.tier }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: mocks.rate }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.client }));
vi.mock('@/lib/storefront-templates/repository', () => ({ readPublishedConfig: mocks.config }));
vi.mock('@/lib/storefront-templates/catalogue', () => ({ loadCatalogueGroups: mocks.groups, loadStorefrontBindings: mocks.bindings, loadCataloguePage: mocks.page }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.tier.mockReturnValue('pro'); mocks.rate.mockResolvedValue(true); mocks.client.mockReturnValue({});
  mocks.config.mockResolvedValue({ success: true, data: DEFAULT_CONFIG });
  mocks.groups.mockImplementation(async (_client, _query, variant) => ({ success: true, data: Object.fromEntries((variant === 'default-groups' ? ['featured', 'free', 'paid'] : ['all']).map(g => [g, { products: [], nextCursor: null }])) }));
  mocks.bindings.mockResolvedValue({ success: true, data: { hero: null, closing: null, starters: [], categories: [] } });
  mocks.page.mockResolvedValue({ success: true, data: { products: [], nextCursor: null } });
});
describe('public storefront loader', () => {
  it('applies the limiter before public data client initialization', async () => {
    mocks.rate.mockResolvedValue(false);
    expect(await loadPublicStorefront('en', {})).toEqual({ success: false });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('reads published once and distinguishes an empty shop', async () => {
    const result = await loadPublicStorefront('pl', {});
    expect(result).toMatchObject({ success: true, hasProducts: false, model: { locale: 'pl', templateId: 'default' } });
    expect(mocks.config).toHaveBeenCalledTimes(1);
    expect(mocks.groups).toHaveBeenCalledWith({}, expect.objectContaining({ locale: 'pl', pageSize: 12 }), 'default-groups');
  });
  it('uses full D with current paid rights', async () => {
    mocks.config.mockResolvedValue({ success: true, data: D_CONFIG });
    expect(await loadPublicStorefront('en', {})).toMatchObject({ success: true, model: { templateId: 'd' } });
    expect(mocks.bindings).toHaveBeenCalledWith({}, expect.objectContaining({ heroProduct: D_CONFIG.settingsByTemplate.d!.heroProduct, starterProducts: D_CONFIG.settingsByTemplate.d!.starterProducts }));
  });
  it('resolves published appearance separately without a second config read', async () => {
    mocks.config.mockResolvedValue({ success: true, data: { ...D_CONFIG, tokens: { format: 1, typography: { font: 'dm-sans' } } } });
    const result = await loadPublicStorefront('pl', {});
    expect(result).toMatchObject({ success: true, theme: { tokens: { typography: { font: 'dm-sans' } } } });
    expect(mocks.config).toHaveBeenCalledTimes(1);
    if (result.success) expect(JSON.stringify(result.model)).not.toContain('tokens');
    mocks.tier.mockReturnValue('free');
    expect(await loadPublicStorefront('pl', {})).toMatchObject({ success: true, theme: { diagnostics: ['ENTITLEMENT'], tokens: { typography: { font: 'geist' } } } });
  });
  it('handles progressive search/category without confusing no matches with no products', async () => {
    mocks.page.mockResolvedValue({ success: true, data: { products: [{ id: 'present' }], nextCursor: null } });
    expect(await loadPublicStorefront('en', { search: 'needle', category: '55555555-5555-4555-8555-555555555555' })).toMatchObject({ success: true, hasProducts: true });
    expect(mocks.groups).toHaveBeenCalledWith({}, expect.objectContaining({ search: 'needle', categoryIds: ['55555555-5555-4555-8555-555555555555'] }), 'default-groups');
  });
  it('keeps neutral alternate-route queries on the same public model', async () => {
    const canonical = await loadPublicStorefront('pl', {});
    const neutral = await loadPublicStorefront('pl', { experiment: 'neutral', arm: 'same-config' });
    expect(neutral).toEqual(canonical);
  });
  it('does not turn failed reads into coming-soon or serialize invalid filters', async () => {
    mocks.groups.mockResolvedValue({ success: false, error: 'UNAVAILABLE' });
    expect(await loadPublicStorefront('en', {})).toEqual({ success: false });
    expect(await loadPublicStorefront('en', { search: ['a', 'b'] })).toEqual({ success: false });
  });
});

// Route branches use the same page seam without connecting to the instance.
describe('storefront route identity', () => {
  it('keeps canonical locale/surface independent of selection queries', async () => {
    const { storefrontMetadata } = await import('@/lib/storefront-templates/public-page');
    for (const locale of ['en', 'pl'] as const) {
      expect(storefrontMetadata(locale, 'home').alternates?.canonical).toMatch(new RegExp(locale === 'en' ? '/$' : '/pl$'));
      expect(storefrontMetadata(locale, 'store').alternates?.canonical).toMatch(new RegExp(locale === 'en' ? '/store$' : '/pl/store$'));
    }
  });
  it('redirects only the demo homepage and keeps /store available', async () => {
    const redirect = vi.fn(() => { throw new Error('demo redirect'); });
    vi.doMock('next/navigation', () => ({ redirect }));
    const { default: Home } = await import('@/app/[locale]/page');
    const { default: Store } = await import('@/app/[locale]/store/page');
    const args = { params: Promise.resolve({ locale: 'pl' as const }), searchParams: Promise.resolve({ search: 'example' }) };
    const original = process.env.DEMO_MODE;
    try {
      process.env.DEMO_MODE = 'true';
      await expect(Home(args)).rejects.toThrow('demo redirect');
      expect(redirect).toHaveBeenCalledExactlyOnceWith('/about');
      expect(await Store(args)).toMatchObject({ props: { locale: 'pl', searchParams: { search: 'example' } } });
      process.env.DEMO_MODE = 'false';
      expect(await Home(args)).toMatchObject({ props: { locale: 'pl' } });
    } finally {
      if (original === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = original;
    }
  });
});

it('rechecks current rights for the same warm published D without changing stored content', async () => {
  mocks.config.mockResolvedValue({ success: true, data: D_CONFIG });
  const saved = JSON.stringify(D_CONFIG);
  expect(await loadPublicStorefront('en', {})).toMatchObject({ success: true, model: { templateId: 'd' } });
  mocks.tier.mockReturnValue('free');
  expect(await loadPublicStorefront('en', {})).toMatchObject({ success: true, model: { templateId: 'default' } });
  expect(JSON.stringify(D_CONFIG)).toBe(saved);
});
