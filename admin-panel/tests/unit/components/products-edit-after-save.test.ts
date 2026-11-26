// @vitest-environment happy-dom
/**
 * Regression: reopening a product right after saving it must show the saved values,
 * not the row the list held before the save (the wizard is seeded from the list row).
 */
import React, { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProductsPageContent from '@/components/ProductsPageContent';
import type { Product } from '@/types';

const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }));

vi.mock('next-intl', async (importOriginal) => {
  const { createNextIntlMock } = await import('@/../tests/mocks/next-intl');
  return createNextIntlMock(await importOriginal<typeof import('next-intl')>());
});
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/client')>()),
  api: { list: mocks.list, update: mocks.update, deleteCustom: async () => undefined },
}));
vi.mock('@/components/FilterBar', () => ({ default: () => null }));
vi.mock('@/components/ProductsTable', () => ({
  default: ({ products, onEditProduct }: { products: Product[]; onEditProduct: (p: Product) => void }) =>
    createElement('div', null, products.map(p => createElement('button', { key: p.id, onClick: () => onEditProduct(p) }, `edit ${p.id}`))),
}));
vi.mock('@/components/ProductFormModal/wizard/ProductCreationWizard', () => ({
  default: ({ product, onSubmit }: { product: Product | null; onSubmit: (data: unknown) => Promise<void> }) =>
    createElement('div', { role: 'dialog' },
      createElement('output', null, JSON.stringify(product?.checkout_profile ?? null)),
      createElement('button', { onClick: () => { void onSubmit({ name: product?.name, checkout_profile: SAVED_PROFILE }).catch(() => {}); } }, 'save')),
}));

const SAVED_PROFILE = { v: 1, modules: [{ id: 'phone', required: true }] };
const product = (checkout_profile: unknown) => ({ id: 'p1', name: 'Course', slug: 'course', price: 50, checkout_profile }) as unknown as Product;
const page = (rows: Product[]) => ({ data: rows, pagination: { has_more: false, next_cursor: null, total: rows.length } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('keeps the wizard open until the refreshed list arrives, so a reopen shows the saved values', async () => {
  vi.stubGlobal('React', React);
  let resolveRefresh!: (value: ReturnType<typeof page>) => void;
  mocks.list
    .mockResolvedValueOnce(page([product(null)]))
    .mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
  mocks.update.mockResolvedValue(product(SAVED_PROFILE));

  const view = render(createElement(ProductsPageContent));
  await act(async () => {});
  fireEvent.click(view.getByRole('button', { name: 'edit p1' }));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });

  expect(mocks.update).toHaveBeenCalledTimes(1);
  // The list still holds the pre-save row: closing now would let a reopen seed the form from it.
  expect(view.queryByRole('dialog')).not.toBeNull();

  await act(async () => { resolveRefresh(page([product(SAVED_PROFILE)])); });
  expect(view.queryByRole('dialog')).toBeNull();

  fireEvent.click(view.getByRole('button', { name: 'edit p1' }));
  expect(view.getByRole('dialog').querySelector('output')?.textContent).toBe(JSON.stringify(SAVED_PROFILE));
});
