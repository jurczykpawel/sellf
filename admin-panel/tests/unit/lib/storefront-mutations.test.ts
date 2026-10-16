/** Private mutation contract. @see supabase/tests/storefront-mutations.sql */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DEFAULT_CONFIG, D_CONFIG } from '@/lib/storefront-templates/fixtures';
import { verifyTemplateSession, verifyTemplateApiKey, mutateStorefrontConfig } from '@/lib/storefront-templates/mutations';
const mocks = vi.hoisted(() => ({ session: vi.fn(), requireAdmin: vi.fn(), authenticate: vi.fn(), admin: vi.fn(), rpc: vi.fn(), platform: vi.fn(), tier: vi.fn(), read: vi.fn(), history: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.session }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: mocks.requireAdmin }));
vi.mock('@/lib/api/middleware', () => ({ authenticateApiKeyPrincipal: mocks.authenticate }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin, createPlatformClient: mocks.platform }));
vi.mock('@/lib/license/resolve', () => ({ resolveCurrentTier: mocks.tier }));
vi.mock('@/lib/storefront-templates/repository', () => ({ readStorefrontConfig: mocks.read, readStorefrontHistory: mocks.history }));
const userId = 'dddddddd-0000-4000-a000-000000000000';
const keyId = 'aaaaaaaa-1111-4111-a111-111111111111';
const request = new NextRequest('http://localhost/api/private', { method: 'POST' });
const input = { expectedRevision: 0, operation: 'draft', config: DEFAULT_CONFIG };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.platform.mockReturnValue({}); mocks.tier.mockResolvedValue('pro');
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

it.each(['session', 'api_key'])('checks current rights before the %s mutation client', async method => {
  mocks.tier.mockResolvedValue('free');
  const auth = method === 'session' ? await verifyTemplateSession() : await verifyTemplateApiKey(request);
  expect(await mutateStorefrontConfig(auth, { ...input, config: D_CONFIG })).toMatchObject({ status: 403 });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('checks stored draft and rollback targets under current rights', async () => {
  mocks.authenticate.mockResolvedValue({ method: 'api_key', admin: { userId }, apiKey: { id: keyId }, scopes: ['templates:activate'] });
  const auth = await verifyTemplateApiKey(request);
  mocks.tier.mockResolvedValue('free');
  mocks.read.mockResolvedValue({ success: true, data: { revision: 0, published: DEFAULT_CONFIG, draft: D_CONFIG } });
  mocks.history.mockResolvedValue({ success: true, data: [{ revision: 0, published: D_CONFIG }] });
  for (const mutation of [{ operation: 'publish' }, { operation: 'rollback', targetRevision: 0 }]) {
    expect(await mutateStorefrontConfig(auth, { expectedRevision: 0, ...mutation })).toMatchObject({ status: 403 });
  }
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('allows free default content edits while retaining inactive settings', async () => {
  mocks.tier.mockResolvedValue('free');
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), input)).toMatchObject({ success: true });
});

it.each([
  { ...DEFAULT_CONFIG, tokens: { format: 1, typography: { font: 'dm-sans' } } },
  { ...DEFAULT_CONFIG, overridesByTemplate: { default: { variants: { catalogue: 'detail-cards' } } } },
])('checks editing rights before the mutation client', async config => {
  mocks.tier.mockResolvedValue('free');
  expect(await mutateStorefrontConfig(await verifyTemplateSession(), { ...input, config })).toMatchObject({ status: 403 });
  expect(mocks.admin).not.toHaveBeenCalled();
});
