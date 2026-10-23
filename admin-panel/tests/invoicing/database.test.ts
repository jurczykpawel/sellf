import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ recorded: null as null | { success: boolean; id: string; number: string; viewUrl: string }, fail: false, configFailure: false, issue: vi.fn(), find: vi.fn(), markPaid: vi.fn() }));
vi.mock('@/lib/invoicing/config', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/invoicing/config')>();
  return { ...original, configuredProvider: async () => {
    if (state.configFailure) throw new Error('Key unavailable');
    return { id: 'fakturownia', issue: state.issue, findByExternalKey: state.find, markPaid: state.markPaid };
  } };
});
import { createAdminClient } from '@/lib/supabase/admin';
import { issueInvoiceForTransaction, retryInvoices } from '@/lib/invoicing/service';

const client = createAdminClient();
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SUPABASE_URL ?? '')) throw new Error('Requires a local disposable Supabase stack');
const id = 'e1000000-0000-4000-8000-000000000010';
let invoice: unknown, config: unknown;
const stale = () => new Date(Date.now() - 660000).toISOString();
beforeAll(async () => {
  invoice = (await client.from('invoices').select('*').eq('transaction_id', id).single()).data;
  config = (await client.from('invoicing_config').select('*').single()).data;
});
beforeEach(async () => {
  await client.from('invoices').delete().eq('transaction_id', id);
  await client.from('invoicing_config').update({ provider: 'fakturownia', domain: 'fixture.fakturownia.pl', mode: 'auto' }).eq('id', true);
  state.recorded = null; state.fail = false; state.configFailure = false;
  state.find.mockReset().mockImplementation(async () => state.recorded);
  state.issue.mockReset().mockImplementation(async () => {
    if (state.fail) return { success: false, error: 'Fakturownia HTTP 429' };
    state.recorded = { success: true, id: '987', number: 'FV/TEST/1', viewUrl: 'https://fixture.fakturownia.pl/invoice/test' };
    return state.recorded;
  });
  state.markPaid.mockReset().mockResolvedValue({ success: true });
});
afterAll(async () => {
  await client.from('invoices').delete().eq('transaction_id', id);
  if (invoice) await client.from('invoices').insert(invoice as never);
  if (config) await client.from('invoicing_config').upsert(config as never);
});
describe('invoice service with PostgreSQL persistence', () => {
  it('claims two concurrent callers once through transaction uniqueness', async () => {
    await Promise.all([issueInvoiceForTransaction(id, { client }), issueInvoiceForTransaction(id, { client })]);
    expect(state.issue).toHaveBeenCalledTimes(1);
    expect(state.find).toHaveBeenCalledTimes(1);
    const { data, error } = await client.from('invoices').select('*').eq('transaction_id', id).single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: 'issued', attempts: 1, number: 'FV/TEST/1' });
  });
  it('recovers a provider invoice when the final database write failed', async () => {
    const unreliable = createAdminClient();
    const from = unreliable.from.bind(unreliable);
    let dropWrite = true;
    vi.spyOn(unreliable, 'from').mockImplementation(((table: string) => {
      const builder = from(table as never);
      if (table === 'invoices') {
        const update = builder.update.bind(builder);
        builder.update = ((values: { status?: string }) => {
          if (values.status === 'issued' && dropWrite) {
            dropWrite = false;
            const chain = { eq: () => chain, select: async () => ({ data: null, error: { message: 'Write unavailable' } }) };
            return chain;
          }
          return update(values as never);
        }) as typeof builder.update;
      }
      return builder;
    }) as typeof unreliable.from);
    expect(await issueInvoiceForTransaction(id, { client: unreliable })).toMatchObject({ success: false, error: 'Invoice result not saved' });
    await client.from('invoices').update({ updated_at: stale() }).eq('transaction_id', id);
    expect(await issueInvoiceForTransaction(id, { client })).toMatchObject({ success: true, number: 'FV/TEST/1' });
    expect(state.issue).toHaveBeenCalledTimes(1);
    expect(state.find).toHaveBeenCalledTimes(2);
  });
  it('backs off persisted failures and stops issuing at five attempts', async () => {
    state.fail = true;
    await issueInvoiceForTransaction(id, { client });
    await retryInvoices();
    expect(state.issue).toHaveBeenCalledTimes(1);
    await client.from('invoices').update({ updated_at: stale() }).eq('transaction_id', id);
    await retryInvoices();
    expect(state.issue).toHaveBeenCalledTimes(2);
    expect((await client.from('invoices').select('attempts').eq('transaction_id', id).single()).data?.attempts).toBe(2);
    await client.from('invoices').update({ attempts: 5, updated_at: stale() }).eq('transaction_id', id);
    await retryInvoices();
    expect(state.issue).toHaveBeenCalledTimes(2);
  });
  it('keeps failed retries moving past a hundred unpaid invoices', async () => {
    state.fail = true;
    await issueInvoiceForTransaction(id, { client });
    await client.from('invoices').update({ updated_at: stale() }).eq('transaction_id', id);
    const tx = (await client.from('payment_transactions').select('product_id').eq('id', id).single()).data!;
    const rows = Array.from({ length: 100 }, () => ({ id: crypto.randomUUID(), product_id: tx.product_id,
      session_id: `cs_invoice_queue_${crypto.randomUUID().replaceAll('-', '')}`, customer_email: 'invoice-queue@example.test', amount: 100, currency: 'PLN', status: 'pending' }));
    try {
      expect((await client.from('payment_transactions').insert(rows)).error).toBeNull();
      expect((await client.from('invoices').insert(rows.map(row => ({ transaction_id: row.id, provider: 'fakturownia', provider_domain: 'fixture.fakturownia.pl', external_key: row.id, status: 'issued', payment_synced: false, updated_at: '2000-01-01T00:00:00Z' })))).error).toBeNull();
      state.fail = false;
      await retryInvoices();
      expect(state.issue).toHaveBeenCalledTimes(2);
    } finally {
      await client.from('invoices').delete().in('transaction_id', rows.map(row => row.id));
      await client.from('payment_transactions').delete().in('id', rows.map(row => row.id));
    }
  });
  it('records configuration errors as failed attempts', async () => {
    state.configFailure = true;
    expect(await issueInvoiceForTransaction(id, { client })).toMatchObject({ success: false });
    expect((await client.from('invoices').select('status,error').eq('transaction_id', id).single()).data).toMatchObject({ status: 'failed', error: 'Invoice request failed' });
  });
  it('keeps automatic issuance off in manual mode', async () => {
    await client.from('invoicing_config').update({ mode: 'manual' }).eq('id', true);
    expect(await issueInvoiceForTransaction(id, { client })).toBeNull();
    expect(state.issue).not.toHaveBeenCalled();
    expect((await issueInvoiceForTransaction(id, { client, manual: true }))?.success).toBe(true);
  });
  it('synchronizes recovered unpaid invoice after completed payment', async () => {
    await issueInvoiceForTransaction(id, { client });
    await retryInvoices();
    expect(state.markPaid).toHaveBeenCalledTimes(1);
    expect((await client.from('invoices').select('payment_synced').eq('transaction_id', id).single()).data?.payment_synced).toBe(true);
  });
});
