/** @see src/lib/leads/server.ts */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChallenge, solveChallenge } from 'altcha-lib/v1';
import { createHash } from 'node:crypto';

const m = vi.hoisted(() => ({ admin: vi.fn(), rate: vi.fn(), emailRate: vi.fn(), send: vi.fn(), validate: vi.fn(), grant: vi.fn(), trigger: vi.fn(), user: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.admin }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: m.user } }) }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: m.rate, checkRateLimitForIdentifier: m.emailRate }));
vi.mock('@/lib/auth/magic-link/request', () => ({ sendTrustedMagicLink: m.send }));
vi.mock('@/lib/actions/validate-email', () => ({ validateEmailAction: m.validate }));
vi.mock('@/lib/services/free-access-events', () => ({ emitFreeAccessLead: async (client: unknown, _input: unknown, lead: { data: unknown }) => { await m.trigger('lead.captured', lead.data, client, product.id, 'lead:lead-1'); return true; } }));
vi.mock('@/lib/services/free-product-access', () => ({ grantFreeProductAccess: m.grant }));
vi.mock('@/lib/services/webhook-service', () => ({ WebhookService: { trigger: m.trigger } }));
import { GET as challenge, OPTIONS as challengeOptions } from '@/app/api/leads/challenge/route';
import { POST as submit, OPTIONS as submitOptions } from '@/app/api/leads/submit/route';
import { GET as config } from '@/app/api/products/[id]/playerstack/route';
import { confirmLead } from '@/lib/leads/server';
import { DEFAULT_LEAD_CONSENT } from '@/lib/leads/config';

const origin = 'https://landing.example.com';
const token = 'a'.repeat(64);
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const product = { id: '11111111-1111-4111-8111-111111111111', slug: 'guide', name: 'Guide', price: 0, product_type: 'one_time', is_active: true, seller_id: null, embed_enabled: true, ...DEFAULT_LEAD_CONSENT, preview_video_url: 'https://files.example.com/video.mp4' };
let rows: Record<string, Record<string, unknown>[]>;
let nonce: string;
let altcha: string;
let failTable: string | undefined;
function db() {
  return {
    from(table: string) {
      let action = 'select'; let value: Record<string, unknown> = {}; const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      const query = {
        select: () => query, eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return query; },
        in: () => query, limit: () => query,
        insert: (v: Record<string, unknown>) => { action = 'insert'; value = v; return query; },
        delete: () => { action = 'delete'; return query; },
        maybeSingle: async () => { const r = await execute(); return { ...r, data: r.data?.[0] ?? null }; },
        single: async () => { const r = await execute(); return { ...r, data: r.data?.[0] ?? null }; },
        then: (resolve: (v: unknown) => unknown) => execute().then(resolve),
      };
      async function execute() {
        if (failTable === table) return { data: null, error: { message: 'unavailable' } };
        const entries = rows[table] ?? [];
        if (action === 'insert') { entries.push({ ...(table === 'lead_submissions' ? { expires_at: new Date(Date.now() + 86400_000).toISOString() } : {}), ...value }); rows[table] = entries; return { data: [value], error: null }; }
        const found = entries.filter(r => filters.every(f => f(r)));
        if (action === 'delete') rows[table] = entries.filter(r => !found.includes(r));
        return { data: found, error: null };
      }
      return query;
    },
    rpc: vi.fn(async (name: string) => name === 'confirm_lead_submission' ? { data: [{ ...rows.lead_submissions[0], confirmed_at: '2026-01-01T00:00:00Z' }], error: null } : { error: null }),
  };
}
function req(body?: unknown, requestOrigin = origin, method = body === undefined ? 'GET' : 'POST', path = '/api/leads/submit') {
  return new Request(`https://shop.example.com${path}`, { method, headers: { origin: requestOrigin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const payload = () => ({ email: 'viewer@example.com', src: 'https://files.example.com/video.mp4', product: 'guide', nonce, altcha });
beforeEach(async () => {
  vi.clearAllMocks(); failTable = undefined;
  vi.stubEnv('ALTCHA_HMAC_KEY', 'unit-key'); vi.stubEnv('SITE_URL', 'https://shop.example.com'); vi.stubEnv('DEMO_MODE', 'false'); vi.stubEnv('SELLF_EMBED_ALLOWED_ORIGINS', origin);
  rows = { products: [{ ...product }], admin_users: [], lead_nonces: [], lead_submissions: [] };
  m.admin.mockReturnValue(db()); m.rate.mockResolvedValue(true); m.emailRate.mockResolvedValue(true); m.send.mockResolvedValue({ ok: true }); m.validate.mockResolvedValue({ isValid: true }); m.grant.mockResolvedValue({ accessGranted: true }); m.trigger.mockResolvedValue(undefined);
  const c = await createChallenge({ hmacKey: 'unit-key', maxNumber: 10, expires: new Date(Date.now() + 600_000) });
  const solution = await solveChallenge(c.challenge, c.salt, c.algorithm, c.maxnumber).promise;
  altcha = Buffer.from(JSON.stringify({ ...c, number: solution!.number })).toString('base64');
  nonce = token;
  rows.lead_nonces.push({ nonce_hash: hash(nonce), product_id: product.id, origin, signature: c.signature, expires_at: new Date(Date.now() + 600_000).toISOString() });
});
describe('lead challenge and public product config', () => {
  it('serves same-origin browser GET requests without an Origin header', async () => {
    const request = req(undefined, origin, 'GET', '/api/leads/challenge?product=guide');
    request.headers.delete('origin'); request.headers.set('sec-fetch-site', 'same-origin');
    const r = await challenge(request); expect(r.status).toBe(200);
    expect(rows.lead_nonces.at(-1)?.origin).toBe('https://shop.example.com');
    const configRequest = req(undefined, origin, 'GET', '/api/products/guide/playerstack');
    configRequest.headers.delete('origin'); configRequest.headers.set('sec-fetch-site', 'same-origin');
    expect((await config(configRequest, { params: Promise.resolve({ id: 'guide' }) })).status).toBe(200);
    request.headers.delete('sec-fetch-site'); expect((await challenge(request)).status).toBe(403);
  });
  it('returns a signed challenge and a product-bound nonce for slug and UUID', async () => {
    for (const id of ['guide', product.id]) {
      const r = await challenge(req(undefined, origin, 'GET', `/api/leads/challenge?product=${id}`));
      expect(r.status).toBe(200); const body = await r.json(); expect(body.nonce).toMatch(/^[a-f0-9]{64}$/); expect(body.altcha.algorithm).toBe('SHA-256');
      expect(rows.lead_nonces.at(-1)?.product_id).toBe(product.id);
      expect(r.headers.get('access-control-allow-credentials')).toBe('true');
    }
  });
  it('rejects challenge traffic from an unlisted domain', async () => {
    expect((await challenge(req(undefined, 'https://other.example', 'GET', '/api/leads/challenge?product=guide'))).status).toBe(403);
  });
  it('limits challenge creation and fails when ALTCHA is unconfigured', async () => {
    m.rate.mockResolvedValue(false); expect((await challenge(req(undefined, origin, 'GET', '/api/leads/challenge?product=guide'))).status).toBe(429);
    m.rate.mockResolvedValue(true); vi.stubEnv('ALTCHA_HMAC_KEY', ''); expect((await challenge(req(undefined, origin, 'GET', '/api/leads/challenge?product=guide'))).status).toBe(503);
  });
  it('handles credentialed preflight using only the seller allowlist', async () => {
    for (const handler of [challengeOptions, submitOptions]) {
      const r = await handler(req(undefined, origin, 'OPTIONS', '/api/leads/submit?product=guide'));
      expect(r.status).toBe(204); expect(r.headers.get('access-control-allow-credentials')).toBe('true');
      expect((await handler(req(undefined, 'https://other.example', 'OPTIONS'))).status).toBe(403);
    }
  });
  it('uses the adapter request language when no locale query is supplied', async () => {
    const request = req(undefined, origin, 'GET', '/api/products/guide/playerstack');
    request.headers.set('accept-language', 'pl-PL,pl;q=0.9,en;q=0.8');
    const r = await config(request, { params: Promise.resolve({ id: 'guide' }) });
    const data = await r.json(); expect(data.emailGate.marketingConsent.version).toBe('1:pl');
    expect(data.emailGate.privacy.text.length).toBeGreaterThan(0);
  });
  it('advertises absolute configured HTTPS endpoints independently of request headers', async () => {
    vi.stubEnv('SITE_URL', 'https://configured.example:4443');
    const request = req(undefined, origin, 'GET', '/api/products/guide/playerstack');
    request.headers.set('host', 'unrelated.example'); request.headers.set('x-forwarded-host', 'unrelated.example');
    const response = await config(request, { params: Promise.resolve({ id: 'guide' }) });
    const data = await response.json();
    expect(data.emailGate.webhookUrl).toBe('https://configured.example:4443/api/leads/submit?product=guide');
    expect(data.emailGate.challengeUrl).toBe('https://configured.example:4443/api/leads/challenge?product=guide');
    expect(data.analytics).toBeUndefined();
  });
  it('keeps HTTP local configuration available for integrator-supplied endpoints', async () => {
    vi.stubEnv('SITE_URL', 'http://localhost:3893');
    const response = await config(req(undefined, origin, 'GET', '/api/products/guide/playerstack'), { params: Promise.resolve({ id: 'guide' }) });
    const data = await response.json();
    expect(response.status).toBe(200); expect(data.emailGate.product).toBe('guide');
    expect(data.emailGate.webhookUrl).toBeUndefined(); expect(data.emailGate.challengeUrl).toBeUndefined();
  });
  it('returns full PL/EN consent config without private product fields', async () => {
    rows.products[0].lead_consent_required = true;
    const r = await config(req(undefined, origin, 'GET', '/api/products/guide/playerstack?locale=pl'), { params: Promise.resolve({ id: 'guide' }) });
    expect(r.status).toBe(200); const body = await r.json();
    expect(body.emailGate.product).toBe('guide'); expect(body.emailGate.marketingConsent).toEqual({ required: true, version: '1:pl', text: DEFAULT_LEAD_CONSENT.lead_consent_text_pl });
    expect(body.emailGate.privacy.text.length).toBeGreaterThan(0);
    expect(body.emailGate.remember).toBe(false);
    expect(Object.keys(body.emailGate.messages)).toHaveLength(14);
    expect(body.marketingConsent.en.version).toBe('1:en'); expect(body.emailGate.messages.success).toContain('poczt'); expect(body.seller_id).toBeUndefined();
  });
});
describe('lead submit', () => {
  it('stores a pending lead and sends the shared magic link without emitting a webhook', async () => {
    const r = await submit(req({ ...payload(), marketingConsent: true, consentVersion: '1:pl', consentText: 'Client wording' }));
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ status: 'check_email' });
    expect(rows.lead_submissions[0]).toMatchObject({ email: 'viewer@example.com', product_id: product.id, consent_text: DEFAULT_LEAD_CONSENT.lead_consent_text_pl, client_consent_text: 'Client wording' });
    expect(new URL(m.send.mock.calls[0][0].redirectTo).searchParams.get('redirect_to')).toContain('/auth/lead'); expect(m.trigger).not.toHaveBeenCalled();
    expect((await submit(req(payload()))).status).toBe(400);
  });
  it.each([{ email: 'invalid' }, { altcha: 'invalid' }, { altcha: Buffer.from('null').toString('base64') }, { product: 'missing' }, { marketingConsent: 'true' }])('consumes nonce before rejecting %j', async invalid => {
    expect((await submit(req({ ...payload(), ...invalid }))).status).toBeGreaterThanOrEqual(400);
    expect(rows.lead_nonces).toEqual([]); expect(m.send).not.toHaveBeenCalled();
  });
  it('rejects expired nonce and mismatched product, origin or challenge', async () => {
    rows.lead_nonces[0].expires_at = '2000-01-01T00:00:00Z'; expect((await submit(req(payload()))).status).toBe(400);
    rows.lead_nonces.push({ nonce_hash: hash(nonce), product_id: null, origin, signature: 'different', expires_at: new Date(Date.now() + 600_000).toISOString() });
    expect((await submit(req(payload()))).status).toBe(400); expect(m.send).not.toHaveBeenCalled();
  });
  it.each([{ price: 10 }, { is_active: false }, { product_type: 'subscription' }, { available_from: '2999-01-01' }, { available_until: '2000-01-01' }, { embed_enabled: false }])('rejects unavailable product %j', fields => {
    Object.assign(rows.products[0], fields); return submit(req(payload())).then(r => expect(r.status).toBe(404));
  });
  it('requires consent for configured products and list-only signups', async () => {
    rows.products[0].lead_consent_required = true; expect((await submit(req(payload()))).status).toBe(400);
    rows.lead_nonces.push({ nonce_hash: hash(nonce), product_id: null, origin, signature: 'sig', expires_at: new Date(Date.now() + 600_000).toISOString() });
    expect((await submit(req({ ...payload(), product: undefined }))).status).toBe(400);
  });
  it('accepts list-only consent with an instance-bound nonce and sends confirmation', async () => {
    rows.lead_nonces[0].product_id = null;
    const r = await submit(req({ ...payload(), product: undefined, marketingConsent: true, consentVersion: '1:en' }));
    expect(r.status).toBe(200); expect(rows.lead_submissions[0].product_id).toBeNull();
    expect(rows.lead_submissions[0].consent_text).toBe(DEFAULT_LEAD_CONSENT.lead_consent_text_en);
    expect(m.trigger).not.toHaveBeenCalled();
  });
  it('rejects a different valid proof for the same nonce', async () => {
    rows.lead_nonces[0].signature = 'another-challenge';
    expect((await submit(req(payload()))).status).toBe(400); expect(m.send).not.toHaveBeenCalled();
  });
  it('does not send when the nonce store cannot be read', async () => {
    failTable = 'lead_nonces'; expect((await submit(req(payload()))).status).toBe(503);
    expect(m.send).not.toHaveBeenCalled();
  });
  it('rejects unknown consent versions', async () => {
    expect((await submit(req({ ...payload(), marketingConsent: true, consentVersion: 'old:pl' }))).status).toBe(400);
  });
  it.each(['rate', 'emailRate'] as const)('returns 429 for %s limit and still consumes nonce', async key => {
    m[key].mockResolvedValue(false); expect((await submit(req(payload()))).status).toBe(429); expect(rows.lead_nonces).toEqual([]);
  });
  it('rejects unlisted origins and does not reflect their CORS header', async () => {
    const r = await submit(req(payload(), 'https://other.example')); expect(r.status).toBe(403); expect(r.headers.get('access-control-allow-origin')).toBeNull(); expect(rows.lead_nonces).toEqual([]);
  });
  it('does not send mail when persistence fails', async () => {
    failTable = 'lead_submissions'; expect((await submit(req(payload()))).status).toBe(503); expect(m.send).not.toHaveBeenCalled();
  });
});
describe('lead confirmation', () => {
  it('grants access before confirming and queues a stable lead event only after confirmation', async () => {
    await submit(req({ ...payload(), marketingConsent: true, consentVersion: '1:en' }));
    const pending = rows.lead_submissions[0]; pending.id = 'lead-1'; pending.product = product;
    const secret = new URL(m.send.mock.calls[0][0].redirectTo).searchParams.get('redirect_to')!.split('token=')[1];
    const result = await confirmLead(secret, { id: 'u1', email: 'viewer@example.com' }, {} as never);
    expect(result.ok).toBe(true); expect(m.grant).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ deferLeadEvent: true }));
    expect(m.trigger).toHaveBeenCalledWith('lead.captured', expect.objectContaining({ marketingConsent: true, consentVersion: '1:en', consentConfirmedAt: '2026-01-01T00:00:00Z', source: 'https://files.example.com/video.mp4' }), expect.anything(), product.id, 'lead:lead-1');
  });
  it.each(['email', 'expiry', 'grant'])('does not confirm after %s rejection', async reason => {
    await submit(req(payload())); rows.lead_submissions[0].product = product;
    const issued = new URL(m.send.mock.calls[0][0].redirectTo).searchParams.get('redirect_to')!.split('token=')[1];
    if (reason === 'expiry') rows.lead_submissions[0].expires_at = '2000-01-01T00:00:00Z';
    if (reason === 'grant') m.grant.mockResolvedValue({ accessGranted: false });
    expect((await confirmLead(issued, { id: 'u2', email: reason === 'email' ? 'other@example.com' : 'viewer@example.com' }, {} as never)).ok).toBe(false);
    expect(m.trigger).not.toHaveBeenCalled();
  });
});

it('persists the form language independently of optional marketing consent', async () => {
  expect((await submit(req({ ...payload(), marketingConsent: false, consentVersion: '1:pl' }))).status).toBe(200);
  expect(rows.lead_submissions[0]).toMatchObject({ locale: 'pl', consent_version: null, marketing_consent: false });
});
