// @vitest-environment happy-dom
/** Bounded asynchronous binding search retains selection through loading and retries. */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BindingPicker from '@/components/storefront-editor/BindingPicker';
import en from '@/messages/en.json';
const m = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: m }));
vi.mock('@/lib/actions/categories', () => ({ getCategories: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const product = (id: string, name: string) => ({ id, name, price: 49, currency: 'PLN', is_active: true });
const page = (id: string, name: string) => ({ data: [product(id, name)], pagination: { has_more: false } });
function setup(selectedIds: string[] = [], onChange = vi.fn()) {
  return render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(BindingPicker, { label: 'Offers', kind: 'products', selectedIds, maxItems: 3, onChange })));
}
it('ignores an earlier search response after a later name search completes', async () => {
  let finishEarlier: (value: ReturnType<typeof page>) => void = () => {};
  m.list.mockImplementation((_resource: string, params: { search: string }) => params.search === 'Earlier' ? new Promise(resolve => { finishEarlier = resolve; }) : Promise.resolve(page('latest', params.search || 'Initial')));
  const view = setup();
  await waitFor(() => expect(view.getByRole('button', { name: 'Add Initial' })).toBeTruthy());
  fireEvent.change(view.getByRole('searchbox'), { target: { value: 'Earlier' } });
  await waitFor(() => expect(m.list).toHaveBeenCalledWith('products', expect.objectContaining({ search: 'Earlier', limit: 12 })));
  fireEvent.change(view.getByRole('searchbox'), { target: { value: 'Latest' } });
  await waitFor(() => expect(view.getByRole('button', { name: 'Add Latest' })).toBeTruthy());
  await act(async () => { finishEarlier(page('earlier', 'Earlier')); });
  expect(view.getByRole('button', { name: 'Add Latest' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Add Earlier' })).toBeNull();
});
it('retains an unresolved selection and retries a failed search without dropping its ID', async () => {
  m.get.mockRejectedValue(Error('Not found'));
  m.list.mockRejectedValueOnce(Error('Unavailable')).mockResolvedValue(page('new', 'New offer'));
  const changed = vi.fn(); const view = setup(['saved-reference'], changed);
  fireEvent.focus(view.getByRole('searchbox'));
  await waitFor(() => expect(view.getByRole('button', { name: 'Retry' })).toBeTruthy());
  expect(view.getByText('Unavailable item')).toBeTruthy();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Add New offer' })).toBeTruthy());
  fireEvent.click(view.getByRole('button', { name: 'Add New offer' }));
  expect(changed).toHaveBeenCalledWith(['saved-reference', 'new']);
});
it('can reach later matching offers through bounded search pages', async () => {
  m.list.mockResolvedValueOnce({ ...page('first', 'First offer'), pagination: { has_more: true, next_cursor: 'next-page' } }).mockResolvedValueOnce(page('later', 'Later offer'));
  const changed = vi.fn(); const view = setup([], changed);
  await waitFor(() => expect(view.getByRole('button', { name: 'Show more results' })).toBeTruthy());
  fireEvent.click(view.getByRole('button', { name: 'Show more results' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Add Later offer' })).toBeTruthy());
  fireEvent.click(view.getByRole('button', { name: 'Add Later offer' }));
  expect(changed).toHaveBeenCalledWith(['later']);
  expect(m.list).toHaveBeenLastCalledWith('products', expect.objectContaining({ limit: 12, cursor: 'next-page' }));
});
