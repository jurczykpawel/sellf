/**
 * API Integration: SupabaseWebhookQueue state machine.
 * Hits the real local Supabase via a seller_main-scoped client.
 * Run with `bun run test:api`.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';
import type { AttemptResult } from '@/lib/services/webhook-queue/types';
import { computeNextRetry, DEFAULT_MAX_ATTEMPTS } from '@/lib/services/webhook-queue/retry-policy';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const sellerClient = createClient(supabaseUrl, supabaseKey, {
  db: { schema: 'seller_main' },
  auth: { persistSession: false, autoRefreshToken: false },
}) as any;

const queue = new SupabaseWebhookQueue(sellerClient);

let endpointId: string;
const createdLogIds: string[] = [];

const okResult: AttemptResult = {
  ok: true,
  httpStatus: 200,
  responseBody: 'ok',
  errorMessage: null,
  durationMs: 12,
};
const failResult: AttemptResult = {
  ok: false,
  httpStatus: 503,
  responseBody: 'down',
  errorMessage: 'HTTP 503',
  durationMs: 25,
};

async function fetchRow(id: string) {
  const { data, error } = await sellerClient
    .from('webhook_logs')
    .select(
      'id, status, attempt_count, max_attempts, next_retry_at, failed_permanently_at, http_status, response_body, error_message',
    )
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function insertPending(payloadKey: string | number, nextRetryOffsetSec = -5): Promise<string> {
  const next = new Date(Date.now() + nextRetryOffsetSec * 1000).toISOString();
  const { data, error } = await sellerClient
    .from('webhook_logs')
    .insert({
      endpoint_id: endpointId,
      event_type: 'test.event',
      payload: { event: 'test.event', timestamp: new Date().toISOString(), data: { key: payloadKey } },
      status: 'pending_retry',
      attempt_count: 1,
      max_attempts: 5,
      next_retry_at: next,
      http_status: 503,
      duration_ms: 0,
    })
    .select('id')
    .single();
  if (error) throw error;
  createdLogIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  const random = Math.random().toString(36).slice(2, 8);
  const { data: endpoint, error } = await sellerClient
    .from('webhook_endpoints')
    .insert({
      url: `https://example.com/dlq-${random}`,
      events: ['test.event'],
      description: 'queue test',
      is_active: true,
      secret: `whsec_test_${random}`,
    })
    .select('id')
    .single();
  if (error) throw error;
  endpointId = endpoint.id;
});

afterEach(async () => {
  if (createdLogIds.length > 0) {
    await sellerClient.from('webhook_logs').delete().in('id', createdLogIds);
    createdLogIds.length = 0;
  }
});

afterAll(async () => {
  if (endpointId) {
    await sellerClient.from('webhook_endpoints').delete().eq('id', endpointId);
  }
});

describe('SupabaseWebhookQueue.recordFirstAttempt', () => {
  it('records a successful first attempt as status=success with attempt_count=1', async () => {
    const { deliveryId, willRetry } = await queue.recordFirstAttempt({
      endpointId,
      eventType: 'test.event',
      payload: { foo: 'bar' },
      result: okResult,
    });
    createdLogIds.push(deliveryId);
    expect(willRetry).toBe(false);
    const row = await fetchRow(deliveryId);
    expect(row.status).toBe('success');
    expect(row.attempt_count).toBe(1);
    expect(row.max_attempts).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(row.next_retry_at).toBeNull();
    expect(row.failed_permanently_at).toBeNull();
    expect(row.http_status).toBe(200);
  });

  it('records a failed first attempt with retries remaining as status=pending_retry with next_retry_at ~ now+1m', async () => {
    const { deliveryId, willRetry } = await queue.recordFirstAttempt({
      endpointId,
      eventType: 'test.event',
      payload: { foo: 'bar' },
      result: failResult,
    });
    createdLogIds.push(deliveryId);
    expect(willRetry).toBe(true);
    const row = await fetchRow(deliveryId);
    expect(row.status).toBe('pending_retry');
    expect(row.attempt_count).toBe(1);
    expect(row.next_retry_at).not.toBeNull();
    const delta = new Date(row.next_retry_at!).getTime() - Date.now();
    expect(delta).toBeGreaterThan(50_000);
    expect(delta).toBeLessThan(70_000);
  });

  it('records a failed first attempt with maxAttempts=1 as status=permanently_failed with failed_permanently_at', async () => {
    const { deliveryId, willRetry } = await queue.recordFirstAttempt({
      endpointId,
      eventType: 'test.event',
      payload: { foo: 'bar' },
      result: failResult,
      maxAttempts: 1,
    });
    createdLogIds.push(deliveryId);
    expect(willRetry).toBe(false);
    const row = await fetchRow(deliveryId);
    expect(row.status).toBe('permanently_failed');
    expect(row.failed_permanently_at).not.toBeNull();
    expect(row.next_retry_at).toBeNull();
  });
});

describe('SupabaseWebhookQueue.pickDue', () => {
  it('returns deliveries with status=pending_retry and next_retry_at <= now', async () => {
    const id = await insertPending('past', -5);
    const due = await queue.pickDue(10);
    expect(due.map((d) => d.id)).toContain(id);
  });

  it('does not return future deliveries', async () => {
    const id = await insertPending('future', 60);
    const due = await queue.pickDue(10);
    expect(due.map((d) => d.id)).not.toContain(id);
  });

  it('leases picked rows so a subsequent pickDue does not return them', async () => {
    const id = await insertPending('lease', -5);
    const first = await queue.pickDue(10);
    expect(first.map((d) => d.id)).toContain(id);
    const second = await queue.pickDue(10);
    expect(second.map((d) => d.id)).not.toContain(id);
  });
});

describe('SupabaseWebhookQueue worker transitions', () => {
  it('markDelivered → status=success, attempt_count++', async () => {
    const id = await insertPending('md', -5);
    await queue.markDelivered(id, okResult);
    const row = await fetchRow(id);
    expect(row.status).toBe('success');
    expect(row.attempt_count).toBe(2);
    expect(row.next_retry_at).toBeNull();
  });

  it('markFailed → status=pending_retry, attempt_count++, next_retry_at advances', async () => {
    const id = await insertPending('mf', -5);
    const nextAt = computeNextRetry(2);
    await queue.markFailed(id, failResult, nextAt);
    const row = await fetchRow(id);
    expect(row.status).toBe('pending_retry');
    expect(row.attempt_count).toBe(2);
    const seen = new Date(row.next_retry_at!).getTime();
    expect(Math.abs(seen - nextAt.getTime())).toBeLessThan(2_000);
  });

  it('markPermanentlyFailed → status=permanently_failed, failed_permanently_at set', async () => {
    const id = await insertPending('mpf', -5);
    await queue.markPermanentlyFailed(id, failResult);
    const row = await fetchRow(id);
    expect(row.status).toBe('permanently_failed');
    expect(row.failed_permanently_at).not.toBeNull();
    expect(row.next_retry_at).toBeNull();
  });
});

describe('SupabaseWebhookQueue admin actions', () => {
  it('replay resets attempt_count=0, status=pending_retry, next_retry_at≈now, failed_permanently_at=null', async () => {
    const { data: row } = await sellerClient
      .from('webhook_logs')
      .insert({
        endpoint_id: endpointId,
        event_type: 'test.event',
        payload: { event: 'test.event', data: { x: 'r' } },
        status: 'permanently_failed',
        attempt_count: 5,
        max_attempts: 5,
        failed_permanently_at: new Date().toISOString(),
        http_status: 503,
        duration_ms: 0,
      })
      .select('id')
      .single();
    createdLogIds.push(row!.id);
    await queue.replay(row!.id);
    const after = await fetchRow(row!.id);
    expect(after.status).toBe('pending_retry');
    expect(after.attempt_count).toBe(0);
    expect(after.failed_permanently_at).toBeNull();
    expect(after.next_retry_at).not.toBeNull();
    const delta = new Date(after.next_retry_at!).getTime() - Date.now();
    expect(Math.abs(delta)).toBeLessThan(5_000);
  });

  it('forceRetryNow sets next_retry_at≈now', async () => {
    const id = await insertPending('force', 60);
    await queue.forceRetryNow(id);
    const after = await fetchRow(id);
    const delta = new Date(after.next_retry_at!).getTime() - Date.now();
    expect(Math.abs(delta)).toBeLessThan(5_000);
  });

  it('cancel flips pending_retry to permanently_failed', async () => {
    const id = await insertPending('cancel', 60);
    await queue.cancel(id);
    const after = await fetchRow(id);
    expect(after.status).toBe('permanently_failed');
    expect(after.failed_permanently_at).not.toBeNull();
    expect(after.next_retry_at).toBeNull();
  });
});
