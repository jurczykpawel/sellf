// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it } from 'vitest';
import LocaleLink from '@/components/ui/LocaleLink';
import { localizedPath } from '@/lib/navigation/locale-path';

afterEach(cleanup);
const inLocale = (locale: string, href: string) => render(createElement(NextIntlClientProvider, { locale, messages: {} }, createElement(LocaleLink, { href }, 'link')));

it.each([
  ['pl', '/my-purchases', '/pl/my-purchases'],
  ['pl', '/', '/pl'],
  ['pl', '/p/kurs?x=1#a', '/pl/p/kurs?x=1#a'],
  ['en', '/my-purchases', '/my-purchases'],
  ['en', '/', '/'],
  ['pl', '/pl/my-products', '/pl/my-products'],
  ['pl', 'https://example.com/a', 'https://example.com/a'],
])('keeps the active locale in %s %s (GitHub #73 AC01)', (locale, href, expected) => {
  expect(localizedPath(locale, href)).toBe(expected);
});

it('renders a locale-preserving anchor', () => {
  inLocale('pl', '/my-products');
  expect(screen.getByRole('link', { name: 'link' }).getAttribute('href')).toBe('/pl/my-products');
  cleanup();
  inLocale('en', '/my-products');
  expect(screen.getByRole('link', { name: 'link' }).getAttribute('href')).toBe('/my-products');
});
