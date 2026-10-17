// @vitest-environment happy-dom
/** Shared ordered selection controls for bundles and storefront bindings. */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import OrderedItemPicker from '@/components/ui/OrderedItemPicker';
import en from '@/messages/en.json';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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

function renderFocusPicker(maxItems = 3) {
  const changes: string[][] = [];
  function Harness() {
    const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
    return React.createElement(React.Fragment, null,
      React.createElement(OrderedItemPicker, {
        label: 'Offers', items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }], selectedIds, maxItems,
        onChange: (next: string[]) => { changes.push(next); setSelectedIds(next); },
      }),
      React.createElement('button', { type: 'button' }, 'Continue'),
    );
  }
  const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(Harness)));
  return { ...view, changes };
}
function holdAnimationFrames() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  return () => act(() => { while (frames.length) frames.shift()!(0); });
}

it('keeps a new search open when selection focus is delivered afterward', () => {
  const flushFrames = holdAnimationFrames();
  const view = renderFocusPicker();
  fireEvent.click(view.getByRole('button', { name: 'Add Alpha' }));
  const input = view.getByRole('searchbox') as HTMLInputElement;
  act(() => input.focus());
  fireEvent.change(input, { target: { value: 'Beta' } });
  flushFrames();
  expect(input.value).toBe('Beta');
  expect(view.getByRole('button', { name: 'Add Beta' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Add Beta' }));
  expect(view.changes).toEqual([['a'], ['a', 'b']]);
});

it('does not steal focus after the user leaves the picker following a selection', () => {
  const flushFrames = holdAnimationFrames();
  const view = renderFocusPicker();
  fireEvent.click(view.getByRole('button', { name: 'Add Alpha' }));
  const outside = view.getByRole('button', { name: 'Continue' });
  act(() => outside.focus());
  flushFrames();
  expect(document.activeElement).toBe(outside);
});

it('returns focus to the last removal control when the selection cap removes search', () => {
  const flushFrames = holdAnimationFrames();
  const view = renderFocusPicker(2);
  fireEvent.click(view.getByRole('button', { name: 'Add Alpha' }));
  flushFrames();
  expect(document.activeElement).toBe(view.getByRole('searchbox'));
  expect(view.queryByRole('button', { name: 'Add Beta' })).toBeNull();
  fireEvent.change(view.getByRole('searchbox'), { target: { value: 'Beta' } });
  fireEvent.click(view.getByRole('button', { name: 'Add Beta' }));
  flushFrames();
  expect(view.queryByRole('searchbox')).toBeNull();
  expect(document.activeElement).toBe(view.getByRole('button', { name: 'Remove Beta' }));
  expect(view.changes).toEqual([['a'], ['a', 'b']]);
});
