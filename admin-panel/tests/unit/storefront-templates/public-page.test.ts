/** Public page loading and shell branches. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { D_CONFIG, DEFAULT_CONFIG, PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import { loadPublicStorefront } from '@/lib/storefront-templates/public-page';
import { STOREFRONT_TEMPLATES } from '@/lib/storefront-templates/registry';
const mocks = vi.hoisted(() => ({ rate: vi.fn(), client: vi.fn(), config: vi.fn(), groups: vi.fn(), bindings: vi.fn(), page: vi.fn(), tier: vi.fn(), keys: vi.fn() }));
vi.mock('@/components/storefront/PublicStorefrontPage', () => ({ default: () => null }));
vi.mock('@/lib/storefront-templates/template-license-snapshot', () => ({ getLocalTemplateIds: mocks.keys }));
vi.mock('@/lib/license/public-snapshot', () => ({ getPublicLicenseTier: mocks.tier }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: mocks.rate }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.client }));
vi.mock('@/lib/storefront-templates/repository', () => ({ readPublishedConfig: mocks.config }));
vi.mock('@/lib/storefront-templates/catalogue', () => ({ loadCatalogueGroups: mocks.groups, loadStorefrontBindings: mocks.bindings, loadCataloguePage: mocks.page }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.keys.mockReturnValue([]); mocks.tier.mockReturnValue('pro'); mocks.rate.mockResolvedValue(true); mocks.client.mockReturnValue({});
  mocks.config.mockResolvedValue({ success: true, data: DEFAULT_CONFIG });
  mocks.groups.mockImplementation(async (_client, _query, variant) => ({ success: true, data: Object.fromEntries((variant === 'default-groups' ? ['featured', 'free', 'paid'] : ['all']).map(g => [g, { products: [], nextCursor: null }])) }));
  mocks.bindings.mockResolvedValue({ success: true, data: { hero: null, closing: null, starters: [], comparison: [], featured: [], categories: [] } });
  mocks.page.mockResolvedValue({ success: true, data: { products: [], nextCursor: null } });
});
describe('public storefront loader', () => {
  it('renders when the limiter is exhausted or unavailable without calling it', async () => {
    mocks.rate.mockResolvedValue(false);
    expect(await loadPublicStorefront('en', {})).toMatchObject({ success: true });
    expect(mocks.rate).not.toHaveBeenCalled();
    mocks.rate.mockRejectedValue(new Error('limiter offline'));
    expect(await loadPublicStorefront('en', {})).toMatchObject({ success: true });
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
  it.each(['en', 'pl'] as const)('%s: an incompatible template version safely renders the free catalogue without rewriting seller data', async locale => {
    const stored = structuredClone(D_CONFIG);
    const before = JSON.stringify(stored);
    mocks.config.mockResolvedValue({ success: true, data: stored });
    const previous = STOREFRONT_TEMPLATES.d.minSellf;
    try {
      STOREFRONT_TEMPLATES.d.minSellf = '2099.1.0';
      const result = await loadPublicStorefront(locale, {});
      expect(result).toMatchObject({ success: true, model: { locale, templateId: 'default', sections: [{ id: 'catalogue', type: 'catalogue/1', props: { variant: 'default-groups', pageSize: 12 } }] } });
      expect(mocks.groups).toHaveBeenCalledWith({}, expect.objectContaining({ locale, pageSize: 12 }), 'default-groups');
      expect(mocks.config).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(stored)).toBe(before);
    } finally { STOREFRONT_TEMPLATES.d.minSellf = previous; }
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

it('loads A comparison products in the shared batch and uses current local grants', async () => {
  const products = PUBLIC_FIXTURE.products.map(product => ({ ...product, marketing: { ...product.marketing, format: 'workshop' as const, sourceLocale: 'en' as const } }));
  const settings = { heroProduct: products[0].id, comparisonProducts: [products[1].id, products[0].id], starterProducts: products.slice(1).map(product => product.id) };
  const config = { ...D_CONFIG, templateId: 'storefront-a', settingsByTemplate: { ...D_CONFIG.settingsByTemplate, 'storefront-a': settings } };
  mocks.config.mockResolvedValue({ success: true, data: config });
  mocks.keys.mockReturnValue(['storefront-a']);
  mocks.bindings.mockResolvedValue({ success: true, data: { hero: products[0], closing: null, comparison: [products[1], products[0]], starters: products.slice(1), featured: [], categories: [] } });
  const result = await loadPublicStorefront('en', {});
  expect(result).toMatchObject({ success: true, model: { templateId: 'storefront-a' } });
  expect(mocks.bindings).toHaveBeenCalledExactlyOnceWith({}, expect.objectContaining(settings));
  if (result.success) {
    expect(result.model.sections.find(section => section.id === 'comparison')).toMatchObject({ props: { products: [products[1], products[0]] } });
    expect(result.model.sections[0]).toMatchObject({ props: { product: products[0] } });
  }
  mocks.keys.mockReturnValue(['storefront-b']);
  expect(await loadPublicStorefront('en', {})).toMatchObject({ success: true, model: { templateId: 'default' } });
  expect(config.settingsByTemplate['storefront-a']).toEqual(settings);
});

it('loads B featured products and search categories through the same bounded adapter', async () => {
  const products = PUBLIC_FIXTURE.products.map(product => ({ ...product, marketing: { ...product.marketing, format: 'workshop' as const, sourceLocale: 'en' as const } }));
  const settings = { featuredProducts: products.map(p => p.id), closingProduct: products[0].id, taskCategories: PUBLIC_FIXTURE.categories.map(c => c.id) };
  mocks.config.mockResolvedValue({ success: true, data: { ...DEFAULT_CONFIG, templateId: 'storefront-b', settingsByTemplate: { 'storefront-b': settings } } });
  mocks.keys.mockReturnValue(['storefront-b']);
  mocks.bindings.mockResolvedValue({ success: true, data: { hero: null, closing: products[0], starters: [], comparison: [], featured: products, categories: PUBLIC_FIXTURE.categories } });
  const result = await loadPublicStorefront('en', {});
  expect(mocks.bindings).toHaveBeenCalledExactlyOnceWith({}, expect.objectContaining(settings));
  expect(result).toMatchObject({ success: true, hasProducts: true, model: { templateId: 'storefront-b' } });
  if (result.success) {
    expect(result.model.sections.find(section => section.id === 'featured')).toMatchObject({ props: { products } });
    expect(result.model.sections[0]).toMatchObject({ props: { variant: 'search-hero', categories: PUBLIC_FIXTURE.categories } });
  }
});
