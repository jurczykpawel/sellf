/** Local tax snapshots in minor units, using the saved order prices.
 * @see src/lib/services/checkout-line-items.ts
 */
import { toMinorUnits } from '@/lib/currency/minor-units';
import type { LineTaxSnapshot, OrderTaxSnapshot } from '@/lib/services/tax-snapshot';

interface LocalTaxLine {
  product_id: string | null;
  item_type: string;
  discounted_total: number | null;
  currency: string;
  vat_rate: number | null;
  tax_behavior: string | null;
  vat_exempt: boolean | null;
}
interface SavedTaxLine extends LocalTaxLine {
  net_amount: number | null;
  tax_amount: number | null;
}

export function snapshotFromRows(rows: SavedTaxLine[]): OrderTaxSnapshot {
  const lines: LineTaxSnapshot[] = rows.map(row => ({
    productId: row.product_id, isBump: row.item_type === 'order_bump',
    netAmount: row.net_amount, taxAmount: row.tax_amount,
    grossAmount: row.net_amount === null || row.tax_amount === null ? null : row.net_amount + row.tax_amount,
    vatRate: row.vat_rate, vatExempt: row.vat_exempt ?? false,
    taxBehavior: row.tax_behavior === 'inclusive' || row.tax_behavior === 'exclusive' ? row.tax_behavior : null,
    taxabilityReason: null, breakdown: [],
  }));
  return {
    currency: rows[0]?.currency ?? '', status: 'local', stripeTaxApplied: false,
    netTotal: lines.some(line => line.netAmount === null) ? null : lines.reduce((sum, line) => sum + line.netAmount!, 0),
    taxTotal: lines.some(line => line.taxAmount === null) ? null : lines.reduce((sum, line) => sum + line.taxAmount!, 0),
    lines,
  };
}

export function computeLocalOrderTax(rows: LocalTaxLine[]): OrderTaxSnapshot {
  return snapshotFromRows(rows.map(row => {
    const basis = toMinorUnits(row.discounted_total ?? 0, row.currency);
    const rate = row.vat_exempt ? 0 : row.vat_rate ?? 0;
    const tax = !row.tax_behavior ? 0 : Math.round(basis * rate / (row.tax_behavior === 'inclusive' ? 100 + rate : 100));
    return { ...row, net_amount: basis - (row.tax_behavior === 'inclusive' ? tax : 0), tax_amount: tax };
  }));
}
