import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
vi.mock('undici', () => ({ fetch: vi.fn() }));
vi.mock('@/lib/security/safe-fetch', async actual => ({ ...(await actual<object>()), getSsrfSafeAgent: () => undefined }));
import { fetch as send } from 'undici';
import { WebhookDispatcher } from '@/lib/services/webhook-queue/dispatcher';
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
afterEach(() => vi.clearAllMocks());
it('checks the destination again for a delivery already picked by a worker, and accepts a new delivery', async () => {
  const inserted = await db.from('webhook_endpoints').insert({ url: 'https://example.com/one', secret: 'test', events: ['test.event'], is_active: true }).select('*').single();
  expect(inserted.error).toBeNull();
  const endpoint = inserted.data!;
  try {
    const delivery = await db.from('webhook_logs').insert({ endpoint_id: endpoint.id, event_type: 'test.event', payload: {}, status: 'pending_retry', next_retry_at: new Date(0).toISOString() }).select('id').single();
    expect(delivery.error).toBeNull();
    const queue = new SupabaseWebhookQueue(db);
    expect((await queue.pickDue(100)).map(d => d.id)).toContain(delivery.data!.id);
    expect((await db.from('webhook_endpoints').update({ url: 'https://example.com/two' }).eq('id', endpoint.id)).error).toBeNull();
    const options = { attemptCount: 2, deliveryId: delivery.data!.id, client: db };
    vi.mocked(send).mockResolvedValue(new Response('ok', { status: 200 }) as never);
    const current = await db.from('webhook_endpoints').select('*').eq('id', endpoint.id).single();
    expect(current.error).toBeNull();
    const result = await WebhookDispatcher.dispatch(current.data!, 'test.event', { data: 'old' }, options);
    expect(send).not.toHaveBeenCalled();
    expect(result.httpStatus).toBe(409);
    await queue.markFailed(delivery.data!.id, result, new Date());
    expect((await db.from('webhook_logs').select('status,next_retry_at').eq('id', delivery.data!.id).single()).data).toMatchObject({ status: 'permanently_failed', next_retry_at: null });
    const next = await db.from('webhook_logs').insert({ endpoint_id: endpoint.id, event_type: 'test.event', payload: {}, status: 'permanently_failed' }).select('id').single();
    expect(next.error).toBeNull();
    await queue.replay(next.data!.id);
    vi.mocked(send).mockResolvedValue(new Response('ok', { status: 200 }) as never);
    const fresh = await WebhookDispatcher.dispatch(endpoint, 'test.event', { data: 'new' }, { ...options, deliveryId: next.data!.id });
    expect(fresh.ok).toBe(true);
    expect(send).toHaveBeenCalledWith('https://example.com/two', expect.anything());
  } finally {
    await db.from('webhook_logs').delete().eq('endpoint_id', endpoint.id);
    await db.from('webhook_endpoints').delete().eq('id', endpoint.id);
  }
});

it('allows an explicit test delivery for an inactive endpoint', async () => {
  const { WebhookService } = await import('@/lib/services/webhook-service');
  const inserted = await db.from('webhook_endpoints').insert({ url: 'https://example.com/inactive', secret: 'test', events: ['test.event'], is_active: false }).select('id').single();
  expect(inserted.error).toBeNull();
  const id = inserted.data!.id;
  try {
    vi.mocked(send).mockResolvedValue(new Response('ok', { status: 200 }) as never);
    expect(await WebhookService.testEndpoint(id, 'test.event', db)).toMatchObject({ success: true, status: 200 });
    expect(send).toHaveBeenCalledOnce();
  } finally {
    await db.from('webhook_logs').delete().eq('endpoint_id', id);
    await db.from('webhook_endpoints').delete().eq('id', id);
  }
});

it('sends a new business event to a freshly created destination', async () => {
  const { execFileSync } = await import('node:child_process');
  const { getTestDatabaseContainer } = await import('../helpers/database-container');
  const { WebhookService } = await import('@/lib/services/webhook-service');
  const endpoint = await db.from('webhook_endpoints').insert({
    url: 'https://example.com/fresh', secret: 'test', events: ['access.granted'], is_active: true,
  }).select('id').single();
  expect(endpoint.error).toBeNull();
  let eventId: string | undefined;
  try {
    eventId = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
      input: `INSERT INTO public.business_events(event_type,payload) VALUES('access.granted','{"message":"fresh"}') RETURNING id;`, encoding: 'utf8',
    }).trim().split('\n')[0];
    vi.mocked(send).mockResolvedValue(new Response('ok', { status: 200 }) as never);
    await WebhookService.trigger('access.granted', { message: 'fresh' }, db, undefined, `business_${eventId}`, [endpoint.data!.id]);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('https://example.com/fresh', expect.objectContaining({
      body: expect.stringContaining('"message":"fresh"'),
    }));
    const logs = await db.from('webhook_logs').select('status,http_status').eq('endpoint_id', endpoint.data!.id);
    expect(logs.error).toBeNull();
    expect(logs.data).toEqual([{ status: 'success', http_status: 200 }]);
  } finally {
    await db.from('webhook_logs').delete().eq('endpoint_id', endpoint.data!.id);
    await db.from('webhook_endpoints').delete().eq('id', endpoint.data!.id);
    if (eventId) await db.from('business_events').delete().eq('id', eventId);
  }
});
