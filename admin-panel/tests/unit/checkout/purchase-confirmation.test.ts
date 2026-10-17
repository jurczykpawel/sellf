// @vitest-environment happy-dom
/** Completed purchases offer an explicit access path. @see app/[locale]/p/[slug]/payment-status/components/SuccessStatus.tsx */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import SuccessStatus from '@/app/[locale]/p/[slug]/payment-status/components/SuccessStatus';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
afterEach(cleanup);
it.each(['en', 'pl'] as const)('confirms the product and links to its content in %s', locale => {
  render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(SuccessStatus, {
    product: { id: 'course', name: 'Reporting course', slug: 'reporting', price: 49, currency: 'PLN' }, countdown: 5, windowDimensions: { width: 0, height: 0 },
  })));
  expect(screen.getByText(/Reporting course/)).toBeTruthy();
  expect(screen.getByRole('link', { name: locale === 'pl' ? 'Otwórz zakupiony produkt' : 'Open your purchase' }).getAttribute('href')).toBe(`/${locale}/p/reporting`);
  expect(screen.getByRole('link', { name: locale === 'pl' ? 'Moje produkty' : 'My products' }).getAttribute('href')).toBe(`/${locale}/my-products`);
});
