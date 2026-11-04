/** Local separate-template snapshots. */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateSellerKeypair } from '@/lib/license-keys/keys';
import { signLicense } from '@/lib/license-keys/format';
import { templateRightsForTier } from '@/lib/storefront-templates/rights';
import { encryptSecret } from '@/lib/services/secret-encryption';
import { PREMIUM_POLICY_FIXTURES } from './fixtures/template-license-policy';
import { getTemplateLicenseStatus, getLocalTemplateIds, invalidateTemplateLicense, refreshTemplateLicenseSnapshot, stopTemplateLicenseRefresh } from '@/lib/storefront-templates/template-license-snapshot';
const m = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn(), client: vi.fn() }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('@/lib/security/outbound-url', () => ({ assertSafeOutboundUrl: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: m.client }));
const key = generateSellerKeypair();
const policy = { ...PREMIUM_POLICY_FIXTURES[0], trustedKeyIds: [key.kid] };
const claims = { v: 1 as const, kid: key.kid, product: policy.saleProductId, templateId: policy.templateId,
  edition: 'standard', domain: policy.productionHost, email: 'private@example.test', order: 'private-order',
  tier: 'standard', iat: 1_800_000_000, exp: null as number | null };
let row: Record<string, unknown>;
async function credential(patch = {}) {
  const token = signLicense({ ...claims, ...patch }, key.privateKeyPem);
  const encrypted = await encryptSecret(token);
  row = { template_id: policy.templateId, encrypted_key: encrypted.encryptedKey, encryption_iv: encrypted.iv, encryption_tag: encrypted.tag, state: 'unknown', verified_at: null };
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(claims.iat * 1000); vi.clearAllMocks();
  vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'));
  vi.stubEnv('SITE_URL', 'https://shop.example.test');
  vi.stubEnv('SELLF_TEMPLATE_LICENSE_POLICIES', JSON.stringify([{ ...policy,
    keys: [{ kid: key.kid, issuerId: policy.issuerId, pem: key.publicKeyPem }],
    revocationUrl: 'https://issuer.example.test/api/licenses/revoked?seller=00000000-0000-4000-8000-000000000000' }]));
  m.client.mockReturnValue({ from: () => ({ select: m.read }), rpc: m.rpc });
  m.read.mockImplementation(async () => ({ data: [row], error: null }));
  m.rpc.mockResolvedValue({ data: true, error: null });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ order_hashes: [] }))));
  await credential();
});
afterEach(() => { stopTemplateLicenseRefresh(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('starts unknown and never reads storage or network from a public reader', () => {
  expect(getLocalTemplateIds()).toEqual([]);
  expect(getTemplateLicenseStatus(policy.templateId).state).toBe('unknown');
  expect(m.client).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('requires a confirmed revocation check before activating a new credential', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('offline'));
  await refreshTemplateLicenseSnapshot(); expect(getLocalTemplateIds()).toEqual([]);
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ order_hashes: [] })));
  await refreshTemplateLicenseSnapshot(); expect(getLocalTemplateIds()).toEqual([policy.templateId]);
  vi.mocked(fetch).mockClear(); m.client.mockClear();
  expect(getLocalTemplateIds()).toEqual([policy.templateId]);
  expect(fetch).not.toHaveBeenCalled(); expect(m.client).not.toHaveBeenCalled();
  expect(JSON.stringify(getTemplateLicenseStatus(policy.templateId))).not.toMatch(/private/);
});
it('retains only the original confirmed deadline during an issuer outage', async () => {
  await refreshTemplateLicenseSnapshot(); vi.advanceTimersByTime(30_000);
  vi.mocked(fetch).mockRejectedValue(new Error('offline')); await refreshTemplateLicenseSnapshot();
  expect(getLocalTemplateIds()).toEqual([policy.templateId]);
  vi.advanceTimersByTime(30_000); expect(getLocalTemplateIds()).toEqual([]);
  expect(getTemplateLicenseStatus(policy.templateId).state).toBe('unknown');
});
it('expires at the exact credential boundary', async () => {
  await credential({ exp: claims.iat + 10 }); await refreshTemplateLicenseSnapshot();
  expect(getLocalTemplateIds()).toEqual([policy.templateId]);
  vi.advanceTimersByTime(10_000); expect(getLocalTemplateIds()).toEqual([]);
  expect(getTemplateLicenseStatus(policy.templateId).state).toBe('expired');
});
it('removes locally confirmed revocations and refuses stale writes', async () => {
  await refreshTemplateLicenseSnapshot();
  row.state = 'revoked'; await refreshTemplateLicenseSnapshot();
  expect(getTemplateLicenseStatus(policy.templateId).state).toBe('revoked'); expect(getLocalTemplateIds()).toEqual([]);
  row.state = 'unknown'; m.rpc.mockResolvedValue({ data: false, error: null });
  await refreshTemplateLicenseSnapshot(); expect(getLocalTemplateIds()).toEqual([]);
});
it('applies a revocation bucket without returning order claims', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ order_hashes: [createHash('sha256').update(claims.order).digest('hex')] })));
  await refreshTemplateLicenseSnapshot(); expect(getTemplateLicenseStatus(policy.templateId).state).toBe('revoked');
  expect(getLocalTemplateIds()).toEqual([]);
});
it.each([{ kid: 'other-key' }, { product: 'other-product' }, { templateId: 'storefront-b' }, { domain: 'www.shop.example.test' }, { edition: 'extended' }, { exp: claims.iat }, { iat: claims.iat + 1 }])('rejects unmatched claims %j', async patch => {
  await credential(patch); await refreshTemplateLicenseSnapshot(); expect(getLocalTemplateIds()).toEqual([]);
});
it('does not extend an old credential after replacement or failed authoritative reads', async () => {
  await refreshTemplateLicenseSnapshot(); await credential({ order: 'replacement' });
  vi.mocked(fetch).mockRejectedValue(new Error('offline')); await refreshTemplateLicenseSnapshot();
  expect(getLocalTemplateIds()).toEqual([]);
  m.read.mockResolvedValue({ data: null, error: {} }); vi.advanceTimersByTime(60_000);
  await refreshTemplateLicenseSnapshot(); expect(getLocalTemplateIds()).toEqual([]);
});
it('requires exact canonical runtime hosts and trusted configured policies', async () => {
  vi.stubEnv('SITE_URL', 'https://sub.shop.example.test'); await refreshTemplateLicenseSnapshot(); expect(getLocalTemplateIds()).toEqual([]);
  vi.stubEnv('SELLF_TEMPLATE_LICENSE_POLICIES', '[]'); await refreshTemplateLicenseSnapshot(); expect(getLocalTemplateIds()).toEqual([]);
});
it.each(['revocation', 'expiry', 'downgrade'])('bounds two independent warm replicas after %s', async change => {
  if (change === 'expiry') await credential({ exp: claims.iat + 10 });
  await refreshTemplateLicenseSnapshot();
  const globalState = globalThis as typeof globalThis & { sellfTemplateLicenses?: unknown };
  const first = globalState.sellfTemplateLicenses;
  delete globalState.sellfTemplateLicenses;
  vi.resetModules();
  const replica = await import('@/lib/storefront-templates/template-license-snapshot');
  try {
    await replica.refreshTemplateLicenseSnapshot();
    expect(replica.getLocalTemplateIds()).toEqual([policy.templateId]);
    if (change === 'revocation') {
      row.state = 'revoked'; await refreshTemplateLicenseSnapshot(); expect(getLocalTemplateIds()).toEqual([]);
    } else if (change === 'downgrade') {
      expect(templateRightsForTier('free', getLocalTemplateIds()).availableTemplateIds).toEqual(['default']);
      expect(templateRightsForTier('free', replica.getLocalTemplateIds()).availableTemplateIds).toEqual(['default']);
    }
    vi.advanceTimersByTime(60000);
    expect(getLocalTemplateIds()).toEqual([]); expect(replica.getLocalTemplateIds()).toEqual([]);
  } finally { replica.stopTemplateLicenseRefresh(); globalState.sellfTemplateLicenses = first; }
});
it('rejects an unmatched signature without contacting the issuer', async () => {
  const other = generateSellerKeypair();
  const encrypted = await encryptSecret(signLicense(claims, other.privateKeyPem));
  row = { ...row, encrypted_key: encrypted.encryptedKey, encryption_iv: encrypted.iv, encryption_tag: encrypted.tag };
  await refreshTemplateLicenseSnapshot();
  expect(getTemplateLicenseStatus(policy.templateId).state).toBe('invalid');
  expect(fetch).not.toHaveBeenCalled();
});
it('does not extend confirmation when the revocation response is malformed or too large', async () => {
  await refreshTemplateLicenseSnapshot(); vi.advanceTimersByTime(30000);
  vi.mocked(fetch).mockResolvedValue(new Response('x'.repeat(131073)));
  await refreshTemplateLicenseSnapshot(); expect(getLocalTemplateIds()).toEqual([policy.templateId]);
  vi.advanceTimersByTime(30000); expect(getLocalTemplateIds()).toEqual([]);
});

it('does not restore a prior confirmation after a local replacement finishes', async () => {
  let confirm!: (value: { data: boolean; error: null }) => void;
  m.rpc.mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
  const pending = refreshTemplateLicenseSnapshot();
  await vi.waitFor(() => expect(m.rpc).toHaveBeenCalled());
  invalidateTemplateLicense(policy.templateId);
  confirm({ data: true, error: null }); await pending;
  expect(getLocalTemplateIds()).toEqual([]);
});

it.each(PREMIUM_POLICY_FIXTURES)('$templateId keeps rights independent through issuer outage and recovery', async selected => {
  const policies = PREMIUM_POLICY_FIXTURES.map(p => ({ ...p, trustedKeyIds: [key.kid],
    keys: [{ kid: key.kid, issuerId: p.issuerId, pem: key.publicKeyPem }], revocationUrl: 'https://issuer.example.test/revoked' }));
  vi.stubEnv('SELLF_TEMPLATE_LICENSE_POLICIES', JSON.stringify(policies));
  const encrypted = await encryptSecret(signLicense({ ...claims, product: selected.saleProductId, templateId: selected.templateId }, key.privateKeyPem));
  row = { ...row, template_id: selected.templateId, encrypted_key: encrypted.encryptedKey, encryption_iv: encrypted.iv, encryption_tag: encrypted.tag };
  await refreshTemplateLicenseSnapshot();
  for (const tier of ['free', 'registered', 'pro', 'business'] as const) {
    const ids = templateRightsForTier(tier, getLocalTemplateIds()).availableTemplateIds;
    expect(ids.filter(id => id.startsWith('storefront-'))).toEqual(tier === 'pro' || tier === 'business' ? [selected.templateId] : []);
  }
  vi.advanceTimersByTime(30000); vi.mocked(fetch).mockRejectedValue(new Error('offline'));
  await refreshTemplateLicenseSnapshot(); expect(getLocalTemplateIds()).toEqual([selected.templateId]);
  vi.advanceTimersByTime(30000); expect(getLocalTemplateIds()).toEqual([]);
  await refreshTemplateLicenseSnapshot(); expect(getLocalTemplateIds()).toEqual([]);
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ order_hashes: [] })));
  await refreshTemplateLicenseSnapshot(); expect(getLocalTemplateIds()).toEqual([selected.templateId]);
  invalidateTemplateLicense(selected.templateId); vi.mocked(fetch).mockRejectedValue(new Error('offline'));
  await refreshTemplateLicenseSnapshot(); expect(getLocalTemplateIds()).toEqual([]);
});
it('reports a refused status write instead of failing silently (W148-5)', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  m.rpc.mockResolvedValue({ data: false, error: null });
  await refreshTemplateLicenseSnapshot();
  expect(getTemplateLicenseStatus(policy.templateId).state).toBe('unknown');
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('[templates]'), policy.templateId);
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|encrypted|BEGIN/);
  warn.mockRestore();
});
