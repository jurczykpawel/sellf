/** Monetary projection for order webhooks; all monetary fields are minor units. @see bank-transfer-service.ts */
import { toMinorUnits } from '@/lib/currency/minor-units';

export function orderMoney(tx: { amount: number; currency: string; net_total: number | null; tax_total: number | null; tax_snapshot_status: string }) {
  return { amount: tx.amount, currency: tx.currency, grossTotal: tx.amount, netTotal: tx.net_total, taxTotal: tx.tax_total, taxSnapshotStatus: tx.tax_snapshot_status };
}
export function minorOrderLines<T extends { currency: string; unit_price: number; total_price: number; discounted_total: number | null; net_amount: number | null; tax_amount: number | null }>(lines: T[]) {
  return lines.map(line => ({ ...line, unit_price: toMinorUnits(line.unit_price, line.currency), total_price: toMinorUnits(line.total_price, line.currency),
    discounted_total: line.discounted_total === null ? null : toMinorUnits(line.discounted_total, line.currency),
    gross_amount: line.net_amount === null || line.tax_amount === null ? null : line.net_amount + line.tax_amount }));
}
