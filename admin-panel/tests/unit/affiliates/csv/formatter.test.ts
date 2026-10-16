/** Payout CSV v1 acceptance fixtures. @see src/lib/affiliates/csv/formatter.ts */
import { describe, expect, it } from 'vitest';
import { formatMinorDisplay, formatPayoutCsv } from '@/lib/affiliates/csv/formatter';

const header = 'format_version,payout_id,version,affiliate_code,currency,earnings_minor,debt_offset_minor,payable_minor,payee_reference\r\n';
const row = {
  payout_id: '11111111-1111-4111-8111-111111111111', version: '1', affiliate_code: 'anna',
  currency: 'PLN', earnings_minor: '15000', debt_offset_minor: '5000', payable_minor: '10000', payee_reference: 'payee-anna',
};
async function collect(row: unknown): Promise<string> {
  const result = formatPayoutCsv(row);
  return result.success ? Buffer.from(result.data).toString('utf8') : 'invalid_input';
}

describe('payout CSV v1', () => {
  it('matches the golden UTF-8 bytes and always emits a header', async () => {
    const expected = '\uFEFF' + header + 'sellf-affiliate-payouts/v1,11111111-1111-4111-8111-111111111111,1,anna,PLN,15000,5000,10000,payee-anna\r\n';
    expect(Buffer.from(await collect(row))).toEqual(Buffer.from(expected));
  });
  it('keeps large integers exact', async () => {
    expect(await collect({ ...row, version: '9223372036854775807', earnings_minor: '9223372036854775807', debt_offset_minor: '1', payable_minor: '9223372036854775806' }))
      .toContain(',9223372036854775807,anna,PLN,9223372036854775807,1,9223372036854775806,');
  });
  it('quotes Unicode, delimiters, quotes and line breaks', async () => {
    expect(await collect({ ...row, payee_reference: 'Łódź, "Żaneta"\r\nzażółć' }))
      .toContain(',"Łódź, ""Żaneta""\r\nzażółć"\r\n');
  });
  it.each(['=SUM(1)', '+1', '-1', '@name', '\tname', '\rname', '\nname', ' \u0000=1', '\u00a0+1', '  \tname'])('renders text prefixes as literal cells: %j', async value => {
    const csv = await collect({ ...row, affiliate_code: value, payee_reference: value });
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
    expect(await collect({ ...row, ...changes })).toBe('invalid_input');
  });
  it.each(['buyer_email', 'buyer_name', 'user_id', 'iban', 'stripe_payment_intent_id', 'license_key', 'bank_reference', 'invoice_reference'])('accepts only the explicit projection: %s', async field => {
    expect(await collect({ ...row, [field]: 'private-sentinel' })).toBe('invalid_input');
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
