import { afterEach, expect, it, vi } from 'vitest';
import { getPaymentStatistics } from '@/lib/payments/statistics';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('matches database UTC day and month boundaries even when Node uses another timezone', async () => {
  vi.stubEnv('TZ', 'Pacific/Auckland'); vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-07T23:30:00Z'));
  const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
  await getPaymentStatistics({ rpc } as unknown as SupabaseClient<Database>);
  expect(rpc).toHaveBeenCalledWith('get_payment_summary', { p_today_start: '2026-11-07T00:00:00.000Z', p_month_start: '2026-11-01T00:00:00.000Z' });
});
