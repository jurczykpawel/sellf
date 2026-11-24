// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import EmbedSnippetModal from '@/components/EmbedSnippetModal';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { Product } from '@/types';
vi.mock('@/components/ui/BaseModal', () => ({ default: ({ children }: { children: unknown }) => children }));
afterEach(cleanup);
it.each([['pl', pl], ['en', en]] as const)('replaces code with a profile-settings link in %s', (locale, messages) => {
  const product = { id: 'product', slug: 'course', price: 10, embed_enabled: true, checkout_profile: { v: 1, modules: [{ id: 'quantity', min: 2, max: 3, mode: 'checkout' }] } } as Product;
  render(createElement(NextIntlClientProvider, { locale, messages, children: createElement(EmbedSnippetModal, { isOpen: true, onClose() {}, product }) }));
  expect(screen.getByRole('link', { name: messages.embedSnippet.profileSettings }).getAttribute('href')).toBe(`/${locale}/dashboard/products?open=product&section=cart`);
  expect(screen.queryByText(messages.embedSnippet.copyCode)).toBeNull();
  expect(document.querySelector('code')).toBeNull();
});
