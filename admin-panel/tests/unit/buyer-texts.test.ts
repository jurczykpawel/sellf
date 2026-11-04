// @vitest-environment happy-dom
import { createElement } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import TransferInstructions from '@/components/checkout/TransferInstructions';
import pl from '@/messages/pl.json';
afterEach(cleanup);
it('uses sentence case and consistent refund wording', () => {
  expect(pl.notFound.guestTitle).toBe('Strona nie znaleziona');
  expect(pl.refundRequests.title).toBe('Wnioski o zwrot');
});
it('formats the account and uses matching labels', () => {
  render(createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, createElement(TransferInstructions, { transfer: { account: 'PL61109010140000071219812874' }, amount: 12300, currency: 'PLN' })));
  expect(screen.getByText('PL61 1090 1014 0000 0712 1981 2874')).toBeTruthy();
  expect(screen.getByText('Kwota').className).toBe(screen.getByText('Termin płatności').className);
});
it('provides a localized checkout index 404', async () => {
  const { default: CheckoutIndex } = await import('@/app/[locale]/checkout/page');
  expect(() => CheckoutIndex()).toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
});
it('translates verification using a stable code', () => {
  const source = readFileSync('src/app/[locale]/p/[slug]/payment-status/page.tsx', 'utf8');
  expect(source).toContain('result.error_code');
  expect(readFileSync('src/app/[locale]/p/[slug]/payment-status/components/MagicLinkStatus.tsx', 'utf8')).not.toContain('Processing verification...');
});

it('hides transfer instructions for a completed order', () => {
  render(createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, createElement(TransferInstructions, { transfer: { account: 'PL61109010140000071219812874' }, amount: 12300, currency: 'PLN', paid: true })));
  expect(screen.getByText('Zamówienie opłacone')).toBeTruthy();
  expect(screen.queryByText('Dane do przelewu')).toBeNull();
});
it('free product CTA does not repeat a word (W146 B11)', async () => {
  const en = (await import('@/messages/en.json')).default as Record<string, Record<string, unknown>>;
  const repeated: string[] = [];
  const walk = (o: unknown, path: string): void => { if (typeof o === 'string') { if (/\b([a-z]{3,}) \1\b/i.test(o)) repeated.push(path); } else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`); };
  walk(en, 'en');
  expect(repeated).toEqual([]);
});
