// @vitest-environment happy-dom
import { createElement, useState } from 'react';
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProductsTable from '@/components/ProductsTable';
import BaseModal from '@/components/ui/BaseModal';
import { initialFormData } from '@/components/ProductFormModal/types';
import type { Product } from '@/types';
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
afterEach(cleanup);
function Harness({ loading = false, hasProduct = true }: { loading?: boolean; hasProduct?: boolean }) {
  const [open, setOpen] = useState(false);
  const action = () => setOpen(true);
  const props: ComponentProps<typeof ProductsTable> = {
    products: hasProduct ? [{ ...initialFormData, id: 'row', name: 'Product', slug: 'product' } as Product] : [], loading, error: null,
    productPath: slug => `/p/${slug}`, checkoutPath: slug => `/checkout/${slug}`,
    onEditProduct: action, onDuplicateProduct: action, onDeleteProduct: action, onRestoreProduct: action,
    onPreviewProduct: action, onPreviewRedirect: action, onGenerateEmbedSnippet: action, onGenerateLoginwallSnippet: action,
    onGenerateGatingSnippet: action, onToggleStatus: action, onToggleFeatured: action, onToggleListed: action,
    currentPage: 1, totalPages: 1, totalItems: 1, onPageChange: vi.fn(), limit: 20, sortBy: 'name', sortOrder: 'asc', onSort: vi.fn(),
  };
  return createElement('div', null, createElement('input', { 'aria-label': 'Search' }), createElement(ProductsTable, props), open && createElement(BaseModal, { isOpen: true, onClose: () => setOpen(false) }, 'Details'));
}

it.each([false, true])('returns from an action dialog to its row menu button (refresh=%s)', refresh => {
  const view = render(createElement(Harness));
  const trigger = screen.getByRole('button', { name: 'moreActions' });
  fireEvent.click(trigger);
  const item = screen.getByRole('button', { name: 'duplicate' });
  item.focus(); fireEvent.click(item);
  expect(screen.getByRole('dialog')).toBeTruthy();
  if (refresh) {
    view.rerender(createElement(Harness, { hasProduct: false }));
    expect(trigger.isConnected).toBe(false);
    view.rerender(createElement(Harness));
  }
  const liveTrigger = screen.getByRole('button', { name: 'moreActions' });
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(liveTrigger);
});

it.each(['before', 'during'] as const)('Escape returns focus to its row across a refresh (pressed %s)', when => {
  const view = render(createElement(Harness));
  const trigger = screen.getByRole('button', { name: 'moreActions' });
  fireEvent.click(trigger);
  screen.getByRole('button', { name: 'duplicate' }).focus();

  if (when === 'during') view.rerender(createElement(Harness, { loading: true }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  if (when === 'before') view.rerender(createElement(Harness, { loading: true }));
  view.rerender(createElement(Harness));

  const liveTrigger = screen.getByRole('button', { name: 'moreActions' });
  expect(liveTrigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(liveTrigger);
});

it.each(['trigger', 'item', 'search'] as const)('closes a vanished row menu with focus on %s', focused => {
  const view = render(createElement(Harness));
  const trigger = screen.getByRole('button', { name: 'moreActions' });
  fireEvent.click(trigger);
  const search = screen.getByRole('textbox', { name: 'Search' });
  const active = focused === 'trigger' ? trigger
    : focused === 'item' ? screen.getByRole('button', { name: 'duplicate' }) : search;
  active.focus();

  view.rerender(createElement(Harness, { hasProduct: false }));
  expect(screen.queryByRole('button', { name: 'duplicate' })).toBeNull();
  expect(document.activeElement).toBe(focused === 'search' ? search : screen.getByRole('region', { name: 'title' }));

  view.rerender(createElement(Harness));
  expect(screen.getByRole('button', { name: 'moreActions' }).getAttribute('aria-expanded')).toBe('false');
});

it('dims retained product results only while refreshing', () => {
  const view = render(createElement(Harness));
  const row = screen.getByRole('row', { name: /Product/ });
  const busy = row.closest('[aria-busy]');
  expect(busy?.classList.contains('opacity-50')).toBe(false);

  view.rerender(createElement(Harness, { loading: true }));
  expect(screen.getByRole('row', { name: /Product/ })).toBe(row);
  expect(busy?.getAttribute('aria-busy')).toBe('true');
  expect(busy?.classList.contains('opacity-50')).toBe(true);

  view.rerender(createElement(Harness));
  expect(busy?.getAttribute('aria-busy')).toBe('false');
  expect(busy?.classList.contains('opacity-50')).toBe(false);
});
