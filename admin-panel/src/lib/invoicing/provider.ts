/** Provider-neutral invoice contract. @see ./service.ts */
import type { TaxIdType } from '@/lib/validation/tax-id';
export interface InvoiceParty {
  name: string; nip?: string; street?: string; city?: string; postalCode?: string;
  country?: string; email?: string; company?: boolean;
  /** pl_nip | eu_vat | other — derived from the company country. @see ../validation/tax-id.ts */
  taxIdType?: TaxIdType;
}
export interface InvoiceInput {
  externalKey: string; currency: string; issuedAt: string; paidAt?: string; dueAt?: string;
  seller: InvoiceParty; buyer: InvoiceParty; recipient?: InvoiceParty; exemption?: string; reverseCharge?: boolean;
  lines: { name: string; quantity: number; total: number; tax: number | 'zw' | 'np'; net: boolean }[];
}
export interface IssueResult {
  success: boolean; paid?: boolean; id?: string; number?: string; viewUrl?: string; error?: string;
}
export interface InvoiceProvider {
  id: string;
  issue(input: InvoiceInput): Promise<IssueResult>;
  findByExternalKey(key: string): Promise<IssueResult | null>;
  markPaid?(ref: string, date: string): Promise<IssueResult>;
  downloadUrl?(ref: string): string;
}
