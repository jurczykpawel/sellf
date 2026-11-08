import { expect, it, vi } from 'vitest';
const { query } = vi.hoisted(() => ({ query: { from: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => query }));
import { getUsedCurrencies } from '@/lib/actions/currency';
it('keeps currencies whose only retained order has a partial refund', async () => {
  query.from.mockReturnValue(query); query.select.mockReturnValue(query);
  query.eq.mockResolvedValue({ data: [] });
  query.in.mockResolvedValue({ data: [{ currency: 'PLN' }] });
  expect(await getUsedCurrencies()).toEqual(['PLN']);
});
