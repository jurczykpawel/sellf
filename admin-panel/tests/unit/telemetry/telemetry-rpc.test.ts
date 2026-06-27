import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

describe('get_telemetry_metrics RPC', () => {
  it('returns a metrics object with the expected coarse keys', async () => {
    const { data, error } = await admin.rpc('get_telemetry_metrics');
    expect(error).toBeNull();
    const m = data as Record<string, unknown>;
    for (const k of ['products_total','products_active','users_with_access','transactions_completed',
      'transactions_last_30d','guest_purchases','subscriptions_active','webhooks_configured','api_keys',
      'distinct_currencies','admin_users','coupons','oto_offers','order_bumps','license_keys_issued',
      'products_subscription','products_bundle','products_pwyw','products_free']) {
      expect(typeof m[k]).toBe('number');
      expect(m[k] as number).toBeGreaterThanOrEqual(0);
    }
  });

  it('is not executable by anon', async () => {
    const anon = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      || 'sb_publishable_anon_local');
    const { error } = await anon.rpc('get_telemetry_metrics');
    expect(error).not.toBeNull();
  });

  it('telemetry_state seeds exactly one singleton row with an instance_id', async () => {
    const { data, error } = await admin.from('telemetry_state').select('id, instance_id');
    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].id).toBe('singleton');
    expect(data![0].instance_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
