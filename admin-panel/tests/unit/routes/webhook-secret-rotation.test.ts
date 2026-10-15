/** @see src/app/api/v1/webhooks/[id]/rotate-secret/route.ts */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ApiAuthError } from '@/lib/api/errors';
import { decryptWebhookSecret } from '@/lib/webhooks/signing-secret';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/api', async (actual) => ({
  ...(await actual<typeof import('@/lib/api')>()), authenticate: mocks.authenticate,
}));
import { POST } from '@/app/api/v1/webhooks/[id]/rotate-secret/route';

const id = 'ca4d8bda-014e-46b7-a3eb-13cbf1e250af';
const actor = '91abbd83-4bc6-4d58-8d1a-a3e13c43ddf5';
function rotate(endpointId = id) {
  return POST(new NextRequest(`http://localhost/api/v1/webhooks/${endpointId}/rotate-secret`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
  }), { params: Promise.resolve({ id: endpointId }) });
}

describe('webhook secret rotation', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    mocks.authenticate.mockResolvedValue({ method: 'api_key', admin: { userId: actor }, apiKey: { id }, supabase: { rpc: mocks.rpc } });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });
  it.each(['UNAUTHORIZED', 'FORBIDDEN'] as const)('requires write authorization: %s', async (code) => {
    mocks.authenticate.mockRejectedValue(new ApiAuthError(code, 'Denied'));
    expect((await rotate()).status).toBe(code === 'UNAUTHORIZED' ? 401 : 403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('validates the endpoint ID before changing it', async () => {
    expect((await rotate('invalid')).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns a fresh secret once and persists only its encrypted form with the actor', async () => {
    const response = await rotate();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { data } = await response.json();
    expect(data.secret).toMatch(/^whsec_[a-f0-9]{64}$/);
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.anything(), ['webhooks:write']);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe('rotate_webhook_secret');
    expect(args).toMatchObject({ p_endpoint_id: id, p_actor_id: actor, p_api_key_id: id });
    expect(args.p_secret).not.toContain(data.secret);
    expect(await decryptWebhookSecret(args.p_secret)).toBe(data.secret);
    const next = await (await rotate()).json();
    expect(next.data.secret).not.toBe(data.secret);
  });
  it('records session rotation without an API key', async () => {
    mocks.authenticate.mockResolvedValue({ method: 'session', admin: { userId: actor }, supabase: { rpc: mocks.rpc } });
    expect((await rotate()).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_api_key_id).toBeNull();
  });
  it('does not change storage when encryption is unavailable', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', 'invalid');
    const response = await rotate();
    expect(response.status).toBe(500);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('APP_ENCRYPTION_KEY');
  });
  it('returns 404 for an absent endpoint', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect((await rotate()).status).toBe(404);
  });
  it('returns no secret when the atomic operation fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private details' } });
    const response = await rotate();
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain('whsec_');
    expect(body).not.toContain('private details');
  });
});
