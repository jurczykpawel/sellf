/** Lifecycle read and validation contract. @see src/lib/storefront-templates/lifecycle.ts */
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, D_CONFIG, PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import { verifyTemplateSession, verifyTemplateApiKey } from '@/lib/storefront-templates/mutations';
import { storefrontTemplateAction } from '@/lib/actions/storefront-templates';
import { storefrontLifecycle } from '@/lib/storefront-templates/lifecycle';
const m = vi.hoisted(() => ({ client: vi.fn(), read: vi.fn(), history: vi.fn(), tier: vi.fn(), bindings: vi.fn(), auth: vi.fn() }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: async () => ({ user: { id: 'dddddddd-0000-4000-a000-000000000000' } }) }));
vi.mock('@/lib/api/middleware', () => ({ authenticateApiKeyPrincipal: m.auth }));
vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: m.client, createAdminClient: m.client }));
vi.mock('@/lib/license/public-snapshot', () => ({ getPublicLicenseTier: m.tier }));
vi.mock('@/lib/storefront-templates/catalogue', () => ({ loadStorefrontBindings: m.bindings }));
vi.mock('@/lib/storefront-templates/repository', () => ({ readStorefrontConfig: m.read, readStorefrontHistory: m.history }));
beforeEach(() => {
  vi.resetAllMocks(); m.client.mockReturnValue({}); m.tier.mockReturnValue('free');
  m.read.mockResolvedValue({ success: true, data: { revision: 3, draft: D_CONFIG, published: DEFAULT_CONFIG } });
  m.bindings.mockResolvedValue({ success: true, data: { hero: PUBLIC_FIXTURE.products[0], closing: PUBLIC_FIXTURE.products[0], starters: PUBLIC_FIXTURE.products.slice(1), categories: PUBLIC_FIXTURE.categories } });
  m.history.mockImplementation(async (_: unknown, page: { beforeRevision?: number }) => ({ success: true, data: [{ revision: (page.beforeRevision ?? 4) - 1, draft: page.beforeRevision === 2 ? null : D_CONFIG, published: DEFAULT_CONFIG }] }));
});
it('requires a verified READ principal before private reads', async () => {
  expect(await storefrontLifecycle({}, { operation: 'read' })).toMatchObject({ code: 'FORBIDDEN' });
  m.auth.mockResolvedValue({ method: 'api_key', admin: { userId: 'dddddddd-0000-4000-a000-000000000000' }, apiKey: { id: 'aaaaaaaa-1111-4111-a111-111111111111' }, scopes: ['templates:write'] });
  expect(await storefrontLifecycle(await verifyTemplateApiKey({} as never), { operation: 'read' })).toMatchObject({ code: 'FORBIDDEN' });
  expect(m.client).not.toHaveBeenCalled();
});
it('reads authoring warnings, effective fallback and every theme origin', async () => {
  const response = await storefrontLifecycle(await verifyTemplateSession(), { operation: 'read' });
  expect(response).toMatchObject({ success: true, data: { revision: 3, effectiveTemplateId: 'default', draft: D_CONFIG, published: DEFAULT_CONFIG, unusedSlots: [], validation: { valid: true, warnings: expect.arrayContaining([expect.objectContaining({ code: 'ENTITLEMENT' }), expect.objectContaining({ code: 'TRANSLATION_FALLBACK' })]) }, effectiveTokens: expect.any(Array) } });
  if (response.success && 'data' in response && 'effectiveTokens' in response.data) expect(response.data.effectiveTokens).toHaveLength(22);
});
it('allows free validation of Pro authoring but reports publication rights as errors', async () => {
  const auth = await verifyTemplateSession();
  expect(await storefrontLifecycle(auth, { operation: 'validate', config: D_CONFIG, mode: 'draft' })).toMatchObject({ success: true, data: { valid: true } });
  expect(await storefrontLifecycle(auth, { operation: 'validate', config: D_CONFIG, mode: 'publish' })).toMatchObject({ success: true, data: { valid: false, errors: expect.arrayContaining([expect.objectContaining({ code: 'ENTITLEMENT' })]) } });
});
it('validates live required products and categories while optional starters warn', async () => {
  m.tier.mockReturnValue('pro');
  m.bindings.mockResolvedValue({ success: true, data: { hero: null, closing: null, starters: [], categories: [] } });
  const response = await storefrontLifecycle(await verifyTemplateSession(), { operation: 'validate', config: D_CONFIG, mode: 'publish' });
  expect(response).toMatchObject({ success: true, data: { valid: false, errors: expect.arrayContaining([expect.objectContaining({ path: '/settingsByTemplate/d/heroProduct' }), expect.objectContaining({ path: '/settingsByTemplate/d/closingProduct' }), expect.objectContaining({ path: '/settingsByTemplate/d/taskCategories/0' })]), warnings: expect.arrayContaining([expect.objectContaining({ path: '/settingsByTemplate/d/starterProducts/0' })]) } });
});
it('does not validate inactive or hidden optional references', async () => {
  m.tier.mockReturnValue('pro');
  const config = structuredClone(D_CONFIG); config.overridesByTemplate.d!.hidden = ['start', 'tasks'];
  expect(await storefrontLifecycle(await verifyTemplateSession(), { operation: 'validate', config, mode: 'publish' })).toMatchObject({ success: true, data: { valid: true } });
  expect(m.bindings).toHaveBeenCalledWith({}, expect.objectContaining({ starterProducts: [], taskCategories: [] }));
});
it('returns unavailable rather than approving a failed authoritative read', async () => {
  m.bindings.mockResolvedValue({ success: false });
  expect(await storefrontLifecycle(await verifyTemplateSession(), { operation: 'validate', config: D_CONFIG, mode: 'publish' })).toMatchObject({ code: 'UNAVAILABLE' });
});
it('diffs authoring snapshots with sorted pointer paths and null absent sides', async () => {
  const response = await storefrontLifecycle(await verifyTemplateSession(), { operation: 'diff', fromRevision: 1, toRevision: 3 });
  expect(response).toMatchObject({ success: true, data: { fromRevision: 1, toRevision: 3, changes: expect.arrayContaining([{ path: '/templateId', kind: 'changed', before: 'default', after: 'd' }, { path: '/settingsByTemplate/d', kind: 'added', before: null, after: D_CONFIG.settingsByTemplate.d }]), validation: { valid: true } } });
  if (response.success && 'data' in response && 'changes' in response.data) {
    const paths = response.data.changes.map(change => change.path); expect(paths).toEqual([...paths].sort());
  }
  expect(JSON.stringify(response)).not.toContain('actor_id');
});
it.each([{ operation: 'publish', expectedRevision: 3, config: DEFAULT_CONFIG }, { operation: 'read', actor: {} }])('rejects extra or invalid lifecycle input %j', async input => {
  expect(await storefrontLifecycle(await verifyTemplateSession(), input)).toMatchObject({ success: false, status: 422 });
  expect(m.client).not.toHaveBeenCalled();
});

it('uses the same service from the session action', async () => {
  expect(await storefrontTemplateAction({ operation: 'read' })).toMatchObject({ success: true, data: { revision: 3 } });
});
it('distinguishes absent history from unavailable history', async () => {
  const auth = await verifyTemplateSession();
  m.history.mockResolvedValue({ success: true, data: [] });
  expect(await storefrontLifecycle(auth, { operation: 'diff', fromRevision: 0, toRevision: 1 })).toMatchObject({ code: 'NOT_FOUND' });
  m.history.mockResolvedValue({ success: false });
  expect(await storefrontLifecycle(auth, { operation: 'diff', fromRevision: 0, toRevision: 1 })).toMatchObject({ code: 'UNAVAILABLE' });
});
it.each([
  { operation: 'publish', expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
  { operation: 'rollback', expectedRevision: 3, targetRevision: -1 },
  { operation: 'diff', fromRevision: 0, toRevision: Number.MAX_SAFE_INTEGER + 1 },
])('preserves structured revision limit errors %j', async input => {
  expect(await storefrontLifecycle(await verifyTemplateSession(), input)).toMatchObject({ code: 'LIMIT', status: 422, validation: { errors: [expect.objectContaining({ code: 'LIMIT' })] } });
});

it.each(['free', 'registered', 'pro', 'business'])('exposes current per-template publication rights for %s', async tier => {
  m.tier.mockReturnValue(tier);
  const paid = tier === 'pro' || tier === 'business';
  expect(await storefrontLifecycle(await verifyTemplateSession(), { operation: 'read' })).toMatchObject({ success: true, data: { rights: { canPublish: [
    { templateId: 'default', allowed: true, reason: null },
    { templateId: 'd', allowed: paid, reason: paid ? null : 'ENTITLEMENT' },
  ] } } });
});
it('includes active customization in publication rights without mutating the snapshot', async () => {
  const draft = { ...D_CONFIG, tokens: { format: 1, light: { accent: '#075C43' } } };
  m.read.mockResolvedValue({ success: true, data: { revision: 3, draft, published: DEFAULT_CONFIG } });
  expect(await storefrontLifecycle(await verifyTemplateSession(), { operation: 'read' })).toMatchObject({ data: { rights: { canPublish: [
    { templateId: 'default', allowed: false, reason: 'CUSTOMIZATION' },
    { templateId: 'd', allowed: false, reason: 'ENTITLEMENT' },
  ] } } });
  expect(draft.templateId).toBe('d');
});
