/** Pure payout CSV v1 bytes; callers authorize and project reserved payouts before export.
 * @see ../model.ts @see tests/unit/affiliates/csv/formatter.test.ts
 */
import { z } from 'zod';
import { currencySchema, minorSchema, signedMinorSchema, versionSchema } from '@/lib/affiliates/model';
import type { AffiliateResult } from '@/lib/affiliates/model';

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
}).refine(row => BigInt(row.payable_minor) > BigInt(0)
  && BigInt(row.earnings_minor) - BigInt(row.debt_offset_minor) === BigInt(row.payable_minor));

function textCell(value: string): string {
  const leading = value.match(/^[\s\p{Cc}\p{Cf}]*/u)?.[0] ?? '';
  const literal = /[\t\r\n]/.test(leading) || /^[=+\-@]/.test(value.slice(leading.length));
  const text = literal ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Pages contain at most 100 explicit projections, ordered by payout_id across pages.
 * Each page is validated and sorted before emission; duplicates/backward IDs stop the stream.
 * Consume failures as an aborted download, never as a completed CSV. Auth, reservation,
 * threshold/review checks, audit and response headers belong to the calling payout service.
 */
export async function* streamPayoutCsv(
  pages: Iterable<unknown> | AsyncIterable<unknown>,
): AsyncGenerator<AffiliateResult<Uint8Array>, void, unknown> {
  const encoder = new TextEncoder();
  yield { success: true, data: encoder.encode('\uFEFF' + columns.join(',') + '\r\n') };
  let previous = '';
  try {
    for await (const page of pages) {
      if (!Array.isArray(page) || page.length > 100) { yield { success: false, error: 'invalid_input' }; return; }
      const parsed = z.array(payoutSchema).safeParse(page);
      if (!parsed.success) { yield { success: false, error: 'invalid_input' }; return; }
      const rows = parsed.data.sort((a, b) => a.payout_id < b.payout_id ? -1 : a.payout_id > b.payout_id ? 1 : 0);
      let last = previous;
      for (const row of rows) {
        if (row.payout_id <= last) { yield { success: false, error: 'invalid_input' }; return; }
        last = row.payout_id;
      }
      for (const row of rows) {
        const cells = ['sellf-affiliate-payouts/v1', row.payout_id, BigInt(row.version).toString(), textCell(row.affiliate_code),
          row.currency, BigInt(row.earnings_minor).toString(), BigInt(row.debt_offset_minor).toString(),
          BigInt(row.payable_minor).toString(), textCell(row.payee_reference)];
        yield { success: true, data: encoder.encode(cells.join(',') + '\r\n') };
      }
      previous = last;
    }
  } catch {
    yield { success: false, error: 'invalid_input' };
  }
}

const displayDecimals: Readonly<Record<string, number>> = { PLN: 2, EUR: 2, USD: 2, GBP: 2, JPY: 0 };

/** Static display only; CSV always retains canonical integer minor strings. */
export function formatMinorDisplay(minor: unknown, currency: unknown): AffiliateResult<string> {
  const amount = signedMinorSchema.safeParse(minor);
  const code = currencySchema.safeParse(currency);
  if (!amount.success || !code.success || !Object.hasOwn(displayDecimals, code.data)) return { success: false, error: 'invalid_input' };
  const decimals = displayDecimals[code.data];
  const negative = amount.data.startsWith('-');
  const digits = (negative ? amount.data.slice(1) : amount.data).padStart(decimals + 1, '0');
  return { success: true, data: (negative ? '-' : '') + (decimals === 0 ? digits : `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`) };
}
