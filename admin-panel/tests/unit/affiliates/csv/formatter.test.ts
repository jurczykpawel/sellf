/** Payout CSV v1 acceptance fixtures. @see src/lib/affiliates/csv/formatter.ts */
import { describe, expect, it } from 'vitest';
import { formatMinorDisplay, streamPayoutCsv } from '@/lib/affiliates/csv/formatter';

const header = 'format_version,payout_id,version,affiliate_code,currency,earnings_minor,debt_offset_minor,payable_minor,payee_reference\r\n';
const row = {
  payout_id: '11111111-1111-4111-8111-111111111111', version: '1', affiliate_code: 'anna',
  currency: 'PLN', earnings_minor: '15000', debt_offset_minor: '5000', payable_minor: '10000', payee_reference: 'payee-anna',
};
const second = { ...row, payout_id: '22222222-2222-4222-8222-222222222222' };
async function collect(pages: Iterable<unknown> | AsyncIterable<unknown>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const result of streamPayoutCsv(pages)) {
    if (!result.success) return 'invalid_input';
    chunks.push(result.data);
  }
  return Buffer.concat(chunks).toString('utf8');
}

describe('payout CSV v1', () => {
  it('matches the golden UTF-8 bytes and always emits a header', async () => {
    const expected = '\uFEFF' + header + 'sellf-affiliate-payouts/v1,11111111-1111-4111-8111-111111111111,1,anna,PLN,15000,5000,10000,payee-anna\r\n';
    expect(Buffer.from(await collect([[row]]))).toEqual(Buffer.from(expected));
    expect(await collect([])).toBe('\uFEFF' + header);
  });
  it('keeps large integers exact', async () => {
    expect(await collect([[{ ...row, version: '9223372036854775807', earnings_minor: '9223372036854775807', debt_offset_minor: '1', payable_minor: '9223372036854775806' }]]))
      .toContain(',9223372036854775807,anna,PLN,9223372036854775807,1,9223372036854775806,');
  });
  it('quotes Unicode, delimiters, quotes and line breaks', async () => {
    expect(await collect([[{ ...row, payee_reference: 'Łódź, "Żaneta"\r\nzażółć' }]]))
      .toContain(',"Łódź, ""Żaneta""\r\nzażółć"\r\n');
  });
  it.each(['=SUM(1)', '+1', '-1', '@name', '\tname', '\rname', '\nname', ' \u0000=1', '\u00a0+1', '  \tname'])('renders text prefixes as literal cells: %j', async value => {
    const csv = await collect([[{ ...row, affiliate_code: value, payee_reference: value }]]);
    const escaped = `'${value}`;
    const cell = /[",\r\n]/.test(escaped) ? `"${escaped.replaceAll('"', '""')}"` : escaped;
    expect(csv).toContain(`,${cell},PLN,`);
    expect(csv).toContain(`,${cell}\r\n`);
  });
  it.each([
    { earnings_minor: 15000 }, { earnings_minor: '01' }, { earnings_minor: '1e4' },
    { payable_minor: '=1' }, { debt_offset_minor: '-1' }, { payable_minor: '0' },
    { payable_minor: '10001' }, { version: '0' }, { currency: 'pln' },
    { earnings_minor: '9223372036854775808' }, { payee_reference: 'a'.repeat(201) },
    { payout_id: 'bad' }, { affiliate_code: '' },
  ])('rejects invalid projections: %j', async changes => {
    expect(await collect([[{ ...row, ...changes }]])).toBe('invalid_input');
  });
  it.each(['buyer_email', 'buyer_name', 'user_id', 'iban', 'stripe_payment_intent_id', 'license_key', 'bank_reference', 'invoice_reference'])('accepts only the explicit projection: %s', async field => {
    expect(await collect([[{ ...row, [field]: 'private-sentinel' }]])).toBe('invalid_input');
  });
  it('is deterministic within pages and across page boundaries', async () => {
    expect(await collect([[second, row]])).toBe(await collect([[row], [second]]));
    expect(await collect([[second], [row]])).toBe('invalid_input');
    expect(await collect([[row, row]])).toBe('invalid_input');
    expect(await collect([[row], [row]])).toBe('invalid_input');
  });
  it('bounds pages and reads lazily without pulling the next page', async () => {
    let reads = 0;
    async function* pages() { reads++; yield [row]; reads++; yield [second]; }
    const stream = streamPayoutCsv(pages());
    await stream.next();
    expect(reads).toBe(0);
    await stream.next();
    expect(reads).toBe(1);
    await stream.return();
    expect(reads).toBe(1);
    expect(await collect([Array(101).fill(row)])).toBe('invalid_input');
    expect(await collect([null])).toBe('invalid_input');
  });
  it('checks page bounds before reading rows', async () => {
    const page = Array(101).fill(row);
    let reads = 0;
    Object.defineProperty(page, 0, { get() { reads++; return row; } });
    expect(await collect([page])).toBe('invalid_input');
    expect(reads).toBe(0);
  });
  it('stops with a generic result when a source fails', async () => {
    async function* pages() { yield [row]; throw new Error('private-sentinel'); }
    expect(await collect(pages())).toBe('invalid_input');
  });
  it('accepts a full 100-row page', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ ...row, payout_id: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111` }));
    expect((await collect([rows])).split('\r\n')).toHaveLength(102);
  });
  it.each([
    ['12345', 'PLN', '123.45'], ['-1', 'EUR', '-0.01'], ['0', 'USD', '0.00'],
    ['12345', 'JPY', '12345'], ['9223372036854775807', 'GBP', '92233720368547758.07'],
    ['-9223372036854775808', 'PLN', '-92233720368547758.08'],
  ])('formats display without floating point: %s %s', (minor, currency, expected) => {
    expect(formatMinorDisplay(minor, currency)).toEqual({ success: true, data: expected });
  });
  it('does not infer display decimals for unknown currencies', () => {
    expect(formatMinorDisplay('100', 'XYZ')).toEqual({ success: false, error: 'invalid_input' });
    expect(formatMinorDisplay('1.5', 'PLN').success).toBe(false);
  });
});
