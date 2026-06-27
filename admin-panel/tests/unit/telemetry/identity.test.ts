import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { claimSend, confirmSend, getOrCreateInstanceId } from '@/lib/telemetry/identity';

const admin = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz');

const reset = () => admin.from('telemetry_state')
  .update({ last_sent_at: null, last_attempt_at: null, report_id: null }).eq('id', 'singleton');

describe('telemetry identity', () => {
  beforeEach(async () => { await reset(); });

  it('returns a stable instance id', async () => {
    const a = await getOrCreateInstanceId();
    const b = await getOrCreateInstanceId();
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('only one of two concurrent claims wins', async () => {
    const [x, y] = await Promise.all([claimSend(20*3600e3, 3600e3), claimSend(20*3600e3, 3600e3)]);
    expect([x, y].filter(Boolean).length).toBe(1);
  });

  it('a fresh claim reuses the persisted report_id until confirmed', async () => {
    const first = await claimSend(20*3600e3, 0); // lease 0 so a second claim is allowed
    const second = await claimSend(20*3600e3, 0);
    expect(first!.reportId).toBe(second!.reportId); // same logical report across attempts
    await confirmSend();
    const { data } = await admin.from('telemetry_state').select('report_id,last_sent_at').eq('id','singleton').single();
    expect(data!.report_id).toBeNull();
    expect(data!.last_sent_at).not.toBeNull();
  });

  it('does not claim again within the 20h window after confirm', async () => {
    await claimSend(20*3600e3, 0); await confirmSend();
    expect(await claimSend(20*3600e3, 0)).toBeNull();
  });
});
