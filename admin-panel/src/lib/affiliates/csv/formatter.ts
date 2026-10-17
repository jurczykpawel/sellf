/** Pure payout CSV v1 bytes; callers authorize and project reserved payouts before export.
 * @see ../model.ts @see tests/unit/affiliates/csv/formatter.test.ts
 */
import { z } from 'zod';
import { currencySchema, minorSchema, signedMinorSchema, versionSchema } from '@/lib/affiliates/model';
import type { AffiliateResult } from '@/lib/affiliates/model';
import { currencyExponent } from '@/lib/currency/minor-units';

const columns = ['format_version', 'payout_id', 'version', 'affiliate_code', 'currency', 'earnings_minor', 'debt_offset_minor', 'payable_minor', 'payee_reference'];
const payoutSchema = z.strictObject({
  payout_id: z.uuid().transform(value => value.toLowerCase()),
  version: versionSchema,
  affiliate_code: z.string().min(1).max(40),
  currency: currencySchema,
  earnings_minor: minorSchema,
  debt_offset_minor: minorSchema,
  payable_minor: minorSchema,
  payee_reference: z.string().min(1).max(200),
});

function textCell(value: string): string {
  const leading = value.match(/^[\s\p{Cc}\p{Cf}]*/u)?.[0] ?? '';
  const literal = /[\t\r\n]/.test(leading) || /^[=+\-@]/.test(value.slice(leading.length));
  const text = literal ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One reserved payout produces one statement row. */
export function formatPayoutCsv(input: unknown): AffiliateResult<Uint8Array> {
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const row = parsed.data;
  if (BigInt(row.payable_minor) <= BigInt(0) || BigInt(row.earnings_minor) - BigInt(row.debt_offset_minor) !== BigInt(row.payable_minor)) return { success: false, error: 'invalid_input' };
  const cells = ['sellf-affiliate-payouts/v1', row.payout_id, BigInt(row.version).toString(), textCell(row.affiliate_code),
    row.currency, BigInt(row.earnings_minor).toString(), BigInt(row.debt_offset_minor).toString(),
    BigInt(row.payable_minor).toString(), textCell(row.payee_reference)];
  return { success: true, data: new TextEncoder().encode('\uFEFF' + columns.join(',') + '\r\n' + cells.join(',') + '\r\n') };
}

const displayCurrencies: ReadonlySet<string> = new Set(['PLN', 'EUR', 'USD', 'GBP', 'JPY', 'KRW']);

/** Static display only; CSV always retains canonical integer minor strings. */
export function formatMinorDisplay(minor: unknown, currency: unknown): AffiliateResult<string> {
  const amount = signedMinorSchema.safeParse(minor);
  const code = currencySchema.safeParse(currency);
  if (!amount.success || !code.success || !displayCurrencies.has(code.data)) return { success: false, error: 'invalid_input' };
  const decimals = currencyExponent(code.data);
  const negative = amount.data.startsWith('-');
  const digits = (negative ? amount.data.slice(1) : amount.data).padStart(decimals + 1, '0');
  return { success: true, data: (negative ? '-' : '') + (decimals === 0 ? digits : `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`) };
}
