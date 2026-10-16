/** Exact conversion for ordinary currency inputs. @see ../csv/formatter.ts */
import { formatMinorDisplay } from '@/lib/affiliates/csv/formatter';
import { signedMinorSchema } from '@/lib/affiliates/model';
export function parsePayoutAmount(value: string, currency: string): string | null {
  const sample = formatMinorDisplay('1', currency);
  if (!sample.success) return null;
  const decimals = sample.data.split('.')[1]?.length ?? 0;
  const match = value.trim().replace(',', '.').match(/^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match || (match[3]?.length ?? 0) > decimals) return null;
  const amount = BigInt(`${match[1]}${match[2]}${(match[3] ?? '').padEnd(decimals, '0')}`).toString();
  return signedMinorSchema.safeParse(amount).success ? amount : null;
}
