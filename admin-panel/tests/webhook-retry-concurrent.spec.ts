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

    const [res1, res2] = await Promise.all([
      request.get(url, { headers }),
      request.get(url, { headers }),
    ]);
    expect([res1.status(), res2.status()].sort()).toEqual([200, 200]);

    const body1 = await res1.json();
    const body2 = await res2.json();

    // Together the two invocations process each of the 5 rows exactly once.
    // (FOR UPDATE SKIP LOCKED + lease prevents double-dispatch.)
    expect((body1.processed ?? 0) + (body2.processed ?? 0)).toBe(5);

    // Each row should now have attempt_count exactly 2 (one retry, not two).
    for (const id of rows) {
      const { data, error } = await supabaseAdmin
        .from('webhook_logs')
        .select('attempt_count, status')
        .eq('id', id)
        .single();
      if (error) throw error;
      expect(data!.attempt_count).toBe(2);
      expect(['success', 'pending_retry', 'permanently_failed']).toContain(data!.status);
    }
  });
});
