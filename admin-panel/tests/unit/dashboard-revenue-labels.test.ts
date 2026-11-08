import { expect, it } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import { convertCurrencyArray } from '@/lib/utils/currency-conversion';

it.each([en, pl])('describes the period, product scope and currency presentation', (messages) => {
  const dashboard = messages.admin.dashboard.stats;
  const payments = messages.admin.payments.stats;
  expect(dashboard.revenueScope).toContain('{scope}');
  expect(dashboard.selectedProduct).toBeTruthy();
  expect(dashboard.allProducts).toBeTruthy();
  expect(payments.revenueScope).not.toContain('{scope}');
  expect(dashboard.convertedTo).toBe(payments.convertedTo);
  expect(dashboard.originalCurrencies).toBe(payments.originalCurrencies);
});

it('uses the shared converter for the same grouped revenue in both summaries', () => {
  const grouped = { PLN: 350800, USD: 72500 };
  const [dashboard, payments] = convertCurrencyArray([grouped, grouped], 'USD', { base: 'USD', rates: { PLN: 4, USD: 1 } });
  expect(dashboard).toBe(160200);
  expect(payments).toBe(dashboard);
});

it('labels retained gross revenue after refunds in both languages', () => {
  expect(en.admin.dashboard.stats.revenueScope).toContain('less refunds');
  expect(en.admin.payments.stats.revenueScope).toContain('less refunds');
  expect(pl.admin.dashboard.stats.revenueScope).toContain('po zwrotach');
  expect(pl.admin.payments.stats.revenueScope).toContain('po zwrotach');
});
