/** Template credential repository contract. @see supabase/tests/template-credentials.sql */
import { syntheticTemplateKey } from '@/../tests/unit/storefront-templates/fixtures/template-license-policy';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { decryptSecret } from '@/lib/services/secret-encryption';
import { verifyTemplateApiKey, verifyTemplateSession } from '@/lib/storefront-templates/mutations';
import { saveTemplateCredential, readTemplateLicenseStatuses } from '@/lib/storefront-templates/template-credentials';

const m = vi.hoisted(() => ({ session: vi.fn(), auth: vi.fn(), api: vi.fn(), client: vi.fn(), rpc: vi.fn(), from: vi.fn(), rate: vi.fn() }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.session }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: m.auth }));
vi.mock('@/lib/api/middleware', () => ({ authenticateApiKeyPrincipal: m.api }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.client, createPlatformClient: m.client }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: m.rate }));
const userId = 'dddddddd-0000-4000-a000-000000000000';
const request = new NextRequest('http://localhost/private');
const input = { templateId: 'storefront-a', token: syntheticTemplateKey('storefront-a', 0, 'order-123') };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  m.auth.mockResolvedValue({ user: { id: userId } });
  m.api.mockResolvedValue({ method: 'api_key', admin: { userId }, apiKey: { id: 'aaaaaaaa-1111-4111-a111-111111111111' }, scopes: ['templates:write'] });
  m.rate.mockResolvedValue(true);
  m.client.mockReturnValue({ rpc: m.rpc, from: m.from });
  m.rpc.mockResolvedValue({ data: { success: true, status: { templateId: 'storefront-a', state: 'unknown', verifiedAt: null } }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it('encrypts with the existing helper and returns only status', async () => {
  const auth = await verifyTemplateSession();
  const response = await saveTemplateCredential(auth, input);
  expect(response).toEqual({ success: true, data: { templateId: 'storefront-a', state: 'unknown', verifiedAt: null } });
  const [name, args] = m.rpc.mock.lastCall!;
  expect(name).toBe('save_template_credential');
  expect(args.actor_user_id).toBe(userId);
  expect(args.encrypted_key).not.toContain(input.token);
  expect(await decryptSecret(args)).toBe(input.token);
  expect(JSON.stringify(response)).not.toMatch(/credential|email@|order-123|encrypted/);
  await saveTemplateCredential(auth, input);
  expect(m.rpc.mock.lastCall![1].encryption_iv).not.toBe(args.encryption_iv);
});
it.each([null, {}, { userId, method: 'session', apiKeyId: null }])('requires an issued principal %j', async auth => {
  expect(await saveTemplateCredential(auth, input)).toMatchObject({ success: false, code: 'FORBIDDEN' });
  expect(await readTemplateLicenseStatuses(auth)).toMatchObject({ code: 'FORBIDDEN' });
  expect(m.client).not.toHaveBeenCalled();
});
it.each(['products:write', 'templates:read', 'templates:activate'])('requires WRITE independently of %s', async scope => {
  m.api.mockResolvedValueOnce({ method: 'api_key', admin: { userId }, apiKey: { id: 'aaaaaaaa-1111-4111-a111-111111111111' }, scopes: [scope] });
  expect(await saveTemplateCredential(await verifyTemplateApiKey(request), input)).toMatchObject({ code: 'FORBIDDEN' });
  expect(m.client).not.toHaveBeenCalled();
});
it('requires READ independently of WRITE', async () => {
  expect(await readTemplateLicenseStatuses(await verifyTemplateApiKey(request))).toMatchObject({ code: 'FORBIDDEN' });
  expect(m.client).not.toHaveBeenCalled();
});
it.each([{ token: '' }, { token: ' ' }, { token: 'a'.repeat(16385) }, { token: 'ą'.repeat(8193) }, { token: 'credential.email@example.test.order-123' }, { token: syntheticTemplateKey('storefront-b') }, { templateId: 'default' }, { actor: userId }, { state: 'valid' }])('validates input before client use %j', async change => {
  expect(await saveTemplateCredential(await verifyTemplateSession(), { ...input, ...change })).toMatchObject({ code: 'INVALID' });
  expect(m.client).not.toHaveBeenCalled();
});
it('accepts the exact token byte boundary', async () => {
  const key = syntheticTemplateKey('storefront-a');
  expect(await saveTemplateCredential(await verifyTemplateSession(), { ...input, token: syntheticTemplateKey('storefront-a', 16384 - key.length) })).toMatchObject({ success: true });
});
it('keeps storage untouched when encryption is unavailable', async () => {
  vi.stubEnv('APP_ENCRYPTION_KEY', ''); vi.stubEnv('STRIPE_ENCRYPTION_KEY', '');
  expect(await saveTemplateCredential(await verifyTemplateSession(), input)).toMatchObject({ code: 'UNAVAILABLE' });
  expect(m.rpc).not.toHaveBeenCalled();
});
it('bounds writes and returns generic failures without logging input or DB detail', async () => {
  const log = vi.spyOn(console, 'error');
  const auth = await verifyTemplateSession();
  m.rate.mockResolvedValueOnce(false);
  expect(await saveTemplateCredential(auth, input)).toMatchObject({ code: 'RATE_LIMITED' });
  expect(m.client).not.toHaveBeenCalled();
  m.rpc.mockRejectedValueOnce(new Error(input.token));
  expect(await saveTemplateCredential(auth, input)).toEqual({ success: false, code: 'UNAVAILABLE' });
  m.rpc.mockResolvedValueOnce({ error: { message: input.token }, data: null });
  expect(await saveTemplateCredential(auth, input)).toEqual({ success: false, code: 'UNAVAILABLE' });
  expect(log).not.toHaveBeenCalled(); log.mockRestore();
});
it('selects and allowlists status fields without reading ciphertext', async () => {
  const order = vi.fn().mockResolvedValue({ data: [{ template_id: 'storefront-a', state: 'unknown', verified_at: null, token: input.token }], error: null });
  const select = vi.fn().mockReturnValue({ order });
  m.from.mockReturnValue({ select });
  expect(await readTemplateLicenseStatuses(await verifyTemplateSession())).toEqual({ success: true, data: [{ templateId: 'storefront-a', state: 'unknown', verifiedAt: null }] });
  expect(select).toHaveBeenCalledWith('template_id,state,verified_at');
});
it('does not accept serialized principals', async () => {
  const auth = JSON.parse(JSON.stringify(await verifyTemplateSession()));
  expect(await saveTemplateCredential(auth, input)).toMatchObject({ code: 'FORBIDDEN' });
  expect(m.client).not.toHaveBeenCalled();
});
it('projects the write response and retains database authorization denials', async () => {
  const auth = await verifyTemplateSession();
  m.rpc.mockResolvedValueOnce({ error: null, data: { success: true, status: { templateId: 'storefront-a', state: 'unknown', verifiedAt: null, token: input.token } } });
  expect(await saveTemplateCredential(auth, input)).toEqual({ success: true, data: { templateId: 'storefront-a', state: 'unknown', verifiedAt: null } });
  m.rpc.mockResolvedValueOnce({ error: null, data: { success: false, code: 'FORBIDDEN', detail: input.token } });
  expect(await saveTemplateCredential(auth, input)).toEqual({ success: false, code: 'FORBIDDEN' });
});
it('allows a READ-only key and uses generic read failures', async () => {
  m.api.mockResolvedValueOnce({ method: 'api_key', admin: { userId }, apiKey: { id: 'aaaaaaaa-1111-4111-a111-111111111111' }, scopes: ['templates:read'] });
  const auth = await verifyTemplateApiKey(request);
  const order = vi.fn().mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: { message: input.token } }).mockRejectedValueOnce(new Error(input.token));
  m.from.mockReturnValue({ select: () => ({ order }) });
  expect(await readTemplateLicenseStatuses(auth)).toEqual({ success: true, data: [] });
  expect(await readTemplateLicenseStatuses(auth)).toEqual({ success: false, code: 'UNAVAILABLE' });
  expect(await readTemplateLicenseStatuses(auth)).toEqual({ success: false, code: 'UNAVAILABLE' });
});
