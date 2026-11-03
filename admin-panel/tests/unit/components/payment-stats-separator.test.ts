// @vitest-environment happy-dom
/**
 * U81-1: in grouped-currency mode the " + " separator was the first text inside an
 * inline-block span, where browsers drop the leading space ("1000 JPY+ 7032,42 zł").
 * The separator must sit between the amount boxes, never inside one.
 * @see src/components/admin/PaymentStatsCards.tsx
 */
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PaymentStatsCards from '@/components/admin/PaymentStatsCards';

vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
vi.mock('@/contexts/UserPreferencesContext', () => ({ useUserPreferences: () => ({ currencyViewMode: 'grouped', displayCurrency: 'PLN' }) }));
vi.mock('@/hooks/useCurrencyConversion', () => ({ useCurrencyConversion: () => ({ convertMultipleCurrencies: vi.fn() }) }));
afterEach(cleanup);

it('keeps the plus separator outside the amount boxes', () => {
  const amounts = { JPY: 1000, PLN: 703242 };
  const { container } = render(createElement(PaymentStatsCards, { stats: { totalTransactions: 2, totalRevenue: amounts, pendingSessions: 0, refundedAmount: {}, todayRevenue: amounts, thisMonthRevenue: amounts } }));
  const boxes = [...container.querySelectorAll('span.inline-block')];
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) expect(box.textContent).not.toMatch(/^\s*\+/);
  const parent = boxes.find(b => b.textContent?.includes('JPY'))!.parentElement!;
  expect(parent.textContent).toMatch(/JPY \+ 7032,42\s?zł/);
});
