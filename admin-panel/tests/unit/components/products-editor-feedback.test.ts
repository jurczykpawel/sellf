// @vitest-environment happy-dom
/**
 * Products page feedback in the panel language: a failed editor load, a refused save of an
 * archived bundle or product, and where focus and the URL end up when an editor opened from a
 * link (`?open=<id>`) closes.
 *
 * @see src/components/ProductsPageContent.tsx
 */
import React, { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import ProductsPageContent from '@/components/ProductsPageContent';
import { ApiError } from '@/lib/api/client';
import type { Product } from '@/types';

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn(), toastError: vi.fn(), params: new URLSearchParams(), listed: true }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.params,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError, warning: vi.fn() } }));
vi.mock('@/lib/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/client')>()),
  api: { list: mocks.list, get: mocks.get, update: mocks.update, deleteCustom: async () => undefined },
}));
vi.mock('@/components/FilterBar', () => ({ default: () => null }));
vi.mock('@/components/ProductsTable', () => ({
  default: ({ products }: { products: Product[] }) => createElement('div', null,
    mocks.listed ? products.map(p => createElement('button', { key: p.id, id: `product-edit-${p.id}` }, `edit ${p.id}`)) : null),
}));
vi.mock('@/components/ProductFormModal/wizard/ProductCreationWizard', () => ({
  default: ({ product, onSubmit, onClose }: { product: Product | null; onSubmit: (data: unknown) => Promise<void>; onClose: () => void }) =>
    createElement('div', { role: 'dialog' },
      createElement('button', { onClick: onClose }, 'close'),
      createElement('button', { onClick: () => { void onSubmit({ ...product }).catch(() => {}); } }, 'save')),
}));

const product = { id: 'p1', name: 'Course', slug: 'course', price: 50 } as unknown as Product;
const page = { data: [product], pagination: { has_more: false, next_cursor: null, total: 1 } };
const messages = { en, pl } as const;
const show = (locale: 'en' | 'pl') => render(createElement(NextIntlClientProvider, { locale, messages: messages[locale] as never, onError: () => {} },
  createElement(ProductsPageContent)));

beforeEach(() => {
  vi.stubGlobal('React', React);
  mocks.params = new URLSearchParams();
  mocks.listed = true;
  mocks.list.mockResolvedValue(page);
  window.history.replaceState(null, '', '/pl/dashboard/products');
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it.each([
  ['pl', 'Nie udało się wczytać produktu. Spróbuj ponownie.'],
  ['en', 'Could not load the product. Try again.'],
] as const)('a product that cannot be loaded is reported in %s, not as a message key', async (locale, text) => {
  mocks.params = new URLSearchParams('open=00000000-0000-4000-8000-000000000000');
  mocks.get.mockRejectedValue(new ApiError('NOT_FOUND', 'Product not found', 404));
  show(locale);
  await act(async () => {});
  expect(mocks.toastError).toHaveBeenCalledWith(text);
});

it.each([
  ['pl', 'bundle_archived', 'Ten pakiet jest w archiwum. Przywróć go, zanim zmienisz jego skład.'],
  ['en', 'bundle_archived', 'This bundle is in the archive. Restore it before changing its contents.'],
  ['pl', 'product_archived', 'Ten produkt jest w archiwum. Przywróć go, zanim go aktywujesz.'],
  ['en', 'product_archived', 'This product is in the archive. Restore it before activating it.'],
] as const)('a refused save (%s, %s) is worded in the panel language', async (locale, code, text) => {
  mocks.get.mockResolvedValue(product);
  mocks.update.mockRejectedValue(new ApiError('CONFLICT', 'Restore it from the archive first', 409, { code: [code] }));
  mocks.params = new URLSearchParams('open=p1');
  const view = show(locale);
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  expect(mocks.toastError).toHaveBeenCalledWith(text);
  expect(view.queryByRole('dialog')).not.toBeNull();
});

it('closing an editor opened from a link removes ?open= from the URL and focuses that product row', async () => {
  mocks.get.mockResolvedValue(product);
  mocks.params = new URLSearchParams('open=p1&page=2');
  window.history.replaceState(null, '', '/pl/dashboard/products?open=p1&page=2');
  const length = window.history.length;
  const view = show('pl');
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'close' })); });
  expect(view.queryByRole('dialog')).toBeNull();
  expect(window.location.pathname + window.location.search).toBe('/pl/dashboard/products?page=2');
  expect(window.history.length).toBe(length);
  expect(document.activeElement).toBe(document.getElementById('product-edit-p1'));
});

it('when that product is not on the list, focus goes to the page heading', async () => {
  mocks.listed = false;
  mocks.get.mockResolvedValue(product);
  mocks.params = new URLSearchParams('open=p1');
  window.history.replaceState(null, '', '/pl/dashboard/products?open=p1');
  const view = show('pl');
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'close' })); });
  expect(document.activeElement).toBe(view.getByRole('heading', { level: 1 }));
});
