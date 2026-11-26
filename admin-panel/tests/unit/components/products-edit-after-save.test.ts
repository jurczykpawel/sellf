// @vitest-environment happy-dom
/**
 * Regression: the product wizard (edit and duplicate) starts from the stored product loaded by id,
 * never from the list-row copy, and must not close mid-save.
 */
import React, { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProductsPageContent from '@/components/ProductsPageContent';
import type { Product } from '@/types';

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn(), toastError: vi.fn() }));

vi.mock('next-intl', async (importOriginal) => {
  const { createNextIntlMock } = await import('@/../tests/mocks/next-intl');
  return createNextIntlMock(await importOriginal<typeof import('next-intl')>());
});
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError, warning: vi.fn() } }));
vi.mock('@/lib/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/client')>()),
  api: { list: mocks.list, get: mocks.get, update: mocks.update, deleteCustom: async () => undefined },
}));
vi.mock('@/components/FilterBar', () => ({
  default: ({ onAddProduct }: { onAddProduct: () => void }) => createElement('button', { onClick: onAddProduct }, 'add'),
}));
vi.mock('@/components/ProductsTable', () => ({
  default: ({ products, onEditProduct, onDuplicateProduct }: { products: Product[]; onEditProduct: (p: Product) => void; onDuplicateProduct: (p: Product) => void }) =>
    createElement('div', null, products.flatMap(p => [
      createElement('button', { key: `e${p.id}`, onClick: () => onEditProduct(p) }, `edit ${p.id}`),
      createElement('button', { key: `d${p.id}`, onClick: () => onDuplicateProduct(p) }, `duplicate ${p.id}`),
    ])),
}));
// The wizard submits the form it was seeded with, as the real one does (useProductForm sends all fields).
vi.mock('@/components/ProductFormModal/wizard/ProductCreationWizard', () => ({
  default: ({ product, onSubmit, onClose }: { product: Product | null; onSubmit: (data: unknown) => Promise<void>; onClose: () => void }) =>
    createElement('div', { role: 'dialog' },
      createElement('output', null, `${product?.name}|${JSON.stringify(product?.checkout_profile ?? null)}`),
      createElement('button', { onClick: onClose }, 'close'),
      createElement('button', { onClick: () => { void onSubmit({ ...product }).catch(() => {}); } }, 'save'),
      createElement('button', { onClick: () => { void onSubmit({ ...product }).catch(() => {}); void onSubmit({ ...product }).catch(() => {}); } }, 'save twice')),
}));

const SAVED_PROFILE = { v: 1, modules: [{ id: 'phone', required: true }] };
const product = (checkout_profile: unknown) => ({ id: 'p1', name: 'Course', slug: 'course', price: 50, checkout_profile }) as unknown as Product;
const page = (rows: Product[]) => ({ data: rows, pagination: { has_more: false, next_cursor: null, total: rows.length } });
const shown = (view: ReturnType<typeof render>) => view.getByRole('dialog').querySelector('output')?.textContent;

beforeEach(() => { vi.stubGlobal('React', React); });
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('edits the stored product even when the list still holds the pre-save row, and re-saves the stored values', async () => {
  let resolveGet!: (value: Product) => void;
  // The list keeps answering with the row from before the last save (slow GET that finished after PATCH/OTO).
  mocks.list.mockResolvedValue(page([product(null)]));
  mocks.get.mockImplementation(() => new Promise(resolve => { resolveGet = resolve; }));
  mocks.update.mockResolvedValue(product(SAVED_PROFILE));

  const view = render(createElement(ProductsPageContent));
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'edit p1' })); });
  expect(mocks.get).toHaveBeenCalledWith('products', 'p1');
  expect(view.queryByRole('dialog')).toBeNull();
  expect(view.getByText('loading')).toBeTruthy();

  await act(async () => { resolveGet(product(SAVED_PROFILE)); });
  expect(shown(view)).toBe(`Course|${JSON.stringify(SAVED_PROFILE)}`);
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  expect(mocks.update).toHaveBeenCalledWith('products', 'p1', expect.objectContaining({ checkout_profile: SAVED_PROFILE }));
});

it('duplicates from the stored product', async () => {
  mocks.list.mockResolvedValue(page([product(null)]));
  mocks.get.mockResolvedValue(product(SAVED_PROFILE));
  const view = render(createElement(ProductsPageContent));
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'duplicate p1' })); });
  expect(mocks.get).toHaveBeenCalledWith('products', 'p1');
  expect(shown(view)).toBe(`[COPY] Course|${JSON.stringify(SAVED_PROFILE)}`);
});

it('does not open the wizard from the list row when loading the product fails', async () => {
  mocks.list.mockResolvedValue(page([product(null)]));
  mocks.get.mockRejectedValue(new Error('offline'));
  const view = render(createElement(ProductsPageContent));
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'edit p1' })); });
  expect(view.queryByRole('dialog')).toBeNull();
  expect(view.queryByText('loading')).toBeNull();
  expect(mocks.toastError).toHaveBeenCalledWith('loadError');
});

it('ignores a close request while the save is in flight, then closes the wizard that saved', async () => {
  let resolveSave!: (value: Product) => void;
  mocks.list.mockResolvedValue(page([product(null)]));
  mocks.get.mockResolvedValue(product(null));
  mocks.update.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));

  const view = render(createElement(ProductsPageContent));
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'edit p1' })); });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  fireEvent.click(view.getByRole('button', { name: 'close' }));
  expect(view.queryByRole('dialog')).not.toBeNull();

  await act(async () => { resolveSave(product(SAVED_PROFILE)); });
  expect(view.queryByRole('dialog')).toBeNull();
});

it('opening Add while a product loads discards that load', async () => {
  let resolveGet!: (value: Product) => void;
  mocks.list.mockResolvedValue(page([product(null)]));
  mocks.get.mockImplementation(() => new Promise(resolve => { resolveGet = resolve; }));
  const view = render(createElement(ProductsPageContent));
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'edit p1' })); });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'add' })); });
  expect(view.queryByText('loading')).toBeNull();
  expect(shown(view)).toBe('undefined|null');
  await act(async () => { resolveGet(product(SAVED_PROFILE)); });
  expect(shown(view)).toBe('undefined|null');
});

it('the loading layer keeps keyboard focus on itself', async () => {
  mocks.list.mockResolvedValue(page([product(null)]));
  mocks.get.mockImplementation(() => new Promise(() => {}));
  const view = render(createElement(ProductsPageContent));
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'edit p1' })); });
  const cancel = view.getByRole('button', { name: 'cancel' });
  expect(document.activeElement).toBe(cancel);
  expect(fireEvent.keyDown(cancel, { key: 'Tab' })).toBe(false);
  expect(fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })).toBe(false);
});

it('two save clicks before a re-render save once', async () => {
  mocks.list.mockResolvedValue(page([product(null)]));
  mocks.get.mockResolvedValue(product(null));
  mocks.update.mockImplementation(() => new Promise(() => {}));
  const view = render(createElement(ProductsPageContent));
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'edit p1' })); });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save twice' })); });
  expect(mocks.update).toHaveBeenCalledTimes(1);
});
