/** Private preview evidence contract. */
import { beforeEach, expect, it, vi } from 'vitest';
import { D_CONFIG, DEFAULT_CONFIG, D_LOCALIZED_CONFIG, PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import { verifyTemplateSession, verifyTemplateApiKey } from '@/lib/storefront-templates/mutations';
import { preparePreview } from '@/lib/storefront-templates/preview';
const m = vi.hoisted(() => ({ client: vi.fn(), read: vi.fn(), rate: vi.fn(), auth: vi.fn(), offer: vi.fn(), bindings: vi.fn() }));
// Presentation assertions do not run the Next/PostCSS pipeline; browser tests cover actual CSS.
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/api/middleware', () => ({ authenticateApiKeyPrincipal: m.auth }));
vi.mock('@/lib/storefront-templates/offer-repository', () => ({ readOfferConfig: m.offer }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: async () => ({ user: { id: 'dddddddd-0000-4000-a000-000000000000' } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: m.client }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: m.rate }));
vi.mock('@/lib/storefront-templates/catalogue', () => ({
  loadCatalogueGroups: async () => ({ success: true, data: { all: { products: [], nextCursor: null } } }),
  loadStorefrontBindings: m.bindings,
}));
vi.mock('@/lib/storefront-templates/repository', () => ({ readStorefrontConfig: m.read }));
beforeEach(() => {
  vi.resetAllMocks(); m.client.mockReturnValue({}); m.rate.mockResolvedValue(true);
  m.bindings.mockResolvedValue({ success: true, data: { hero: null, closing: null, starters: [], comparison: [], categories: PUBLIC_FIXTURE.categories } });
  m.read.mockResolvedValue({ success: true, data: { revision: 3, draft: D_CONFIG, published: DEFAULT_CONFIG } });
});
const input = { revision: 3, locale: 'en', fixture: 'standard' };
it('requires an issued READ principal before service reads', async () => {
  expect(await preparePreview({}, input)).toMatchObject({ code: 'FORBIDDEN' }); expect(m.client).not.toHaveBeenCalled();
});
it('renders authoring selection on free and expires exactly ten minutes after issuance', async () => {
  const now = Date.now();
  const response = await preparePreview(await verifyTemplateSession(), input, now);
  expect(response).toMatchObject({ success: true, data: { revision: 3, expiresAt: new Date(now + 600000).toISOString(), validation: { valid: true }, effectiveTokens: expect.any(Array) } });
  expect(response).toMatchObject({ data: { model: { templateId: 'd' } } });
  expect(m.read).toHaveBeenCalledTimes(2);
});
it.each([{ ...input, fixture: '../file' }, { ...input, locale: 'fr' }, { ...input, actor: {} }])('rejects undeclared input %j', async value => {
  expect(await preparePreview(await verifyTemplateSession(), value)).toMatchObject({ success: false, status: 422 }); expect(m.client).not.toHaveBeenCalled();
});
it('enforces revision bounds and stale revisions before presentation preparation', async () => {
  const auth = await verifyTemplateSession();
  expect(await preparePreview(auth, { ...input, revision: Number.MAX_SAFE_INTEGER + 1 })).toMatchObject({ code: 'LIMIT' });
  expect(await preparePreview(auth, { ...input, revision: 2 })).toMatchObject({ code: 'CONFLICT', currentRevision: 3 });
});
it.each([null, DEFAULT_CONFIG])('does not return evidence when draft disappears or changes during presentation preparation', async draft => {
  m.read.mockResolvedValueOnce({ success: true, data: { revision: 3, draft: D_CONFIG, published: DEFAULT_CONFIG } });
  m.read.mockResolvedValue({ success: true, data: { revision: 4, draft, published: DEFAULT_CONFIG } });
  expect(await preparePreview(await verifyTemplateSession(), input)).toMatchObject({ code: 'CONFLICT', currentRevision: 4 });
});
it('rejects missing drafts and expired or future leases before privileged reads', async () => {
  const auth = await verifyTemplateSession();
  m.read.mockResolvedValueOnce({ success: true, data: { revision: 3, draft: null } });
  expect(await preparePreview(auth, input, Date.now())).toMatchObject({ code: 'CONFLICT' });
  m.client.mockClear();
  expect(await preparePreview(auth, input, Date.now() - 600001)).toMatchObject({ code: 'CONFLICT' });
  expect(await preparePreview(auth, input, Date.now() + 60000)).toMatchObject({ code: 'CONFLICT' });
  expect(m.client).not.toHaveBeenCalled();
});

it('accepts an independently scoped API READ principal without a session UI', async () => {
  m.auth.mockResolvedValue({ method: 'api_key', admin: { userId: 'dddddddd-0000-4000-a000-000000000000' }, apiKey: { id: 'aaaaaaaa-1111-4111-a111-111111111111' }, scopes: ['templates:read'] });
  expect(await preparePreview(await verifyTemplateApiKey({} as never), input)).toMatchObject({ success: true });
  m.auth.mockResolvedValue({ method: 'api_key', admin: { userId: 'dddddddd-0000-4000-a000-000000000000' }, apiKey: { id: 'aaaaaaaa-1111-4111-a111-111111111111' }, scopes: ['products:write'] });
  m.client.mockClear();
  expect(await preparePreview(await verifyTemplateApiKey({} as never), input)).toMatchObject({ code: 'FORBIDDEN' });
  expect(m.client).not.toHaveBeenCalled();
});
it('reports absent fixtures and rate limits before privileged reads', async () => {
  const auth = await verifyTemplateSession();
  expect(await preparePreview(auth, { ...input, fixture: 'absent' })).toMatchObject({ code: 'NOT_FOUND' });
  m.rate.mockResolvedValue(false);
  expect(await preparePreview(auth, input)).toMatchObject({ code: 'RATE_LIMITED' });
  expect(m.client).not.toHaveBeenCalled();
});
it('returns structural validation and handles unavailable reads', async () => {
  const auth = await verifyTemplateSession();
  m.read.mockResolvedValueOnce({ success: true, data: { revision: 3, draft: { ...D_CONFIG, tokens: { format: 1, light: { accent: 'example' } } } } });
  expect(await preparePreview(auth, input)).toMatchObject({ code: 'INVALID', validation: { valid: false } });

  m.read.mockResolvedValue({ success: false });
  expect(await preparePreview(auth, input)).toMatchObject({ code: 'UNAVAILABLE' });
});

it('uses declared Polish fixture content in the Polish rendered presentation', async () => {
  m.read.mockResolvedValue({ success: true, data: { revision: 3, draft: D_LOCALIZED_CONFIG, published: DEFAULT_CONFIG } });
  expect(await preparePreview(await verifyTemplateSession(), { ...input, locale: 'pl' })).toMatchObject({ success: true });
  const response = await preparePreview(await verifyTemplateSession(), { ...input, locale: 'pl' });
  expect(response).toMatchObject({ data: { model: { sections: expect.arrayContaining([expect.objectContaining({ type: 'hero-product/1', props: expect.objectContaining({ content: expect.objectContaining({ heading: 'Zbuduj swój pierwszy automatyczny raport' }) }) })]) } } });
});

it('prepares product offers through the same inert preview boundary and rechecks revision', async () => {
  const productId = 'aaaaaaaa-1111-4111-a111-111111111111';
  const draft = { format: 1, enabled: true, templateId: 'offer-default', settings: { density: 'comfortable' }, content: { 'offer.hero': { sourceLocale: 'en', en: { kind: 'hero', eyebrow: 'Workshop', heading: 'Offer preview heading', body: 'Seller copy', steps: [] } } }, tokens: null };
  m.offer.mockResolvedValue({ success: true, data: { revision: 3, draft } });
  m.bindings.mockResolvedValue({ success: true, data: { hero: null } });
  const auth = await verifyTemplateSession();
  const response = await preparePreview(auth, { ...input, fixture: 'published-products' }, Date.now(), productId);
  expect(response).toMatchObject({ success: true, data: { model: { sections: [expect.objectContaining({ type: 'hero-product/1', props: expect.objectContaining({ variant: 'simple', content: expect.objectContaining({ heading: 'Offer preview heading' }) }) }), expect.objectContaining({ type: 'product-cta/1', props: expect.objectContaining({ action: 'buy' }) })] } } });
  expect(response).toMatchObject({ data: { validation: { warnings: [{ code: 'TRANSLATION_FALLBACK', path: '/content/offer.hero', message: 'Missing translation uses source locale' }] } } });
  for (const fixture of ['standard', 'empty', 'long', 'unavailable']) expect(await preparePreview(auth, { ...input, fixture }, Date.now(), productId)).toMatchObject({ code: 'NOT_FOUND' });
  expect(m.read).not.toHaveBeenCalled();
  expect(m.bindings).toHaveBeenCalledWith({}, expect.objectContaining({ heroProduct: productId, closingProduct: productId }));
  m.offer.mockResolvedValueOnce({ success: true, data: { revision: 3, draft } }).mockResolvedValue({ success: true, data: { revision: 4, draft } });
  expect(await preparePreview(auth, { ...input, fixture: 'published-products' }, Date.now(), productId)).toMatchObject({ code: 'CONFLICT', currentRevision: 4 });
  expect(await preparePreview({}, { ...input, fixture: 'published-products' }, Date.now(), productId)).toMatchObject({ code: 'FORBIDDEN' });
});

it('allows a full evidence matrix plus repeated viewport navigations within one minute', async () => {
  const counts = new Map<string, number>();
  m.rate.mockImplementation(async (action: string, limit: number) => {
    const count = (counts.get(action) ?? 0) + 1; counts.set(action, count);
    return count <= limit;
  });
  const auth = await verifyTemplateSession();
  for (const fixture of ['standard', 'empty', 'long', 'unavailable', 'published-products']) {
    for (const locale of ['en', 'pl']) for (let navigation = 0; navigation < 5; navigation++) {
      expect(await preparePreview(auth, { revision: 3, locale, fixture })).toMatchObject({ success: true });
    }
  }
  expect(m.rate).toHaveBeenCalledWith('storefront_preview', 120, 1, expect.any(String));
});
it('names preview failures by operation', async () => {
  m.rate.mockResolvedValue(false);
  expect(await preparePreview(await verifyTemplateSession(), input)).toMatchObject({ message: 'Storefront preview could not be completed' });
});
