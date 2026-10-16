/** Private mutation contract. @see supabase/tests/storefront-mutations.sql */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { DEFAULT_CONFIG, D_CONFIG, PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import { verifyTemplateSession, verifyTemplateApiKey, mutateStorefrontConfig } from '@/lib/storefront-templates/mutations';
const mocks = vi.hoisted(() => ({ session: vi.fn(), requireAdmin: vi.fn(), authenticate: vi.fn(), admin: vi.fn(), rpc: vi.fn(), platform: vi.fn(), tier: vi.fn(), read: vi.fn(), history: vi.fn(), bindings: vi.fn(), rate: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: mocks.rate }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.session }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: mocks.requireAdmin }));
vi.mock('@/lib/api/middleware', () => ({ authenticateApiKeyPrincipal: mocks.authenticate }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin, createPlatformClient: mocks.platform }));
vi.mock('@/lib/license/public-snapshot', () => ({ getPublicLicenseTier: mocks.tier }));
vi.mock('@/lib/storefront-templates/catalogue', () => ({ loadStorefrontBindings: mocks.bindings }));
vi.mock('@/lib/storefront-templates/repository', () => ({ readStorefrontConfig: mocks.read, readStorefrontHistory: mocks.history }));
const userId = 'dddddddd-0000-4000-a000-000000000000';
const keyId = 'aaaaaaaa-1111-4111-a111-111111111111';
const request = new NextRequest('http://localhost/api/private', { method: 'POST' });
const input = { expectedRevision: 0, operation: 'draft', config: DEFAULT_CONFIG };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rate.mockResolvedValue(true);
  mocks.bindings.mockResolvedValue({ success: true, data: { hero: PUBLIC_FIXTURE.products[0], closing: PUBLIC_FIXTURE.products[0], starters: PUBLIC_FIXTURE.products.slice(1), categories: PUBLIC_FIXTURE.categories } });
  mocks.platform.mockReturnValue({}); mocks.tier.mockReturnValue('pro');
  mocks.read.mockResolvedValue({ success: true, data: { revision: 0, draft: DEFAULT_CONFIG, published: DEFAULT_CONFIG } });
  mocks.history.mockResolvedValue({ success: true, data: [{ revision: 0, published: DEFAULT_CONFIG }] });
  mocks.session.mockResolvedValue({});
  mocks.requireAdmin.mockResolvedValue({ user: { id: userId }, role: 'platform_admin' });
  mocks.authenticate.mockResolvedValue({ method: 'api_key', admin: { userId }, apiKey: { id: keyId }, scopes: ['templates:write'] });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'storefront_config_stored_bytes' ? 150 : { success: true, revision: 1 }, error: null }));
});
describe('private storefront mutations', () => {
  it.each([null, undefined, {}, { userId, method: 'session', apiKeyId: null }])('requires an issued principal %j', async principal => {
    expect(await mutateStorefrontConfig(principal, input)).toMatchObject({ success: false, status: 403, code: 'FORBIDDEN' });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('verifies session before mutation client use and attributes its user', async () => {
    const principal = await verifyTemplateSession(request);
    expect(mocks.requireAdmin).toHaveBeenCalledWith({}, request);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(await mutateStorefrontConfig(principal, input)).toMatchObject({ success: true, revision: 1 });
    expect(mocks.rpc).toHaveBeenLastCalledWith('mutate_storefront_config', expect.objectContaining({ actor_user_id: userId, actor_method: 'session' }));
    expect(mocks.rpc.mock.lastCall?.[1]).not.toHaveProperty('actor_api_key_id');
  });
  it('uses the verified session user with caller headers present', async () => {
    const supplied = new NextRequest(request.url, { method: 'POST', headers: { 'x-actor-user-id': keyId, 'x-actor-method': 'api_key' } });
    const principal = await verifyTemplateSession(supplied);
    expect(await mutateStorefrontConfig(principal, input)).toMatchObject({ success: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith('mutate_storefront_config', expect.objectContaining({ actor_user_id: userId, actor_method: 'session' }));
    expect(await mutateStorefrontConfig(JSON.parse(JSON.stringify(principal)), input)).toMatchObject({ status: 403 });
  });
  it('returns denial for missing and non-admin sessions', async () => {
    for (const message of ['Unauthorized', 'Forbidden']) {
      mocks.requireAdmin.mockRejectedValue(new Error(message));
      expect(await verifyTemplateSession(request)).toBeNull();
    }
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('issues API principals from middleware and checks operation scopes', async () => {
    const principal = await verifyTemplateApiKey(request);
    expect(await mutateStorefrontConfig(principal, input)).toMatchObject({ success: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith('mutate_storefront_config', expect.objectContaining({ actor_user_id: userId, actor_method: 'api_key', actor_api_key_id: keyId }));
    mocks.admin.mockClear();
    expect(await mutateStorefrontConfig(principal, { expectedRevision: 0, operation: 'publish' })).toMatchObject({ status: 403 });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each(['products:write', 'templates:read'])('denies a key with only %s', async scope => {
    mocks.authenticate.mockResolvedValue({ method: 'api_key', admin: { userId }, apiKey: { id: keyId }, scopes: [scope] });
    expect(await mutateStorefrontConfig(await verifyTemplateApiKey(request), input)).toMatchObject({ status: 403 });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.platform).not.toHaveBeenCalled();
    expect(mocks.tier).not.toHaveBeenCalled();
  });
  it('requires API-key middleware authentication', async () => {
    mocks.authenticate.mockResolvedValue({ method: 'session' });
    expect(await verifyTemplateApiKey(request)).toBeNull();
    mocks.authenticate.mockRejectedValue(new Error('private detail'));
    expect(await verifyTemplateApiKey(request)).toBeNull();
  });
  it.each([{ actor_user_id: userId }, { actor: {} }, { restoredFrom: 0 }, { expectedRevision: -1 }, { expectedRevision: 9007199254740992 }, { operation: 'other' }, { config: { ...DEFAULT_CONFIG, extra: true } }])('validates input before service use %j', async change => {
    expect(await mutateStorefrontConfig(await verifyTemplateSession(), { ...input, ...change })).toMatchObject({ success: false, status: 422 });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('checks authoritative size before mutation', async () => {
    const principal = await verifyTemplateSession();
    mocks.rpc.mockResolvedValue({ data: 102401, error: null });
    expect(await mutateStorefrontConfig(principal, input)).toMatchObject({ status: 422, code: 'LIMIT', validation: { errors: [{ path: '/config', limit: 102400 }] } });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('maps conflicts and generic database failures', async () => {
    const principal = await verifyTemplateSession();
    mocks.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'storefront_config_stored_bytes' ? 150 : { success: false, code: 'CONFLICT', currentRevision: 7 }, error: null }));
    expect(await mutateStorefrontConfig(principal, input)).toMatchObject({ status: 409, code: 'CONFLICT', currentRevision: 7 });
    mocks.rpc.mockResolvedValue({ error: { message: 'private detail' }, data: null });
    expect(JSON.stringify(await mutateStorefrontConfig(principal, input))).not.toContain('private detail');
    mocks.rpc.mockRejectedValue(new Error('private detail'));
    expect(await mutateStorefrontConfig(principal, input)).toMatchObject({ status: 503 });
  });
});

it.each(['session', 'api_key'])('allows a free %s principal to save a Pro draft', async method => {
  mocks.tier.mockReturnValue('free');
  const auth = method === 'session' ? await verifyTemplateSession() : await verifyTemplateApiKey(request);
  expect(await mutateStorefrontConfig(auth, { ...input, config: D_CONFIG })).toMatchObject({ success: true, revision: 1 });
});
it('checks stored draft and rollback targets under current rights', async () => {
  mocks.authenticate.mockResolvedValue({ method: 'api_key', admin: { userId }, apiKey: { id: keyId }, scopes: ['templates:activate'] });
  const auth = await verifyTemplateApiKey(request);
  mocks.tier.mockReturnValue('free');
  mocks.read.mockResolvedValue({ success: true, data: { revision: 0, published: DEFAULT_CONFIG, draft: D_CONFIG } });
  mocks.history.mockResolvedValue({ success: true, data: [{ revision: 0, published: D_CONFIG }] });
  for (const mutation of [{ operation: 'publish' }, { operation: 'rollback', targetRevision: 0 }]) {
    expect(await mutateStorefrontConfig(auth, { expectedRevision: 0, ...mutation })).toMatchObject({ status: 403 });
  }
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('allows free default content edits while retaining inactive settings', async () => {
  mocks.tier.mockReturnValue('free');
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), input)).toMatchObject({ success: true });
});

it.each([
  { ...DEFAULT_CONFIG, tokens: { format: 1, typography: { font: 'dm-sans' } } },
  { ...DEFAULT_CONFIG, overridesByTemplate: { default: { variants: { catalogue: 'detail-cards' } } } },
])('allows free private theme and layout drafts', async config => {
  mocks.tier.mockReturnValue('free');
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { ...input, config })).toMatchObject({ success: true });
});

it('does not accept a publish payload or a caller-produced reset config', async () => {
  const auth = await verifyTemplateSession();
  for (const operation of ['publish', 'reset']) expect(await mutateStorefrontConfig(auth, { ...input, operation })).toMatchObject({ code: 'INVALID' });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('resets a token leaf from published state and preserves seller content', async () => {
  const published = { ...D_CONFIG, tokens: { format: 1, light: { accent: '#075C43' } } };
  mocks.read.mockResolvedValue({ success: true, data: { revision: 0, draft: null, published } });
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { operation: 'reset', expectedRevision: 0, templateId: 'd', field: 'tokens.light.accent' })).toMatchObject({ success: true });
  expect(mocks.rpc).toHaveBeenLastCalledWith('mutate_storefront_config', expect.objectContaining({ operation: 'reset', validated_config: { ...D_CONFIG, tokens: null } }));
  expect(published.tokens.light.accent).toBe('#075C43');
});
it.each(['content.home.hero', 'tokens.format', 'tokens.light.__proto__', '/tokens/light/accent', 'overrides.variants.missing'])('rejects reset field %s', async field => {
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { operation: 'reset', expectedRevision: 0, templateId: 'd', field })).toMatchObject({ code: 'INVALID' });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('requires token reset template to match the authoring selection', async () => {
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { operation: 'reset', expectedRevision: 0, templateId: 'd', field: 'tokens.light.accent' })).toMatchObject({ code: 'INVALID' });
});
it('checks current token rights even for an unchanged published override', async () => {
  mocks.tier.mockReturnValue('free');
  const custom = { ...DEFAULT_CONFIG, tokens: { format: 1, typography: { font: 'dm-sans' } } };
  mocks.read.mockResolvedValue({ success: true, data: { revision: 0, draft: custom, published: custom } });
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { expectedRevision: 0, operation: 'publish' })).toMatchObject({ code: 'FORBIDDEN' });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('rejects stored active compositions that the resolver cannot support', async () => {
  const config = structuredClone(D_CONFIG);
  config.overridesByTemplate.d!.order = ['tasks', 'hero', 'start', 'catalogue', 'faq', 'closing'];
  mocks.read.mockResolvedValue({ success: true, data: { revision: 0, draft: config, published: DEFAULT_CONFIG } });
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { expectedRevision: 0, operation: 'publish' })).toMatchObject({ code: 'INVALID', validation: { errors: [expect.objectContaining({ code: 'COMPATIBILITY' })] } });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('rejects resolved contrast problems before publishing', async () => {
  mocks.read.mockResolvedValue({ success: true, data: { revision: 0, draft: { ...DEFAULT_CONFIG, tokens: { format: 1, light: { foreground: '#F0F4F8' } } }, published: DEFAULT_CONFIG } });
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { expectedRevision: 0, operation: 'publish' })).toMatchObject({ code: 'INVALID', validation: { errors: [expect.objectContaining({ code: 'CONTRAST' })] } });
});

it('promotes only the stored draft and invalidates after the committed result', async () => {
  mocks.read.mockResolvedValue({ success: true, data: { revision: 0, draft: D_CONFIG, published: DEFAULT_CONFIG } });
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { operation: 'publish', expectedRevision: 0 })).toMatchObject({ success: true });
  expect(mocks.rpc).toHaveBeenLastCalledWith('mutate_storefront_config', expect.objectContaining({ validated_config: null, operation: 'publish' }));
  expect(vi.mocked(revalidateTag).mock.invocationCallOrder[0]).toBeGreaterThan(mocks.rpc.mock.invocationCallOrder.at(-1)!);
});
it('retains publication success and revision when invalidation fails', async () => {
  vi.mocked(revalidateTag).mockImplementation(() => { throw Error('cache unavailable'); });
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { operation: 'publish', expectedRevision: 0 })).toMatchObject({ success: true, revision: 1, validation: { warnings: [expect.objectContaining({ message: expect.stringContaining('Publication committed') })] } });
});
it('revalidates rollback products against current public availability', async () => {
  mocks.history.mockResolvedValue({ success: true, data: [{ revision: 0, published: D_CONFIG }] });
  mocks.bindings.mockResolvedValue({ success: true, data: { hero: null, closing: PUBLIC_FIXTURE.products[0], starters: [], categories: PUBLIC_FIXTURE.categories } });
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { operation: 'rollback', expectedRevision: 0, targetRevision: 0 })).toMatchObject({ code: 'INVALID', validation: { errors: [expect.objectContaining({ path: '/settingsByTemplate/d/heroProduct' })] } });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('passes historic publication identity to the append-only RPC', async () => {
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { operation: 'rollback', expectedRevision: 0, targetRevision: 0 })).toMatchObject({ success: true });
  expect(mocks.rpc).toHaveBeenLastCalledWith('mutate_storefront_config', expect.objectContaining({ operation: 'rollback', restored_from: 0, validated_config: null }));
});
it('returns a structured error when no stored draft exists', async () => {
  mocks.read.mockResolvedValue({ success: true, data: { revision: 0, draft: null, published: DEFAULT_CONFIG } });
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { operation: 'publish', expectedRevision: 0 })).toMatchObject({ code: 'INVALID', validation: { valid: false } });
});
it('returns a preflight conflict without creating the mutation client', async () => {
  mocks.read.mockResolvedValue({ success: true, data: { revision: 7, draft: D_CONFIG, published: DEFAULT_CONFIG } });
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), input)).toMatchObject({ code: 'CONFLICT', currentRevision: 7, status: 409 });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('keeps demo writes disabled and applies the actor-scoped limiter', async () => {
  const principal = await verifyTemplateSession();
  vi.stubEnv('DEMO_MODE', 'true');
  try { expect(await mutateStorefrontConfig(principal, input)).toMatchObject({ code: 'FORBIDDEN' }); }
  finally { vi.unstubAllEnvs(); }
  mocks.rate.mockResolvedValue(false);
  expect(await mutateStorefrontConfig(principal, input)).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  expect(mocks.rate).toHaveBeenLastCalledWith('storefront_mutation', 60, 1, userId);
  expect(mocks.admin).not.toHaveBeenCalled();
});

it('passes bounded legacy source metadata to the atomic mutation', async () => {
  const legacySource = { sha256: 'a'.repeat(64), byteLength: 123 };
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { ...input, operation: 'legacy-import', legacySource })).toMatchObject({ success: true });
  expect(mocks.rpc).toHaveBeenLastCalledWith('mutate_storefront_config', expect.objectContaining({ legacy_source: legacySource }));
});
it.each([undefined, { sha256: 'a', byteLength: 1 }, { sha256: 'a'.repeat(64), byteLength: 102401 }, { sha256: 'a'.repeat(64), byteLength: -1 }, { sha256: 'a'.repeat(64), byteLength: 1, content: 'text' }])('requires bounded legacy source metadata %j', async legacySource => {
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { ...input, operation: 'legacy-import', legacySource })).toMatchObject({ code: 'INVALID' });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('rejects legacy source metadata on ordinary drafts', async () => {
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { ...input, legacySource: { sha256: 'a'.repeat(64), byteLength: 1 } })).toMatchObject({ code: 'INVALID' });
  expect(mocks.admin).not.toHaveBeenCalled();
});

it.each(['publish', 'rollback'])('rechecks local rights after asynchronous binding validation for %s', async operation => {
  mocks.read.mockResolvedValue({ success: true, data: { revision: 0, draft: D_CONFIG, published: DEFAULT_CONFIG } });
  mocks.history.mockResolvedValue({ success: true, data: [{ revision: 0, published: D_CONFIG }] });
  mocks.bindings.mockImplementation(async () => {
    mocks.tier.mockReturnValue('free');
    return { success: true, data: { hero: PUBLIC_FIXTURE.products[0], closing: PUBLIC_FIXTURE.products[0], starters: PUBLIC_FIXTURE.products.slice(1), categories: PUBLIC_FIXTURE.categories } };
  });
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { operation, expectedRevision: 0, ...(operation === 'rollback' ? { targetRevision: 0 } : {}) })).toMatchObject({ success: false, code: 'FORBIDDEN' });
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
});
