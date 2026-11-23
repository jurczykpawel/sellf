// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it } from 'vitest';
import ValidationIssues from '@/components/storefront-editor/ValidationIssues';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
afterEach(cleanup);
it.each([['en', en, 'active'], ['pl', pl, 'aktywny']] as const)('links the %s publication refusal to product sales settings', (locale, messages, word) => {
  render(createElement(NextIntlClientProvider, { locale, messages, children: createElement(ValidationIssues, {
    issues: [{ code: 'BINDING', path: '/productId', message: 'Make the product active and listed before publishing its offer' }], blocking: true,
    productId: '90000000-0000-4000-a000-000000000001',
  }) }));
  expect(screen.getByRole('alert').textContent).toContain(word);
  expect(screen.getByRole('link').getAttribute('href')).toBe(`${locale === 'pl' ? '/pl' : ''}/dashboard/products?open=90000000-0000-4000-a000-000000000001&section=sales`);
});
