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
