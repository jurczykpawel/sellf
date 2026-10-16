/** Private preview evidence contract. */
import { beforeEach, expect, it, vi } from 'vitest';
import { D_CONFIG, DEFAULT_CONFIG, D_LOCALIZED_CONFIG } from '@/lib/storefront-templates/fixtures';
import { verifyTemplateSession, verifyTemplateApiKey } from '@/lib/storefront-templates/mutations';
import { previewStorefront } from '@/lib/storefront-templates/preview';
const m = vi.hoisted(() => ({ client: vi.fn(), read: vi.fn(), rate: vi.fn(), auth: vi.fn(), render: vi.fn() }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/api/middleware', () => ({ authenticateApiKeyPrincipal: m.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: async () => ({ user: { id: 'dddddddd-0000-4000-a000-000000000000' } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: m.client }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: m.rate }));
vi.mock('@/lib/storefront-templates/repository', () => ({ readStorefrontConfig: m.read }));
vi.mock('@/lib/storefront-templates/preview-render', () => ({ renderPreviewSnapshot: m.render }));
beforeEach(() => {
  vi.resetAllMocks(); m.client.mockReturnValue({}); m.rate.mockResolvedValue(true);
  m.read.mockResolvedValue({ success: true, data: { revision: 3, draft: D_CONFIG, published: DEFAULT_CONFIG } });
  m.render.mockResolvedValue({ html: '<html lang="en"></html>', css: '', assets: [] });
});
const input = { revision: 3, locale: 'en', fixture: 'standard' };
it('requires an issued READ principal before service reads', async () => {
  expect(await previewStorefront({}, input)).toMatchObject({ code: 'FORBIDDEN' }); expect(m.client).not.toHaveBeenCalled();
});
it('renders authoring selection on free and expires exactly ten minutes after render starts', async () => {
  const now = Date.now();
  const response = await previewStorefront(await verifyTemplateSession(), input, now);
  expect(response).toMatchObject({ success: true, data: { revision: 3, expiresAt: new Date(now + 600000).toISOString(), validation: { valid: true }, effectiveTokens: expect.any(Array) } });
  expect(m.render).toHaveBeenCalledWith(expect.objectContaining({ model: expect.objectContaining({ templateId: 'd' }) }));
  expect(m.read).toHaveBeenCalledTimes(2);
});
it.each([{ ...input, fixture: '../file' }, { ...input, locale: 'fr' }, { ...input, actor: {} }])('rejects undeclared input %j', async value => {
  expect(await previewStorefront(await verifyTemplateSession(), value)).toMatchObject({ success: false, status: 422 }); expect(m.client).not.toHaveBeenCalled();
});
it('enforces revision bounds and stale revisions before render', async () => {
  const auth = await verifyTemplateSession();
  expect(await previewStorefront(auth, { ...input, revision: Number.MAX_SAFE_INTEGER + 1 })).toMatchObject({ code: 'LIMIT' });
  expect(await previewStorefront(auth, { ...input, revision: 2 })).toMatchObject({ code: 'CONFLICT', currentRevision: 3 }); expect(m.render).not.toHaveBeenCalled();
});
it.each([null, DEFAULT_CONFIG])('does not return evidence when draft disappears or changes during render', async draft => {
  m.read.mockResolvedValueOnce({ success: true, data: { revision: 3, draft: D_CONFIG, published: DEFAULT_CONFIG } });
  m.read.mockResolvedValue({ success: true, data: { revision: 4, draft, published: DEFAULT_CONFIG } });
  expect(await previewStorefront(await verifyTemplateSession(), input)).toMatchObject({ code: 'CONFLICT', currentRevision: 4 });
});
it('rejects missing drafts, expired render and oversized evidence', async () => {
  const auth = await verifyTemplateSession();
  m.read.mockResolvedValueOnce({ success: true, data: { revision: 3, draft: null } });
  expect(await previewStorefront(auth, input)).toMatchObject({ code: 'CONFLICT' });
  expect(await previewStorefront(auth, input, Date.now() - 600001)).toMatchObject({ code: 'CONFLICT' });
  m.render.mockResolvedValue({ html: 'a'.repeat(4 * 1024 * 1024), css: '', assets: [] });
  expect(await previewStorefront(auth, input)).toMatchObject({ code: 'LIMIT' });
});

it('accepts an independently scoped API READ principal without a session UI', async () => {
  m.auth.mockResolvedValue({ method: 'api_key', admin: { userId: 'dddddddd-0000-4000-a000-000000000000' }, apiKey: { id: 'aaaaaaaa-1111-4111-a111-111111111111' }, scopes: ['templates:read'] });
  expect(await previewStorefront(await verifyTemplateApiKey({} as never), input)).toMatchObject({ success: true });
  m.auth.mockResolvedValue({ method: 'api_key', admin: { userId: 'dddddddd-0000-4000-a000-000000000000' }, apiKey: { id: 'aaaaaaaa-1111-4111-a111-111111111111' }, scopes: ['products:write'] });
  m.client.mockClear();
  expect(await previewStorefront(await verifyTemplateApiKey({} as never), input)).toMatchObject({ code: 'FORBIDDEN' });
  expect(m.client).not.toHaveBeenCalled();
});
it('reports absent fixtures and rate limits before privileged reads', async () => {
  const auth = await verifyTemplateSession();
  expect(await previewStorefront(auth, { ...input, fixture: 'absent' })).toMatchObject({ code: 'NOT_FOUND' });
  m.rate.mockResolvedValue(false);
  expect(await previewStorefront(auth, input)).toMatchObject({ code: 'RATE_LIMITED' });
  expect(m.client).not.toHaveBeenCalled();
});
it('returns structural validation without HTML and handles unavailable reads', async () => {
  const auth = await verifyTemplateSession();
  m.read.mockResolvedValueOnce({ success: true, data: { revision: 3, draft: { ...D_CONFIG, tokens: { format: 1, light: { accent: 'example' } } } } });
  expect(await previewStorefront(auth, input)).toMatchObject({ code: 'INVALID', validation: { valid: false } });
  expect(m.render).not.toHaveBeenCalled();
  m.read.mockResolvedValue({ success: false });
  expect(await previewStorefront(auth, input)).toMatchObject({ code: 'UNAVAILABLE' });
});

it('uses declared Polish fixture content in the Polish rendered presentation', async () => {
  m.read.mockResolvedValue({ success: true, data: { revision: 3, draft: D_LOCALIZED_CONFIG, published: DEFAULT_CONFIG } });
  expect(await previewStorefront(await verifyTemplateSession(), { ...input, locale: 'pl' })).toMatchObject({ success: true });
  expect(m.render).toHaveBeenCalledWith(expect.objectContaining({ model: expect.objectContaining({ sections: expect.arrayContaining([expect.objectContaining({ type: 'hero-product/1', props: expect.objectContaining({ content: expect.objectContaining({ heading: 'Zbuduj swój pierwszy automatyczny raport' }) }) })]) }) }));
});
