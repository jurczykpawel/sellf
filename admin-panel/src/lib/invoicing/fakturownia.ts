/** Fakturownia documented JSON adapter. @see https://github.com/fakturownia/API */
import { z } from 'zod';
import type { InvoiceInput, InvoiceParty, InvoiceProvider, IssueResult } from '@/lib/invoicing/provider';

export const domainSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.fakturownia\.pl$/);
const responseSchema = z.object({ id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]), number: z.string().min(1), token: z.string().regex(/^[a-zA-Z0-9_-]+$/), oid: z.string().nullish(), status: z.string().optional() });
function partyFields(prefix: string, party: InvoiceParty): Record<string, unknown> {
  return Object.fromEntries(Object.entries({ name: party.name, tax_no: party.nip, street: party.street, city: party.city, post_code: party.postalCode, country: party.country, email: party.email, company: party.company }).filter(([, v]) => v !== undefined).map(([k, v]) => [`${prefix}${k}`, v]));
}
const EXEMPTION_CHOICES: Record<string, string> = {
  '113': 'Zwolnienie ze względu na nieprzekroczenie limitu obrotu (art. 113 ust 1 i 9 ustawy o VAT)',
  '43': 'Zwolnienie ze względu na rodzaj prowadzonej działalności (art. 43 ust 1 ustawy o VAT)',
  '82': 'Zwolnienie na mocy rozporządzenia MF (art. 82 ust 3 ustawy o VAT)',
};
export function mapInvoice(input: InvoiceInput): Record<string, unknown> {
  const article = input.exemption?.match(/art\.?\s*(113|43|82)\b/i)?.[1];
  return {
    kind: 'vat', oid: input.externalKey, oid_unique: 'yes', currency: input.currency,
    issue_date: input.issuedAt, sell_date: input.issuedAt,
    ...partyFields('seller_', input.seller), ...partyFields('buyer_', input.buyer),
    ...(input.recipient && { recipients: [partyFields('', input.recipient)] }),
    status: input.paidAt ? 'paid' : 'issued', payment_type: input.paidAt ? 'card' : 'transfer',
    ...(input.paidAt ? { paid_date: input.paidAt } : { payment_to: input.dueAt, payment_to_kind: 'other_date' }),
    ...(input.lines.some(l => l.tax === 'zw') && { exempt_tax_kind: article ? EXEMPTION_CHOICES[article] : input.exemption, description: input.exemption }),
    positions: input.lines.map(l => ({ name: l.name, quantity: l.quantity, tax: l.tax, [l.net ? 'total_price_net' : 'total_price_gross']: l.total })),
  };
}
export class FakturowniaProvider implements InvoiceProvider {
  readonly id = 'fakturownia';
  constructor(private domain: string, private token: string, private fetcher: typeof fetch = fetch) {}
  private async request(path: string, invoice?: Record<string, unknown>, method = 'POST'): Promise<{ data?: unknown; error?: string }> {
    if (!domainSchema.safeParse(this.domain).success) return { error: 'Invalid Fakturownia domain' };
    try {
      const url = new URL(`https://${this.domain}${path}`);
      if (!invoice) url.searchParams.set('api_token', this.token);
      const response = await this.fetcher(url.toString(), {
        method: invoice ? method : 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(invoice && { body: JSON.stringify({ api_token: this.token, invoice }) }),
      });
      return response.ok ? { data: await response.json() } : { error: `Fakturownia HTTP ${response.status}` };
    } catch { return { error: 'Fakturownia request failed' }; }
  }
  private result(response: { data?: unknown; error?: string }): IssueResult {
    const parsed = responseSchema.safeParse(response.data);
    if (!parsed.success) return { success: false, error: response.error ?? 'Invalid Fakturownia response' };
    return { success: true, paid: parsed.data.status === 'paid', id: String(parsed.data.id), number: parsed.data.number, viewUrl: `https://${this.domain}/invoice/${parsed.data.token}` };
  }
  async issue(input: InvoiceInput): Promise<IssueResult> { return this.result(await this.request('/invoices.json', mapInvoice(input))); }
  async findByExternalKey(key: string): Promise<IssueResult | null> {
    const response = await this.request(`/invoices.json?period=all&oid=${encodeURIComponent(key)}&per_page=100`);
    if (!Array.isArray(response.data)) return this.result(response);
    const match = response.data.find(item => item?.oid === key);
    return match ? this.result({ data: match }) : null;
  }
  async markPaid(ref: string, date: string): Promise<IssueResult> {
    if (!/^\d+$/.test(ref)) return { success: false, error: 'Invalid invoice reference' };
    return this.result(await this.request(`/invoices/${ref}.json`, { status: 'paid', paid_date: date }, 'PUT'));
  }
}
