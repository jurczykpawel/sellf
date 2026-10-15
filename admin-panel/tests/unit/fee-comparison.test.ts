// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeeComparisonSection } from '@/app/[locale]/about/components/FeeComparisonSection';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({ locale: 'en' }));
vi.mock('next-intl', async (importOriginal) => ({
  ...await importOriginal<typeof import('next-intl')>(),
  useLocale: () => state.locale,
  useTranslations: () => createTranslator({
    locale: state.locale,
    messages: state.locale === 'pl' ? pl : en,
    namespace: 'landing',
  }),
}));
vi.mock('@/components/motion/Reveal', () => ({
  Reveal: ({ children }: { children: ReactNode }) => children,
}));
afterEach(cleanup);

describe('fee comparison', () => {
  it.each([
    ['en', 'USD', 10000, 1100, 600, 340, 20000],
    ['pl', 'PLN', 40000, 4400, 2400, 1360, 80000],
  ] as const)('shows base fees and recalculates savings in %s', (locale, currency, revenue, gumroad, mor, sellf, nextRevenue) => {
    state.locale = locale;
    const { container, getByRole } = render(createElement(FeeComparisonSection));
    const fmt = (amount: number) => new Intl.NumberFormat(locale === 'pl' ? 'pl-PL' : 'en-US', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(amount);
    const text = () => container.textContent;
    for (const amount of [revenue, gumroad, mor, sellf, (gumroad - sellf) * 12]) {
      expect(text()).toContain(fmt(amount));
    }
    fireEvent.change(getByRole('slider'), { target: { value: String(nextRevenue) } });
    for (const amount of [gumroad * 2, mor * 2, (gumroad - sellf) * 24]) {
      expect(text()).toContain(fmt(amount));
    }
    expect(text()).toContain('2026-10-15');
    for (const url of ['https://gumroad.com/pricing', 'https://www.paddle.com/pricing', 'https://www.lemonsqueezy.com/pricing']) {
      expect(container.querySelector(`a[href="${url}"]`)).not.toBeNull();
    }
  });
});
