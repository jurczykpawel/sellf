// @vitest-environment happy-dom
/**
 * Regression: the product wizard is seeded from the list row, so a confirmed save must put the
 * saved row into the list before the wizard closes, and the wizard must not close mid-save.
 */
import React, { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
  default: ({ product, onSubmit, onClose }: { product: Product | null; onSubmit: (data: unknown) => Promise<void>; onClose: () => void }) =>
    createElement('div', { role: 'dialog' },
      createElement('output', null, JSON.stringify(product?.checkout_profile ?? null)),
      createElement('button', { onClick: onClose }, 'close'),
      createElement('button', { onClick: () => { void onSubmit({ name: product?.name, checkout_profile: SAVED_PROFILE }).catch(() => {}); } }, 'save')),
}));

const SAVED_PROFILE = { v: 1, modules: [{ id: 'phone', required: true }] };
const product = (checkout_profile: unknown) => ({ id: 'p1', name: 'Course', slug: 'course', price: 50, checkout_profile }) as unknown as Product;
const page = (rows: Product[]) => ({ data: rows, pagination: { has_more: false, next_cursor: null, total: rows.length } });
const profileShown = (view: ReturnType<typeof render>) => view.getByRole('dialog').querySelector('output')?.textContent;

beforeEach(() => { vi.stubGlobal('React', React); });
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('reopening while the post-save list refresh is still pending shows the saved values', async () => {
  mocks.list.mockResolvedValueOnce(page([product(null)])).mockImplementationOnce(() => new Promise(() => {}));
  mocks.update.mockResolvedValue(product(SAVED_PROFILE));

  const view = render(createElement(ProductsPageContent));
  await act(async () => {});
  fireEvent.click(view.getByRole('button', { name: 'edit p1' }));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });

  expect(view.queryByRole('dialog')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'edit p1' }));
  expect(profileShown(view)).toBe(JSON.stringify(SAVED_PROFILE));
});

it('ignores a close request while the save is in flight, then closes the wizard that saved', async () => {
  let resolveSave!: (value: Product) => void;
  mocks.list.mockResolvedValue(page([product(null)]));
  mocks.update.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));

  const view = render(createElement(ProductsPageContent));
  await act(async () => {});
  fireEvent.click(view.getByRole('button', { name: 'edit p1' }));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  fireEvent.click(view.getByRole('button', { name: 'close' }));
  expect(view.queryByRole('dialog')).not.toBeNull();

  await act(async () => { resolveSave(product(SAVED_PROFILE)); });
  expect(view.queryByRole('dialog')).toBeNull();
});
