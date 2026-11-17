/**
 * Maintenance mode where free access and submissions are created (server side, not only the proxy):
 * no NEW free grant, free-product request, lead or waitlist submission while the shop is paused;
 * a submission recorded before the break (saved free-grant request, lead confirmation token) and a
 * payment already made still complete.
 * @see src/lib/maintenance/guard.ts
 * @see src/lib/services/free-product-access.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ emit: vi.fn(), user: vi.fn(), from: vi.fn(), trigger: vi.fn() }));
vi.mock('@/lib/services/free-access-events', () => ({ emitFreeAccessLead: m.emit }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: m.user }, from: m.from }) }));
vi.mock('@/lib/services/webhook-service', () => ({ WebhookService: { trigger: m.trigger } }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, checkRateLimitForIdentifier: async () => true }));
vi.mock('@/lib/captcha/verify', () => ({ verifyCaptchaToken: async () => ({ success: true }) }));

import { grantFreeProductAccess } from '@/lib/services/free-product-access';
import { prepareFreeGrantRequest } from '@/lib/services/free-grant-context';
import { classifyMaintenancePath } from '@/lib/maintenance/surfaces';
import { invalidateMaintenanceCache } from '@/lib/maintenance/state';
import { POST as waitlistSignup } from '@/app/api/waitlist/signup/route';
import { POST as leadSubmit } from '@/app/api/leads/submit/route';
import { GET as leadChallenge } from '@/app/api/leads/challenge/route';

const PRODUCT = { id: '11111111-1111-4111-8111-111111111111', slug: 'free-course' };
const USER = { id: 'user-1', email: 'buyer@example.com' };
let dir = '';

function maintenanceOn() {
  writeFileSync(path.join(dir, 'MAINTENANCE'), 'Upgrade in progress');
}

function userClient(savedRequest: string | null) {
  return {
    rpc: vi.fn(async (name: string) => name === 'free_grant_context'
      ? { data: savedRequest ? [{ request_id: savedRequest, custom_field_values: {} }] : [], error: null }
      : { data: true, error: null }),
  };
}

function adminClient(existingAccess: { access_expires_at: string | null } | null = null) {
  const rows: Record<string, unknown> = {
    user_product_access: existingAccess,
    products: { id: PRODUCT.id, name: 'Free course', custom_checkout_fields: [], is_active: true },
  };
  const chain = (table: string) => {
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.single = vi.fn(async () => ({ data: rows[table] ?? null, error: rows[table] ? null : { message: 'not found' } }));
    query.maybeSingle = query.single;
    return query;
  };
  return {
    from: vi.fn(chain),
    rpc: vi.fn(async (name: string) => name === 'prepare_free_grant' ? { data: 'request-new', error: null } : { data: null, error: null }),
  };
}

const grantCalls = (client: ReturnType<typeof userClient>) =>
  client.rpc.mock.calls.filter(([name]) => name === 'grant_free_product_access' || name === 'grant_free_with_context');

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sellf-free-maintenance-'));
  vi.stubEnv('SELLF_MAINTENANCE_FILE', path.join(dir, 'MAINTENANCE'));
  vi.stubEnv('SELLF_MAINTENANCE', '');
  // The database switch stays off; only the server file turns maintenance on in these tests.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('[{"enabled":false}]', { status: 200 }));
  invalidateMaintenanceCache();
  m.emit.mockReset(); m.trigger.mockReset(); m.user.mockReset(); m.from.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  invalidateMaintenanceCache();
  rmSync(dir, { recursive: true, force: true });
});

describe('free grants during maintenance @J655', () => {
  it('refuses a new free grant without a request recorded before the break, and never calls the grant', async () => {
    maintenanceOn();
    const client = userClient(null);
    const result = await grantFreeProductAccess(client as never, adminClient() as never, { product: PRODUCT, user: USER });
    expect(result).toMatchObject({ accessGranted: false, maintenance: true });
    expect(grantCalls(client)).toHaveLength(0);
    expect(m.emit).not.toHaveBeenCalled();
  });

  it('refuses a new free grant that brings its own checkout answers (a new request)', async () => {
    maintenanceOn();
    const client = userClient(null);
    const admin = adminClient();
    const result = await grantFreeProductAccess(client as never, admin as never, { product: PRODUCT, user: USER, customFieldValues: {} });
    expect(result).toMatchObject({ accessGranted: false, maintenance: true });
    expect(admin.rpc).not.toHaveBeenCalledWith('prepare_free_grant', expect.anything());
    expect(grantCalls(client)).toHaveLength(0);
  });

  it('completes a free-product request recorded before the break', async () => {
    maintenanceOn();
    const client = userClient('request-before-break');
    const result = await grantFreeProductAccess(client as never, adminClient() as never, { product: PRODUCT, user: USER, grantRequestId: 'request-before-break' });
    expect(result.accessGranted).toBe(true);
    expect(grantCalls(client)).toEqual([['grant_free_with_context', expect.objectContaining({ p_request_id: 'request-before-break' })]]);
  });

  it('completes a submission the caller verified (lead confirmation token)', async () => {
    maintenanceOn();
    const client = userClient(null);
    const result = await grantFreeProductAccess(client as never, adminClient() as never, { product: PRODUCT, user: USER, completesSubmission: true });
    expect(result.accessGranted).toBe(true);
    expect(grantCalls(client)).toHaveLength(1);
  });

  it('a buyer who already has access keeps it (no new grant)', async () => {
    maintenanceOn();
    const client = userClient(null);
    const result = await grantFreeProductAccess(client as never, adminClient({ access_expires_at: null }) as never, { product: PRODUCT, user: USER });
    expect(result).toMatchObject({ accessGranted: true, alreadyHadAccess: true });
  });

  it('grants as before when the shop is open', async () => {
    const client = userClient(null);
    const result = await grantFreeProductAccess(client as never, adminClient() as never, { product: PRODUCT, user: USER });
    expect(result.accessGranted).toBe(true);
    expect(grantCalls(client)).toHaveLength(1);
  });

  it('records no new free-product request (magic link, embed) during the break', async () => {
    maintenanceOn();
    const admin = adminClient();
    const result = await prepareFreeGrantRequest(admin as never, USER.email, PRODUCT.slug, {});
    expect(result).toEqual({ ok: false, code: 'maintenance' });
    expect(admin.from).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});

describe('submissions during maintenance @J655', () => {
  const origin = 'https://landing.example.com';

  it.each(['/api/leads/submit', '/api/leads/challenge', '/api/waitlist/signup'])('the proxy pauses %s', pathname => {
    expect(classifyMaintenancePath(pathname)).toBe('api');
  });

  it('the payment return page stays reachable for a payment already made', () => {
    expect(classifyMaintenancePath('/p/free-course/payment-status')).toBeNull();
  });

  it('refuses a new lead and its challenge with 503 MAINTENANCE, readable by the embedding page', async () => {
    maintenanceOn();
    vi.stubEnv('SELLF_EMBED_ALLOWED_ORIGINS', origin);
    const submit = await leadSubmit(new Request('https://shop.example.com/api/leads/submit', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'viewer@example.com', product: PRODUCT.slug }),
    }));
    expect(submit.status).toBe(503);
    expect(await submit.json()).toMatchObject({ code: 'MAINTENANCE' });
    expect(submit.headers.get('access-control-allow-origin')).toBe(origin);
    const challenge = await leadChallenge(new Request(`https://shop.example.com/api/leads/challenge?product=${PRODUCT.slug}`, { headers: { origin } }));
    expect(challenge.status).toBe(503);
    expect(await challenge.json()).toMatchObject({ code: 'MAINTENANCE' });
  });

  it('refuses a waitlist signup with 503 MAINTENANCE and sends no webhook', async () => {
    maintenanceOn();
    const response = await waitlistSignup(new Request('https://shop.example.com/api/waitlist/signup', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'fan@example.com', productId: PRODUCT.id }),
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'MAINTENANCE' });
    expect(m.trigger).not.toHaveBeenCalled();
  });
});
