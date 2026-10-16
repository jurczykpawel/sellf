// @vitest-environment happy-dom
/** Shared ordered selection controls for bundles and storefront bindings. */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import OrderedItemPicker from '@/components/ui/OrderedItemPicker';
import en from '@/messages/en.json';
afterEach(cleanup);
it('searches by name, adds once, retains unresolved entries and reorders from one handle', () => {
  let ids = ['missing', 'a'];
  const items = [{ id: 'a', name: 'Workshop', detail: '49 PLN', image: '/workshop.png' }, { id: 'b', name: 'Course', detail: '99 PLN' }];
  const props = () => ({ label: 'Offers', items, selectedIds: ids, maxItems: 3, onChange: (next: string[]) => { ids = next; } });
  const wrap = () => React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(OrderedItemPicker, props()));
  const view = render(wrap());
  expect(view.getByText('Unavailable item')).toBeTruthy();
  expect(view.container.querySelector('img')!.getAttribute('src')).toBe('/workshop.png');
  fireEvent.change(view.getByRole('searchbox'), { target: { value: 'Course' } });
  fireEvent.click(view.getByRole('button', { name: /Add Course/ }));
  expect(ids).toEqual(['missing', 'a', 'b']);
  view.rerender(wrap());
  expect(view.queryByRole('button', { name: /Add Course/ })).toBeNull();
  fireEvent.keyDown(view.getByRole('button', { name: /Reorder Course/ }), { key: 'ArrowUp' });
  expect(ids).toEqual(['missing', 'b', 'a']);
  view.rerender(wrap());
  fireEvent.click(view.getByRole('button', { name: 'Remove Course' }));
  expect(ids).toEqual(['missing', 'a']);
});
it('caps selection and offers an explicit empty state', () => {
  const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(OrderedItemPicker, { label: 'Offers', items: [], selectedIds: [], maxItems: 1, onChange: () => {} })));
  expect(view.getByText('No matches. Try another name.')).toBeTruthy();
});

it('replaces a single offer directly from search', () => {
  let ids = ['a'];
  const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(OrderedItemPicker, { label: 'Offer', items: [{ id: 'a', name: 'Old offer' }, { id: 'b', name: 'New offer' }], selectedIds: ids, maxItems: 1, onChange: next => { ids = next; } })));
  fireEvent.change(view.getByRole('searchbox'), { target: { value: 'New' } });
  fireEvent.click(view.getByRole('button', { name: 'Add New offer' }));
  expect(ids).toEqual(['b']);
});

it('accepts drops from its own drag handle and ignores a different list', () => {
  const changed: string[][] = [];
  const items = [{ id: 'a', name: 'First' }, { id: 'b', name: 'Second' }];
  const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(OrderedItemPicker, { label: 'Offers', items, selectedIds: ['a', 'b'], maxItems: 2, onChange: next => changed.push(next) })));
  const values = new Map<string, string>();
  const dataTransfer = { setData: (key: string, value: string) => values.set(key, value), getData: (key: string) => values.get(key) ?? '', effectAllowed: '' };
  fireEvent.dragStart(view.getByRole('button', { name: 'Reorder First' }), { dataTransfer });
  fireEvent.drop(view.getByText('Second').closest('li')!, { dataTransfer });
  expect(changed).toEqual([['b', 'a']]);
  values.set('application/x-sellf-list', 'another-list');
  fireEvent.drop(view.getByText('Second').closest('li')!, { dataTransfer });
  expect(changed).toHaveLength(1);
});
