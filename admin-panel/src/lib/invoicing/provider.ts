/** Provider-neutral invoice contract. @see ./service.ts */
export interface InvoiceParty {
  name: string; nip?: string; street?: string; city?: string; postalCode?: string;
  country?: string; email?: string; company?: boolean;
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
