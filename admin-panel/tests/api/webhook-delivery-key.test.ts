import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';

const admin = createClient(process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY!);

describe('delivery key backstop', () => {
  it('records a logical delivery at most once', async () => {
    const q = new SupabaseWebhookQueue(admin as any);
    const { data: ep } = await admin.from('webhook_endpoints').insert({
      url: 'https://x', events: ['purchase.completed'], is_active: true, secret: 's', product_filter_mode: 'all',
    }).select('id').single();
    const key = `dk_${Date.now()}`;
    const ok = { ok: false, httpStatus: 0, responseBody: null, errorMessage: 'x', durationMs: 1 };
    await q.recordFirstAttempt({ endpointId: ep!.id, eventType: 'purchase.completed', payload: {}, result: ok, deliveryKey: key } as any);
    await q.recordFirstAttempt({ endpointId: ep!.id, eventType: 'purchase.completed', payload: {}, result: ok, deliveryKey: key } as any);
    const { count } = await admin.from('webhook_logs').select('id', { count: 'exact', head: true }).eq('delivery_key', key);
    expect(count).toBe(1);
    await admin.from('webhook_endpoints').delete().eq('id', ep!.id);
  });
});
