import { test, expect } from '@playwright/test';
import { supabaseAdmin } from './helpers/admin-auth';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3777';
const CRON_SECRET = process.env.CRON_SECRET || 'dev-cron-secret-change-in-production';

test.describe('Concurrent webhook-deliveries-retry worker invocations', () => {
  test.describe.configure({ mode: 'serial' });

  let endpointId: string;
  const insertedLogIds: string[] = [];

  test.beforeAll(async () => {
    const random = Math.random().toString(36).slice(2, 8);
    const { data: endpoint, error } = await supabaseAdmin
      .from('webhook_endpoints')
      .insert({
        url: 'https://example.com/concurrent-test',
        events: ['purchase.completed'],
        is_active: true,
        secret: `whsec_test_${random}`,
      })
      .select('id')
      .single();
    if (error) throw error;
    endpointId = endpoint!.id;
  });

  test.afterAll(async () => {
    if (insertedLogIds.length > 0) {
      await supabaseAdmin.from('webhook_logs').delete().in('id', insertedLogIds);
    }
    if (endpointId) await supabaseAdmin.from('webhook_endpoints').delete().eq('id', endpointId);
  });

  test('two parallel worker calls together process each row only once', async ({ request }) => {
    const past = new Date(Date.now() - 5_000).toISOString();
    const rows = await Promise.all(
      Array.from({ length: 5 }).map(async (_, i) => {
        const { data, error } = await supabaseAdmin
          .from('webhook_logs')
          .insert({
            endpoint_id: endpointId,
            event_type: 'purchase.completed',
            payload: { event: 'purchase.completed', timestamp: new Date().toISOString(), data: { i } },
            status: 'pending_retry',
            attempt_count: 1,
            max_attempts: 5,
            next_retry_at: past,
            http_status: 503,
            duration_ms: 0,
          })
          .select('id')
          .single();
        if (error) throw error;
        return data!.id;
      }),
    );
    insertedLogIds.push(...rows);

    const url = `${BASE_URL}/api/cron?job=webhook-deliveries-retry`;
    const headers = { Authorization: `Bearer ${CRON_SECRET}` };

    // The retry cron is GLOBAL (pick_due_webhook_deliveries is not endpoint-scoped) and
    // processes at most WEBHOOK_RETRY_BATCH=50 due rows per call. In a full E2E run sibling
    // specs leave their own due-now pending_retry rows behind — they could crowd OUR 5 out of
    // the batch (attempt_count stuck at 1) or, with a retry loop, get re-picked after backoff
    // (attempt_count climbing to 3). So PARK every OTHER due-now pending_retry row (defer its
    // next_retry_at — non-destructive, just postpones it) so OUR 5 are the only due rows. Then
    // one pair of concurrent calls competes on exactly our rows → each processed exactly once.
    await supabaseAdmin
      .from('webhook_logs')
      .update({ next_retry_at: new Date(Date.now() + 3_600_000).toISOString() })
      .eq('status', 'pending_retry')
      .lte('next_retry_at', new Date().toISOString())
      .not('id', 'in', `(${rows.join(',')})`);

    const [res1, res2] = await Promise.all([
      request.get(url, { headers }),
      request.get(url, { headers }),
    ]);
    expect([res1.status(), res2.status()].sort()).toEqual([200, 200]);

    // No-double-dispatch invariant: each of OUR rows is processed EXACTLY once by the two
    // concurrent calls — attempt_count goes 1 -> 2, never 3 (3 would mean the same row was
    // dispatched twice by the parallel workers, i.e. the SKIP LOCKED claim failed).
    const { data: finalRows, error } = await supabaseAdmin
      .from('webhook_logs')
      .select('id, attempt_count, status')
      .in('id', rows);
    if (error) throw error;
    expect(finalRows).toHaveLength(rows.length);
    for (const r of finalRows!) {
      expect(r.attempt_count).toBe(2);
      expect(['success', 'pending_retry', 'permanently_failed']).toContain(r.status);
    }
  });
});
