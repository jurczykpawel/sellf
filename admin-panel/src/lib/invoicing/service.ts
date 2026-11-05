/** Recoverable invoice issuance; callers never need to interrupt fulfillment. @see ./provider.ts */
import 'server-only';
import { firstRelated } from '@/lib/supabase/relations';
import { createAdminClient } from '@/lib/supabase/admin';
import { configuredProvider, readInvoiceConfig } from '@/lib/invoicing/config';
import { buildInvoiceInput, invoiceDate } from '@/lib/invoicing/input';
import type { InvoiceInput, InvoiceProvider, IssueResult } from '@/lib/invoicing/provider';
import type { SupabaseClient } from '@supabase/supabase-js';

export function retryDelayMs(attempts: number): number | null { return attempts >= 5 ? null : 60000 * 2 ** (attempts - 1); }
interface AttemptDependencies {
  provider: InvoiceProvider; canIssue?: boolean; claim(): Promise<boolean>; finish(result: IssueResult): Promise<boolean>;
}
export async function runInvoiceAttempt(deps: AttemptDependencies, input: InvoiceInput | (() => Promise<InvoiceInput>)): Promise<IssueResult | null> {
  if (!await deps.claim()) return null;
  let result: IssueResult;
  try {
    const mapped = typeof input === 'function' ? await input() : input;
    result = await deps.provider.findByExternalKey(mapped.externalKey) ?? (deps.canIssue === false ? { success: false, error: 'Invoice requires provider review' } : await deps.provider.issue(mapped));
  }
  catch { result = { success: false, error: 'Invoice request failed' }; }
  return await deps.finish(result) ? result : { success: false, error: 'Invoice result not saved' };
}
export async function issuedInvoice(transactionId: string, client: SupabaseClient): Promise<{ number: string; viewUrl: string } | null> {
  const { data } = await client.from('invoices').select('number,view_url').eq('transaction_id', transactionId).in('status', ['issued','corrected']).maybeSingle();
  return data?.number && data.view_url ? { number: data.number, viewUrl: data.view_url } : null;
}
export async function issueInvoiceForTransaction(transactionId: string, options: { manual?: boolean; retry?: boolean; client?: SupabaseClient } = {}): Promise<IssueResult | null> {
  try {
    const client = options.client ?? createAdminClient();
    const config = await readInvoiceConfig(client);
    if (!config || config.provider === 'none' || (!options.manual && !options.retry && config.mode !== 'auto')) return null;
    const { data: tx } = await client.from('payment_transactions').select('*').eq('id', transactionId).single();
    if (!tx || !['completed','partially_refunded','awaiting_payment'].includes(tx.status)) return { success: false, error: 'Order is not invoiceable' };
    const deadline: unknown = Reflect.get(tx, 'payment_due_at');
    if (tx.status === 'awaiting_payment' && typeof deadline !== 'string') return { success: false, error: 'Payment deadline required' };
    const { data: existing } = await client.from('invoices').select('*').eq('transaction_id', transactionId).maybeSingle();
    if (existing && ['issued','corrected'].includes(existing.status)) return { success: true, id: existing.provider_invoice_id ?? undefined, number: existing.number ?? undefined, viewUrl: existing.view_url ?? undefined };
    if (existing && (existing.provider_domain !== config.domain || (existing.attempts >= 5 && existing.status !== 'issuing'))) return { success: false, error: 'Invoice requires provider review' };
    let input: InvoiceInput | undefined, resolved: InvoiceProvider | null = null;
    const provider: InvoiceProvider = {
      id: config.provider,
      findByExternalKey: async key => { resolved = await configuredProvider(config); return resolved ? resolved.findByExternalKey(key) : { success: false, error: 'Invoice provider not configured' }; },
      issue: async value => resolved ? resolved.issue(value) : { success: false, error: 'Invoice provider not configured' },
    };
    const externalKey = existing?.external_key ?? `${config.instance_id}:${tx.order_number}`;
    const recoveryOnly = Boolean(existing && existing.attempts >= 5);
    const attempt = recoveryOnly ? 5 : (existing?.attempts ?? 0) + 1, now = new Date().toISOString();
    return await runInvoiceAttempt({ provider, canIssue: !recoveryOnly,
      claim: async () => {
        if (!existing) {
          const { error } = await client.from('invoices').insert({ transaction_id: transactionId, provider: provider.id, provider_domain: config.domain, external_key: externalKey });
          return !error;
        }
        if (existing.status === 'issuing' && Date.now() - Date.parse(existing.updated_at) < 600000) return false;
        if (!options.manual && existing.status === 'failed' && Date.now() - Date.parse(existing.updated_at) < (retryDelayMs(existing.attempts) ?? Infinity)) return false;
        const { data, error } = await client.from('invoices').update({ status: 'issuing', attempts: attempt, updated_at: now, error: null }).eq('id', existing.id).eq('status', existing.status).eq('attempts', existing.attempts).eq('updated_at', existing.updated_at).select('id');
        return !error && data?.length === 1;
      },
      finish: async result => {
        const { data, error } = await client.from('invoices').update({ status: result.success ? 'issued' : 'failed', provider_invoice_id: result.id ?? null, number: result.number ?? null, view_url: result.viewUrl ?? null, error: result.error ?? null, payment_synced: Boolean(result.paid), updated_at: new Date().toISOString() }).eq('transaction_id', transactionId).eq('status','issuing').eq('attempts', attempt).select('id');
        return !error && data?.length === 1;
      },
    }, async () => {
      const { data: rows, error } = await client.from('payment_line_items').select('*').eq('transaction_id', transactionId);
      const { data: shop } = await client.from('shop_config').select('*').maybeSingle();
      if (error || !rows?.length || !shop) throw new Error('Invoice order data unavailable');
      input = buildInvoiceInput({ ...tx, payment_due_at: typeof deadline === 'string' ? deadline : undefined }, rows, shop, externalKey, config.exemption, config.template);
      return input;
    });
  } catch { return { success: false, error: 'Invoice service unavailable' }; }
}
export async function retryInvoices(): Promise<{ processed: number; errors: number }> {
  const client = createAdminClient();
  const config = await readInvoiceConfig(client);
  if (config?.provider !== 'none' && config?.mode === 'auto' && config.auto_since) {
    const { data: missing } = await client.from('payment_transactions').select('id,invoices!left(transaction_id)')
      .gte('created_at', config.auto_since).eq('payment_provider', 'bank_transfer').in('status', ['awaiting_payment', 'completed']).is('invoices', null).order('created_at').limit(100);
    for (const tx of missing ?? []) await issueInvoiceForTransaction(tx.id, { client });
  }
  const [attempts, payments] = await Promise.all([
    client.from('invoices').select('transaction_id').or('status.eq.issuing,and(status.eq.failed,attempts.lt.5)').order('updated_at').limit(100),
    client.from('invoices').select('transaction_id,provider_invoice_id,provider_domain,payment_transactions!inner(status,updated_at,paid_at)').eq('status', 'issued').eq('payment_synced', false).eq('payment_transactions.status', 'completed').order('updated_at').limit(100),
  ]);
  if (attempts.error || payments.error) return { processed: 0, errors: 1 };
  let processed = 0, errors = 0;
  for (const row of attempts.data ?? []) {
    const result = await issueInvoiceForTransaction(row.transaction_id, { client, retry: true });
    if (result) { if (result.success) processed++; else errors++; }
  }
  const { data: shop, error: shopError } = payments.data?.length
    ? await client.from('shop_config').select('custom_settings').maybeSingle()
    : { data: null, error: null };
  for (const row of payments.data ?? []) {
    try {
      if (shopError || !shop) { errors++; continue; }
      const tx = firstRelated<{ updated_at: string; paid_at?: string | null }>(row.payment_transactions);
      const config = await readInvoiceConfig(client);
      if (!tx || !config || config.domain !== row.provider_domain) continue;
      const provider = await configuredProvider(config);
      const result = await provider?.markPaid(row.provider_invoice_id!, invoiceDate(tx.paid_at || tx.updated_at, shop));
      if (!result?.success) { errors++; continue; }
      const { error } = await client.from('invoices').update({ payment_synced: true, updated_at: new Date().toISOString() }).eq('transaction_id', row.transaction_id);
      if (error) errors++; else processed++;
    } catch { errors++; }
  }
  return { processed, errors };
}
