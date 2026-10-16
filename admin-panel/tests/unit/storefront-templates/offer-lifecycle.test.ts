/** Product-scoped lifecycle acceptance. */
import { beforeEach, expect, it, vi } from 'vitest';
import { offerLifecycle } from '@/lib/storefront-templates/offer-lifecycle';
import { verifyTemplateSession, verifyTemplateApiKey } from '@/lib/storefront-templates/mutations';
import { CORE_TOKENS } from '@/lib/storefront-templates/public-theme';
const m = vi.hoisted(() => ({ read: vi.fn(), history: vi.fn(), rpc: vi.fn(), client: vi.fn(), tier: vi.fn(), auth: vi.fn(), tag: vi.fn(), product: vi.fn(), rate: vi.fn() }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('next/cache', () => ({ revalidateTag: m.tag, revalidatePath: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: m.rate }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: async () => ({ user: { id: 'dddddddd-0000-4000-a000-000000000000' } }) }));
vi.mock('@/lib/api/middleware', () => ({ authenticateApiKeyPrincipal: m.auth }));
vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: m.client, createAdminClient: m.client }));
vi.mock('@/lib/license/public-snapshot', () => ({ getPublicLicenseTier: m.tier }));
vi.mock('@/lib/storefront-templates/offer-repository', () => ({ readOfferConfig: m.read, readOfferHistory: m.history }));
const productId = 'aaaaaaaa-1111-4111-a111-111111111111';
const config = { format: 1, enabled: true, templateId: 'offer-default', settings: { density: 'comfortable' }, content: {}, tokens: null };
const input = (operation: string, extra = {}) => ({ productId, operation, ...extra });
beforeEach(() => {
  vi.clearAllMocks(); m.rate.mockResolvedValue(true); m.tier.mockReturnValue('free');
  m.client.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: m.product }) }) }), rpc: m.rpc });
  m.product.mockResolvedValue({ data: { id: productId, name: 'Workshop', slug: 'workshop', is_active: true, is_listed: true }, error: null });
  m.read.mockResolvedValue({ success: true, data: { product_id: productId, revision: 3, draft: config, published: null } });
  m.history.mockResolvedValue({ success: true, data: [{ product_id: productId, revision: 1, published: config, draft: null }] });
  m.rpc.mockImplementation(async (name: string) => name === 'storefront_config_stored_bytes' ? { data: 100 } : { data: { success: true, revision: 4 } });
});
it('requires issued principals and independent operation scopes before reads', async () => {
  expect(await offerLifecycle({}, input('read'))).toMatchObject({ code: 'FORBIDDEN' });
  m.auth.mockResolvedValue({ method: 'api_key', admin: { userId: 'dddddddd-0000-4000-a000-000000000000' }, apiKey: { id: productId }, scopes: ['products:write'] });
  const auth = await verifyTemplateApiKey({} as never);
  for (const operation of ['read', 'draft', 'publish', 'rollback']) expect(await offerLifecycle(auth, input(operation, { expectedRevision: 3, config }))).toMatchObject({ code: 'FORBIDDEN' });
  expect(m.client).not.toHaveBeenCalled();
});
it('reads an absent offer without persisting opt-in', async () => {
  m.read.mockResolvedValue({ success: true, data: null });
  expect(await offerLifecycle(await verifyTemplateSession(), input('read'))).toMatchObject({ success: true, data: { revision: 0, draft: null, published: null, productName: 'Workshop' } });
  expect(m.rpc).not.toHaveBeenCalled();
});
it('saves a free draft and leaves initialization to the atomic RPC', async () => {
  m.read.mockResolvedValue({ success: true, data: null });
  expect(await offerLifecycle(await verifyTemplateSession(), input('draft', { expectedRevision: 0, config }))).toMatchObject({ success: true, revision: 4 });
  expect(m.rpc).toHaveBeenCalledWith('mutate_product_offer', expect.objectContaining({ offer_product_id: productId, operation: 'draft', expected_revision: 0, validated_config: config }));
});
it('publishes only the current stored draft', async () => {
  const auth = await verifyTemplateSession();
  expect(await offerLifecycle(auth, input('publish', { expectedRevision: 3, config }))).toMatchObject({ code: 'INVALID' });
  expect(await offerLifecycle(auth, input('publish', { expectedRevision: 2 }))).toMatchObject({ code: 'CONFLICT', currentRevision: 3 });
  expect(m.rpc).not.toHaveBeenCalled();
  expect(await offerLifecycle(auth, input('publish', { expectedRevision: 3 }))).toMatchObject({ success: true });
  expect(m.rpc).toHaveBeenCalledWith('mutate_product_offer', expect.objectContaining({ validated_config: null }));
  expect(m.tag).toHaveBeenCalledWith(`product:${productId}`, { expire: 0 });
});
it('rechecks current token rights on publication and rollback', async () => {
  const tokens = structuredClone(CORE_TOKENS);
  m.read.mockResolvedValue({ success: true, data: { revision: 3, draft: { ...config, tokens }, published: null } });
  m.history.mockResolvedValue({ success: true, data: [{ revision: 1, published: { ...config, tokens } }] });
  const auth = await verifyTemplateSession();
  for (const operation of ['publish', 'rollback']) expect(await offerLifecycle(auth, input(operation, { expectedRevision: 3, ...(operation === 'rollback' ? { targetRevision: 1 } : {}) }))).toMatchObject({ code: 'FORBIDDEN' });
  expect(m.rpc).not.toHaveBeenCalled();
  m.tier.mockReturnValue('pro');
  expect(await offerLifecycle(auth, input('rollback', { expectedRevision: 3, targetRevision: 1 }))).toMatchObject({ success: true });
});
it('rejects a missing product and failed reads without mutation', async () => {
  m.product.mockResolvedValue({ data: null, error: null });
  expect(await offerLifecycle(await verifyTemplateSession(), input('read'))).toMatchObject({ code: 'NOT_FOUND' });
  expect(m.rpc).not.toHaveBeenCalled();
});
it('requires a public active product to activate an enabled page', async () => {
  m.product.mockResolvedValue({ data: { id: productId, is_active: false, is_listed: false }, error: null });
  expect(await offerLifecycle(await verifyTemplateSession(), input('publish', { expectedRevision: 3 }))).toMatchObject({ code: 'INVALID' });
  expect(m.rpc).not.toHaveBeenCalled();
});
it('keeps committed publication successful when invalidation fails', async () => {
  m.tag.mockImplementation(() => { throw Error('cache unavailable'); });
  expect(await offerLifecycle(await verifyTemplateSession(), input('publish', { expectedRevision: 3 }))).toMatchObject({ success: true, revision: 4, validation: { warnings: [expect.objectContaining({ code: 'COMPATIBILITY' })] } });
});
it('scopes history reads and reset preserves copy', async () => {
  const auth = await verifyTemplateSession();
  expect(await offerLifecycle(auth, input('history', { limit: 20 }))).toMatchObject({ success: true });
  expect(m.history).toHaveBeenCalledWith(expect.anything(), productId, { limit: 20, beforeRevision: undefined });
  expect(await offerLifecycle(auth, input('reset', { expectedRevision: 3, field: 'appearance' }))).toMatchObject({ success: true });
  expect(m.rpc).toHaveBeenCalledWith('mutate_product_offer', expect.objectContaining({ validated_config: config }));
});

it.each([
  ['templates:read', 'read', true], ['templates:read', 'draft', false],
  ['templates:write', 'draft', true], ['templates:write', 'publish', false],
  ['templates:activate', 'publish', true], ['templates:activate', 'draft', false],
])('honors %s for %s independently', async (scope, operation, allowed) => {
  m.auth.mockResolvedValue({ method: 'api_key', admin: { userId: 'dddddddd-0000-4000-a000-000000000000' }, apiKey: { id: productId }, scopes: [scope] });
  m.tag.mockReset();
  const response = await offerLifecycle(await verifyTemplateApiKey({} as never), input(operation as string, operation === 'read' ? {} : { expectedRevision: 3, ...(operation === 'draft' ? { config } : {}) }));
  expect(response.success).toBe(allowed);
  if (!allowed) { expect(response).toMatchObject({ code: 'FORBIDDEN' }); expect(m.client).not.toHaveBeenCalled(); }
});
it('rejects unsupported offer selections and inadequate contrast at activation', async () => {
  const auth = await verifyTemplateSession();
  expect(await offerLifecycle(auth, input('draft', { expectedRevision: 3, config: { ...config, templateId: 'not-installed' } }))).toMatchObject({ code: 'INVALID' });
  m.tier.mockReturnValue('pro');
  const tokens = structuredClone(CORE_TOKENS); tokens.light.foreground = tokens.light.background;
  m.read.mockResolvedValue({ success: true, data: { revision: 3, draft: { ...config, tokens }, published: null } });
  expect(await offerLifecycle(auth, input('publish', { expectedRevision: 3 }))).toMatchObject({ code: 'INVALID', validation: { errors: expect.arrayContaining([expect.objectContaining({ code: 'CONTRAST' })]) } });
  expect(m.rpc).not.toHaveBeenCalled();
});
it('can restore the unpublished baseline and disable an inactive product offer', async () => {
  const auth = await verifyTemplateSession(); m.tag.mockReset();
  m.history.mockResolvedValue({ success: true, data: [{ revision: 0, published: null, draft: null }] });
  expect(await offerLifecycle(auth, input('rollback', { expectedRevision: 3, targetRevision: 0 }))).toMatchObject({ success: true });
  m.product.mockResolvedValue({ data: { id: productId, is_active: false, is_listed: false }, error: null });
  m.read.mockResolvedValue({ success: true, data: { revision: 3, draft: { ...config, enabled: false }, published: null } });
  expect(await offerLifecycle(auth, input('publish', { expectedRevision: 3 }))).toMatchObject({ success: true });
});
it('returns authoring diagnostics and preserves structured draft limits', async () => {
  const auth = await verifyTemplateSession();
  expect(await offerLifecycle(auth, input('validate', { mode: 'draft', config: { ...config, price: 9 } }))).toMatchObject({ success: true, data: { valid: false, errors: [expect.objectContaining({ code: 'SCHEMA' })] } });
  expect(await offerLifecycle(auth, input('draft', { expectedRevision: 3, config: { ...config, content: { 'offer.hero': { sourceLocale: 'en', en: { kind: 'hero', eyebrow: '', heading: 'a'.repeat(161), body: '', steps: [] } } } } }))).toMatchObject({ code: 'LIMIT', validation: { errors: expect.arrayContaining([expect.objectContaining({ code: 'LIMIT' })]) } });
});
