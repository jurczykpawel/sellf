/** Maps immutable order prices and checkout parties to an invoice. @see ./provider.ts */
import { readOrderDetails } from '@/lib/checkout-modules/order-details';
import { fromMinorUnits } from '@/lib/currency/minor-units';
import type { InvoiceInput, InvoiceParty } from '@/lib/invoicing/provider';

export interface InvoiceTransaction {
  order_number: number; status: string; customer_email: string | null; currency: string;
  created_at: string; updated_at: string; payment_due_at?: string | null; paid_at?: string | null;
  order_details: unknown; metadata: unknown;
}
export interface InvoiceLine {
  product_name: string | null; quantity: number; discounted_total: number | null; total_price: number;
  taxability_reason?: string | null; vat_rate: number | null; vat_exempt: boolean | null; tax_behavior: string | null;
  net_amount: number | null; tax_amount: number | null;
  session_starts_at?: string | null; session_label?: string | null; tier_label?: string | null;
}
export interface InvoiceShop {
  shop_name: string; company_legal_name?: string | null; nip?: string | null; country?: string | null;
  company_street?: string | null; company_building_no?: string | null; company_flat_no?: string | null;
  company_city?: string | null; company_postal?: string | null;
}
export function buildInvoiceInput(tx: InvoiceTransaction, rows: InvoiceLine[], shop: InvoiceShop, externalKey: string, exemption: string, template: string): InvoiceInput {
  const d = readOrderDetails(tx.order_details), b = d.buyer;
  const m = tx.metadata && typeof tx.metadata === 'object' && !Array.isArray(tx.metadata) ? tx.metadata as Record<string, unknown> : {};
  const buyer: InvoiceParty = {
    name: b?.company_name || [b?.first_name || m.first_name, b?.last_name || m.last_name].filter(Boolean).join(' ') || String(m.company_name || tx.customer_email || ''),
    nip: b?.nip || String(m.nip || ''), street: b?.address || String(m.address || ''), city: b?.city || String(m.city || ''),
    postalCode: b?.postal_code || String(m.postal_code || ''), country: b?.country || String(m.country || ''),
    email: b?.email || tx.customer_email || undefined, company: b?.type === 'organization' || Boolean(b?.nip || m.nip),
  };
  return {
    externalKey, currency: tx.currency.toUpperCase(), issuedAt: tx.created_at.slice(0, 10),
    ...(tx.status === 'completed' || tx.status === 'partially_refunded' ? { paidAt: (tx.paid_at || tx.updated_at).slice(0, 10) } : { dueAt: tx.payment_due_at?.slice(0, 10) }),
    seller: { name: shop.company_legal_name || shop.shop_name, nip: shop.nip || undefined, street: [shop.company_street, shop.company_building_no, shop.company_flat_no].filter(Boolean).join(' '), city: shop.company_city || undefined, postalCode: shop.company_postal || undefined, country: shop.country || undefined },
    buyer, ...(d.recipient?.differs && { recipient: { name: d.recipient.company_name || '', nip: d.recipient.nip, street: d.recipient.address, city: d.recipient.city, postalCode: d.recipient.postal_code, country: d.recipient.country, company: true } }), exemption,
    reverseCharge: rows.some(l => l.taxability_reason === 'reverse_charge'),
    lines: rows.map(l => {
      const name = template.replaceAll('{product}', l.product_name || 'Product').replaceAll('{date}', l.session_starts_at?.slice(0, 10) || '').replaceAll('{session}', l.session_label || '').replaceAll('{tier}', l.tier_label || '').replace(/\s+/g, ' ').trim();
      const net = l.tax_behavior === 'exclusive';
      const total = net && l.net_amount !== null ? fromMinorUnits(l.net_amount, tx.currency)
        : !net && l.net_amount !== null && l.tax_amount !== null ? fromMinorUnits(l.net_amount + l.tax_amount, tx.currency) : l.discounted_total ?? l.total_price;
      return { name, quantity: l.quantity, total, tax: l.taxability_reason === 'reverse_charge' ? 'np' : l.vat_exempt ? 'zw' : l.vat_rate ?? 0, net };
    }),
  };
}
