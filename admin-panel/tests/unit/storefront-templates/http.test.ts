/** Template HTTP adapter contract. */
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ApiAuthError } from '@/lib/api/errors';
import { DEFAULT_CONFIG } from '@/lib/storefront-templates/fixtures';
import { CONFIG_BYTES, ENVELOPE_BYTES, result } from '@/lib/storefront-templates/json';
import { templateHttp } from '@/lib/storefront-templates/http';
const m = vi.hoisted(() => ({ auth: vi.fn(), lifecycle: vi.fn(), preview: vi.fn(), rate: vi.fn(), session: vi.fn() }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('@/lib/api/middleware', () => ({ authenticateApiKeyPrincipal: m.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: m.session }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: m.rate }));
vi.mock('@/lib/storefront-templates/lifecycle', () => ({ storefrontLifecycle: m.lifecycle }));
vi.mock('@/lib/storefront-templates/preview', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/storefront-templates/preview')>(), PREVIEW_HEADERS: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }, preparePreview: m.preview }));
const request = (body?: string | Uint8Array) => new NextRequest('http://localhost/api/v1/templates/draft', { method: body === undefined ? 'GET' : 'PUT', body, headers: { authorization: 'Bearer test' } });
const identity = (scopes: string[]) => ({ method: 'api_key', admin: { userId: 'dddddddd-0000-4000-a000-000000000000' }, apiKey: { id: 'aaaaaaaa-1111-4111-a111-111111111111' }, scopes });
beforeEach(() => {
  vi.resetAllMocks(); m.rate.mockResolvedValue(true);
  m.auth.mockResolvedValue(identity(['templates:read', 'templates:write', 'templates:activate']));
  m.lifecycle.mockResolvedValue({ success: true, revision: 1, validation: result() });
});
it.each([['UNAUTHORIZED', 401], ['FORBIDDEN', 403], ['RATE_LIMITED', 429]] as const)('maps auth %s before reading the body', async (code, status) => {
  m.auth.mockRejectedValue(new ApiAuthError(code, 'private details'));
  const response = await templateHttp(request('{'), 'draft');
  expect(response.status).toBe(status); expect(await response.json()).toEqual({ code, message: expect.any(String), validation: null, currentRevision: null });
  expect(m.lifecycle).not.toHaveBeenCalled();
});
it.each(['products:write', 'templates:read', 'templates:activate'])('requires WRITE independently of %s', async scope => {
  m.auth.mockResolvedValue(identity([scope]));
  expect((await templateHttp(request('{'), 'draft')).status).toBe(403); expect(m.lifecycle).not.toHaveBeenCalled();
});
it.each(['actor', 'operation', 'actor_user_id'])('rejects extra %s', async field => {
  const response = await templateHttp(request(JSON.stringify({ expectedRevision: 0, config: DEFAULT_CONFIG, [field]: 'read' })), 'draft');
  expect(response.status).toBe(422); expect(m.lifecycle).not.toHaveBeenCalled();
});
it.each([new Uint8Array([0xff]), new TextEncoder().encode('{"config":{},"config":{}}'), new TextEncoder().encode('{"config":"\\ud800"}')])('rejects malformed input before lifecycle', async bytes => {
  expect((await templateHttp(request(bytes), 'draft')).status).toBe(422); expect(m.lifecycle).not.toHaveBeenCalled();
});
it('counts streamed envelope bytes and cancels the stream', async () => {
  const cancel = vi.fn(); let chunks = 0;
  const body = new ReadableStream({ pull(c) { chunks++; c.enqueue(new Uint8Array(ENVELOPE_BYTES)); }, cancel });
  const req = new NextRequest('http://localhost/api/v1/templates/draft', { method: 'PUT', headers: { authorization: 'Bearer test' }, body, duplex: 'half' } as RequestInit);
  const response = await templateHttp(req, 'draft');
  expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ code: 'LIMIT', validation: { errors: [{ path: '', limit: ENVELOPE_BYTES }] } });
  expect(cancel).toHaveBeenCalled(); expect(chunks).toBeLessThanOrEqual(3); expect(m.lifecycle).not.toHaveBeenCalled();
});
it('measures raw config whitespace separately from its envelope', async () => {
  const raw = JSON.stringify(DEFAULT_CONFIG);
  const atLimit = raw.slice(0, -1) + ' '.repeat(CONFIG_BYTES - Buffer.byteLength(raw)) + '}';
  expect((await templateHttp(request(`{"expectedRevision":0,"config":${atLimit}}`), 'draft')).status).toBe(200);
  expect((await templateHttp(request(`{"expectedRevision":0,"config": ${atLimit} }`), 'draft')).status).toBe(200);
  m.lifecycle.mockClear();
  const response = await templateHttp(request(`{"expectedRevision":0,"config":${atLimit.slice(0, -1)} }}`), 'draft');
  expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ code: 'LIMIT', validation: { errors: [{ path: '/config', limit: CONFIG_BYTES }] } });
  expect(m.lifecycle).not.toHaveBeenCalled();
});
it.each(['draft', 'publish', 'rollback', 'reset', 'validate', 'diff'] as const)('passes strict %s input through shared lifecycle', async operation => {
  const bodies = { draft: { expectedRevision: 0, config: DEFAULT_CONFIG }, publish: { expectedRevision: 0 }, rollback: { expectedRevision: 0, targetRevision: 0 }, reset: { expectedRevision: 0, templateId: 'default', field: 'settings.density' }, validate: { config: DEFAULT_CONFIG, mode: 'draft' }, diff: { fromRevision: 0, toRevision: 1 } };
  expect((await templateHttp(request(JSON.stringify(bodies[operation])), operation)).status).toBe(200);
  expect(m.lifecycle).toHaveBeenCalledWith(expect.any(Object), { ...bodies[operation], operation });
});
it('keeps revision conflicts and private headers', async () => {
  m.lifecycle.mockResolvedValue({ success: false, status: 409, code: 'CONFLICT', message: 'Retry', currentRevision: 7, validation: null });
  const response = await templateHttp(request(), 'read');
  expect(response.status).toBe(409); expect(await response.json()).toEqual({ code: 'CONFLICT', message: 'Retry', currentRevision: 7, validation: null });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it('returns preview metadata and a credential-free shared page path', async () => {
  m.preview.mockResolvedValue({ success: true, data: { revision: 1, locale: 'pl', fixture: 'standard', expiresAt: new Date(Date.now() + 600000).toISOString(), model: {}, tokens: {}, validation: result(), effectiveTokens: [], unusedSlots: [] } });
  const response = await templateHttp(request(JSON.stringify({ revision: 1, locale: 'pl', fixture: 'standard' })), 'preview');
  expect(response.status).toBe(200); const data = await response.json();
  expect(data.previewPath).toMatch(/^\/template-preview\/1\?locale=pl&fixture=standard&issuedAt=\d+$/);
  expect(data.model).toBeUndefined(); expect(data.tokens).toBeUndefined(); expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
});

it('keeps the nesting bound inside config values', async () => {
  const raw = '{"expectedRevision":0,"config":' + '{"config":'.repeat(20) + '{}' + '}'.repeat(20) + '}';
  expect((await templateHttp(request(raw), 'draft')).status).toBe(422);
  expect(m.lifecycle).not.toHaveBeenCalled();
});

it.each([131071, 131072, 131073])('applies the envelope boundary at %i bytes', async size => {
  const prefix = '{"expectedRevision":0,';
  const suffix = '"config":' + JSON.stringify(DEFAULT_CONFIG) + '}';
  const body = prefix + ' '.repeat(size - Buffer.byteLength(prefix + suffix)) + suffix;
  expect((await templateHttp(request(body), 'draft')).status).toBe(size > ENVELOPE_BYTES ? 422 : 200);
});
it.each(['read', 'capabilities', 'preview', 'validate', 'diff', 'publish', 'rollback'] as const)('does not grant %s from WRITE', async operation => {
  m.auth.mockResolvedValue(identity(['templates:write']));
  expect((await templateHttp(request('{}'), operation)).status).toBe(403);
  expect(m.lifecycle).not.toHaveBeenCalled(); expect(m.preview).not.toHaveBeenCalled();
});
it('returns rate limits before envelope parsing', async () => {
  m.rate.mockResolvedValue(false);
  expect((await templateHttp(request('{'), 'draft')).status).toBe(429);
  expect(m.lifecycle).not.toHaveBeenCalled();
});
it.each([404, 422, 429, 503])('keeps lifecycle status %i', async status => {
  m.lifecycle.mockResolvedValue({ success: false, status, code: 'UNAVAILABLE', message: 'Unavailable', validation: result(), currentRevision: null });
  expect((await templateHttp(request(), 'read')).status).toBe(status);
});

it.each([['Unauthorized', 401], ['Forbidden', 403]] as const)('keeps session %s distinct', async (message, status) => {
  m.session.mockRejectedValue(new Error(message));
  const req = new NextRequest('http://localhost/api/v1/templates/config');
  expect((await templateHttp(req, 'read')).status).toBe(status);
  expect(m.lifecycle).not.toHaveBeenCalled();
});
it('uses header credentials before an ambient session', async () => {
  m.auth.mockRejectedValue(new ApiAuthError('UNAUTHORIZED', 'Unavailable key'));
  m.session.mockResolvedValue({ user: { id: 'dddddddd-0000-4000-a000-000000000000' } });
  expect((await templateHttp(request(), 'read')).status).toBe(401);
  expect(m.session).not.toHaveBeenCalled();
});

it.each(['outer', 'preview', 'lifecycle', 'authentication'])('returns Retry-After for %s throttling', async layer => {
  const throttled = { success: false, status: 429, code: 'RATE_LIMITED', message: 'Storefront preview could not be completed', validation: null, currentRevision: null };
  if (layer === 'outer') m.rate.mockResolvedValue(false);
  if (layer === 'preview') m.preview.mockResolvedValue(throttled);
  if (layer === 'lifecycle') m.lifecycle.mockResolvedValue(throttled);
  if (layer === 'authentication') m.auth.mockRejectedValue(new ApiAuthError('RATE_LIMITED', 'Try later'));
  const response = await templateHttp(request(JSON.stringify({ revision: 1, locale: 'en', fixture: 'standard' })), layer === 'lifecycle' ? 'read' : 'preview');
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBe('60');
  expect((await response.json()).message).not.toContain('mutation');
});

it('serves the descriptor-derived section map and exact section reset paths over HTTP', async () => {
  const response = await templateHttp(request(), 'capabilities');
  const capabilities = await response.json();
  expect(response.status).toBe(200);
  expect(capabilities.resetPaths.d).toContain('overrides.sections.tasks.visibility');
  expect(capabilities.resetPaths.d).toContain('overrides.sections.hero.variant');
  expect(capabilities.resetPaths.d).not.toContain('overrides.hidden');
  expect(capabilities.resetPaths.d).not.toContain('overrides.sections.catalogue.visibility');
  expect(capabilities.orderPolicy.write).toBe('full-resolved-list');
  expect(capabilities.schemas.config.properties.overridesByTemplate.properties.d.properties.sections.additionalProperties).toBe(false);
});
