import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(), configuredProvider: vi.fn(), readInvoiceConfig: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('@/lib/invoicing/config', () => ({ configuredProvider: mocks.configuredProvider, readInvoiceConfig: mocks.readInvoiceConfig }));
import { retryInvoices } from '@/lib/invoicing/service';

it('marks the existing invoice paid on the seller calendar day', async () => {
  const markPaid = vi.fn().mockResolvedValue({ success: true });
  mocks.readInvoiceConfig.mockResolvedValue({ provider: 'fakturownia', mode: 'manual', domain: 'test' });
  mocks.configuredProvider.mockResolvedValue({ markPaid });
  const rows = { data: [{ transaction_id: 'tx', provider_invoice_id: 'invoice', provider_domain: 'test', payment_transactions: { paid_at: '2026-07-04T02:00:00Z', updated_at: '2026-07-05T02:00:00Z' } }], error: null };
  let invoiceReads = 0;
  const from = vi.fn((table: string) => {
    const result = table === 'shop_config' ? { data: { custom_settings: { timezone: 'America/Los_Angeles' } }, error: null }
      : ++invoiceReads === 2 ? rows : { data: [], error: null };
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'or', 'order', 'limit', 'update', 'maybeSingle']) query[method] = () => query;
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  });
  mocks.createAdminClient.mockReturnValue({ from } as unknown as SupabaseClient);
  expect(await retryInvoices()).toEqual({ processed: 1, errors: 0 });
  expect(markPaid).toHaveBeenCalledWith('invoice', '2026-07-03');
});
