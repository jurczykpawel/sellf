/** Public platform tier snapshots. @see src/lib/license/public-snapshot.ts */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateSellerKeypair } from '@/lib/license-keys/keys';
import { signLicense } from '@/lib/license-keys/format';
import { getPublicLicenseTier, refreshPublicLicenseSnapshot, startPublicLicenseRefresh, stopPublicLicenseRefresh } from '@/lib/license/public-snapshot';
const mocks = vi.hoisted(() => ({ client: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.client }));
const key = generateSellerKeypair();
const keys = [{ kid: key.kid, alg: 'ES256', pem: key.publicKeyPem }];
let license: string | null;
const now = new Date('2026-10-16T12:00:00Z');
function token(tier = 'pro', exp: number | null = null, overrides: Record<string, unknown> = {}): string {
  return signLicense({ v: 1, kid: key.kid, product: 'sellf-pro', email: 'fixture@example.com', order: 'fixture', tier, domain: 'example.com', iat: now.getTime() / 1000, exp, ...overrides }, key.privateKeyPem);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('SITE_URL', 'https://example.com');
  vi.stubEnv('SELLF_LICENSE_KEY', ''); vi.stubEnv('SELLF_JWKS_FALLBACK', JSON.stringify({ keys }));
  const chain = { select: () => chain, eq: () => chain, single: mocks.read };
  mocks.read.mockImplementation(async () => ({ data: { sellf_license: license }, error: null }));
  mocks.client.mockReturnValue({ from: () => chain }); license = token();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
});
afterEach(() => { stopPublicLicenseRefresh(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('serves free on cold start without requesting storage or remote keys', () => {
  expect(getPublicLicenseTier()).toBe('free'); expect(fetch).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
});
it('verifies offline using local keys and serves a cached tier without requests', async () => {
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('pro');
  vi.mocked(fetch).mockClear(); mocks.client.mockClear();
  expect(getPublicLicenseTier()).toBe('pro'); expect(fetch).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
});
it('accepts a rotated key only after background refresh returns it', async () => {
  vi.stubEnv('SELLF_JWKS_FALLBACK', '');
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('free');
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ keys })));
  vi.advanceTimersByTime(60 * 60 * 1000);
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('pro');
});
it('applies expiry immediately and bounds warm snapshots to sixty seconds', async () => {
  license = token('business', now.getTime() / 1000 + 10);
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('business');
  vi.advanceTimersByTime(10_000); expect(getPublicLicenseTier()).toBe('free');
  license = token(); await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('pro');
  vi.advanceTimersByTime(60_000); expect(getPublicLicenseTier()).toBe('free');
});
it('replaces a warm paid snapshot after a confirmed downgrade', async () => {
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('pro');
  license = null; await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('free');
});
it('schedules idempotent background work without awaiting remote keys', async () => {
  vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
  expect(startPublicLicenseRefresh()).toBe(true); expect(startPublicLicenseRefresh()).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect(getPublicLicenseTier()).toBe('pro');
  expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: expect.any(AbortSignal), redirect: 'error' }));
});

it.each([{ domain: 'other.example' }, { product: 'another-product' }, { tier: 'unknown' }, { exp: now.getTime() / 1000 - 1 }])('renders free for unavailable claims %j', async overrides => {
  license = token('pro', null, overrides);
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('free');
});
it('retains a rotated local key set during subsequent issuer outages', async () => {
  vi.stubEnv('SELLF_JWKS_FALLBACK', '');
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ keys })));
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('pro');
  vi.mocked(fetch).mockRejectedValue(new Error('Offline'));
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('pro');
});
it('uses the existing environment token fallback with the same local verification', async () => {
  license = null; vi.stubEnv('SELLF_LICENSE_KEY', token('business'));
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('business');
});

it('refreshes local tier every thirty seconds and remote keys only at startup and twelve hours', async () => {
  startPublicLicenseRefresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.read).toHaveBeenCalledTimes(2); expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000 - 60_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fetch).toHaveBeenCalledTimes(2); expect(mocks.read).toHaveBeenCalledTimes(1441);
});
it('limits unknown-key requests to one per hour even across different key IDs and failed fetches', async () => {
  await refreshPublicLicenseSnapshot(); expect(fetch).toHaveBeenCalledTimes(1);
  license = token('pro', null, { kid: 'unknown-first' });
  vi.advanceTimersByTime(60 * 60 * 1000 - 1);
  await refreshPublicLicenseSnapshot(); expect(fetch).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  await refreshPublicLicenseSnapshot(); expect(fetch).toHaveBeenCalledTimes(2);
  license = token('pro', null, { kid: 'unknown-next' });
  vi.advanceTimersByTime(60 * 60 * 1000 - 1);
  await refreshPublicLicenseSnapshot(); expect(fetch).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(1);
  await refreshPublicLicenseSnapshot(); expect(fetch).toHaveBeenCalledTimes(3);
});
it('does not request keys early for missing tokens or a known key with an invalid signature or domain', async () => {
  await refreshPublicLicenseSnapshot();
  vi.advanceTimersByTime(60 * 60 * 1000);
  for (const next of [null, token('pro', null, { domain: 'other.example' }), token() + 'invalid']) {
    license = next; await refreshPublicLicenseSnapshot();
    expect(getPublicLicenseTier()).toBe('free'); expect(fetch).toHaveBeenCalledTimes(1);
  }
});
it.each(['error', 'exception', 'client'])('retains the previous tier only until its original deadline on a database %s', async failure => {
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('pro');
  if (failure === 'error') mocks.read.mockResolvedValue({ data: null, error: { message: 'Unavailable' } });
  else if (failure === 'exception') mocks.read.mockRejectedValue(new Error('Unavailable'));
  else mocks.client.mockImplementation(() => { throw new Error('Unavailable'); });
  vi.advanceTimersByTime(30_000);
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('pro');
  vi.advanceTimersByTime(29_999);
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('pro');
  vi.advanceTimersByTime(1); expect(getPublicLicenseTier()).toBe('free');
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('free');
});
it('keeps cold-start failures free and preserves the exact licence expiry through read failures', async () => {
  mocks.read.mockRejectedValue(new Error('Unavailable'));
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('free');
  license = token('pro', now.getTime() / 1000 + 10);
  mocks.read.mockResolvedValue({ data: { sellf_license: license }, error: null });
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('pro');
  mocks.read.mockRejectedValue(new Error('Unavailable'));
  vi.advanceTimersByTime(9999); await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('pro');
  vi.advanceTimersByTime(1); expect(getPublicLicenseTier()).toBe('free');
});

it.each(['domain', 'signature'])('replaces a warm tier immediately after a confirmed invalid %s', async invalid => {
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('pro');
  license = invalid === 'domain' ? token('pro', null, { domain: 'other.example' }) : token() + 'invalid';
  await refreshPublicLicenseSnapshot(); expect(getPublicLicenseTier()).toBe('free');
  expect(fetch).toHaveBeenCalledTimes(1);
});
