/** Shared payout projection contract. @see src/lib/affiliates/payouts/query.ts */
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/stripe/affiliate-mode', () => ({ getAffiliateLivemode: async () => false }));
import { readPreview } from '@/lib/affiliates/payouts/query';
import type { SupabaseClient } from '@supabase/supabase-js';
it('requests one database preview without reading ledger pages', async () => {
  const result = { payable_minor: '0', debt_offset_minor: '2000', available: false };
  const single = vi.fn().mockResolvedValue({ data: result, error: null });
  const select = vi.fn().mockReturnValue({ maybeSingle: single });
  const rpc = vi.fn().mockReturnValue({ select });
  const from = vi.fn(() => { throw new Error('Unexpected scan'); });
  expect(await readPreview({ rpc, from } as unknown as SupabaseClient, 'member', 'EUR', '2026-10-01')).toEqual(result);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('affiliate_preview', { p_member: 'member', p_currency: 'EUR', p_cutoff: '2026-10-01', p_livemode: false });
  expect(from).not.toHaveBeenCalled();
});
