/**
 * Unit test: saving a webhook endpoint with a custom_payload_fields key that
 * collides with a core envelope key (event/timestamp/data) is rejected at
 * write time, on both create (POST) and update (PATCH).
 *
 * The URL check resolves the hostname before the custom-field check runs, so DNS is replaced by a
 * stub answering a public address (same pattern as tests/unit/seed-webhook-endpoints.test.ts):
 * the test needs no network and fails on the field check, not on "Hostname has no A/AAAA records".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  checkFeature: vi.fn(),
  lookups: [] as string[],
}));

vi.mock('node:dns/promises', () => {
  const answer = async (hostname: string, address: string) => {
    mocks.lookups.push(hostname);
    return [address];
  };
  const resolve4 = (hostname: string) => answer(hostname, '93.184.215.14');
  const resolve6 = (hostname: string) => answer(hostname, '2606:2800:21f:cb07:6820:80da:af6b:8b2c');
  return { default: { resolve4, resolve6 }, resolve4, resolve6 };
});

vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/api')>()),
  authenticate: mocks.authenticate,
}));
vi.mock('@/lib/license/resolve', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/license/resolve')>()),
  checkFeature: mocks.checkFeature,
}));

import { POST } from '@/app/api/v1/webhooks/route';
import { PATCH } from '@/app/api/v1/webhooks/[id]/route';

const WEBHOOK_ID = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';

function makePostRequest(body: unknown) {
  return new Request('http://localhost/api/v1/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(body: unknown) {
  return new Request(`http://localhost/api/v1/webhooks/${WEBHOOK_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('webhook write endpoints — reserved custom_payload_fields keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookups = [];
    mocks.checkFeature.mockResolvedValue(true);
  });

  it('POST /api/v1/webhooks rejects a custom field named "event"', async () => {
    mocks.authenticate.mockResolvedValue({ supabase: { from: vi.fn() } });

    const res = await POST(
      makePostRequest({
        url: 'https://example.com/hook',
        events: ['payment.completed'],
        custom_payload_fields: { event: 'fake.event' },
      }) as never,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('reserved for the webhook envelope: event');
    // The URL gate ran against the stub, not the real resolver.
    expect(mocks.lookups).toContain('example.com');
  });

  it('POST /api/v1/webhooks accepts non-colliding custom field names', async () => {
    mocks.authenticate.mockResolvedValue({ supabase: { from: vi.fn() } });

    const res = await POST(
      makePostRequest({
        url: 'https://example.com/hook',
        events: ['payment.completed'],
        custom_payload_fields: { brand: 'tsa' },
      }) as never,
    );

    // Not rejected by the field-name check (may still fail later, e.g. DB access
    // in this unit test — it must never be a 400 about custom_payload_fields).
    if (res.status === 400) {
      const body = await res.json();
      expect(JSON.stringify(body)).not.toContain('reserved for the webhook envelope');
    }
  });

  it('PATCH /api/v1/webhooks/:id rejects a custom field named "data"', async () => {
    mocks.authenticate.mockResolvedValue({
      supabase: {
        from: () => ({
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: WEBHOOK_ID }, error: null }) }) }),
        }),
      },
    });

    const res = await PATCH(makePatchRequest({ custom_payload_fields: { data: 'custom' } }) as never, {
      params: Promise.resolve({ id: WEBHOOK_ID }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('reserved for the webhook envelope: data');
  });
});

function headerClient() {
  const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),insert:vi.fn().mockReturnThis(),update:vi.fn().mockReturnThis(),
    single:vi.fn(async()=>({data:{id:WEBHOOK_ID,secret:'fixture-signing-secret'},error:null})),
    then:(resolve:(value:object)=>void)=>resolve({data:[],error:null,count:0})};
  mocks.authenticate.mockResolvedValue({supabase:{from:vi.fn(()=>query)}});
  return query;
}

it.each([
  {'Bad Header':'value'}, {'X:Header':'value'}, {'Żółć':'value'}, {'Host':'value'},
  {'content-type':'value'}, {'X-Sellf-Signature':'value'}, {'x-sellf-event':'value'},
  {'Content-Length':'1'}, {'X-Tenant':'value\r\nsecond'}, {'X-Tenant':42},
])('refuses unsupported custom headers on POST and PATCH: %j', async custom_headers => {
  mocks.checkFeature.mockResolvedValue(true);
  const query=headerClient();
  const post=await POST(makePostRequest({url:'https://example.com/hook',events:['purchase.completed'],custom_headers}) as never);
  const patch=await PATCH(makePatchRequest({custom_headers}) as never,{params:Promise.resolve({id:WEBHOOK_ID})});
  expect([post.status,patch.status]).toEqual([400,400]);
  for (const response of [post,patch]) {
    expect((await response.json()).error.details.custom_headers).toBeTruthy();
  }
  expect(query.insert).not.toHaveBeenCalled();
  expect(query.update).not.toHaveBeenCalled();
});

it('persists supported custom headers on POST and PATCH',async()=>{
  const query=headerClient();
  const custom_headers={Authorization:'Bearer fixture','X-Tenant':'one'};
  const post=await POST(makePostRequest({url:'https://example.com/hook',events:['purchase.completed'],custom_headers}) as never);
  const patch=await PATCH(makePatchRequest({custom_headers}) as never,{params:Promise.resolve({id:WEBHOOK_ID})});
  expect(post.status).toBe(201);expect(patch.status).toBe(200);
  expect(query.insert).toHaveBeenCalledOnce();expect(query.update).toHaveBeenCalledOnce();
});
