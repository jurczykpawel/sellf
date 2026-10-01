// @vitest-environment happy-dom

import { createElement, StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductForm } from '@/components/ProductFormModal/hooks/useProductForm';

vi.mock('@/components/providers/config-provider', () => ({
  useConfig: () => ({ trustedDownloadDomains: [] }),
}));
vi.mock('@/lib/actions/categories', () => ({ getCategories: vi.fn().mockResolvedValue({ success: true, data: [] }) }));
vi.mock('@/lib/actions/tags', () => ({ getTags: vi.fn().mockResolvedValue({ success: true, data: [] }) }));
vi.mock('@/lib/actions/shop-config', () => ({ getMyShopConfig: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }),
}));
vi.mock('@/hooks/useProducts', () => ({ fetchAllProductsForDropdown: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/api/client', () => ({ api: {} }));
vi.mock('@/utils/themeUtils', () => ({ getIconEmoji: () => '🚀' }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn() }));

const onSubmit = vi.fn().mockResolvedValue(undefined);

function Form({ isOpen }: { isOpen: boolean }) {
  const { nameInputRef, formData, handleInputChange, priceDisplayValue, setPriceDisplayValue } = useProductForm({ isOpen, onSubmit });
  return createElement('div', { role: 'dialog', tabIndex: -1 },
    createElement('input', { id: 'name', name: 'name', 'aria-label': 'Name', ref: nameInputRef, value: formData.name, onChange: handleInputChange }),
    createElement('input', { id: 'price', 'aria-label': 'Price', value: priceDisplayValue, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setPriceDisplayValue(event.target.value) }),
    createElement('textarea', { 'aria-label': 'Description' }),
    createElement('select', { 'aria-label': 'Currency' }, createElement('option', null, 'USD')),
    createElement('div', { contentEditable: true, 'aria-label': 'Content', tabIndex: 0 }),
  );
}

async function openForm() {
  const view = render(createElement(Form, { isOpen: false }));
  await act(async () => view.rerender(createElement(Form, { isOpen: true })));
  return view;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Product form opening focus', () => {
  it('keeps focus and typing in price when the user moves on before 100ms', async () => {
    await openForm();
    const name = screen.getByLabelText<HTMLInputElement>('Name');
    const price = screen.getByLabelText<HTMLInputElement>('Price');
    name.focus();
    fireEvent.change(document.activeElement!, { target: { value: 'Nav Test Product' } });
    price.focus();
    fireEvent.change(document.activeElement!, { target: { value: '1' } });
    act(() => vi.advanceTimersByTime(101));
    const typingTarget = document.activeElement as HTMLInputElement;
    fireEvent.change(typingTarget, { target: { value: `${typingTarget.value}0` } });
    expect(document.activeElement).toBe(price);
    expect(price.value).toBe('10');
    expect(name.value).toBe('Nav Test Product');
  });

  it('focuses name on open when no other control is focused', async () => {
    await openForm();
    act(() => vi.advanceTimersByTime(101));
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  it.each(['Description', 'Currency', 'Content'])('preserves focus on %s', async (label) => {
    await openForm();
    const control = screen.getByLabelText<HTMLElement>(label);
    control.focus();
    act(() => vi.advanceTimersByTime(101));
    expect(document.activeElement).toBe(control);
  });

  it('focuses name when the dialog container is focused', async () => {
    await openForm();
    screen.getByRole('dialog').focus();
    act(() => vi.advanceTimersByTime(101));
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  it('cancels pending focus on close and focuses name on reopen', async () => {
    const view = await openForm();
    const focus = vi.spyOn(screen.getByLabelText('Name'), 'focus');
    await act(async () => view.rerender(createElement(Form, { isOpen: false })));
    act(() => vi.advanceTimersByTime(101));
    expect(focus).not.toHaveBeenCalled();
    await act(async () => view.rerender(createElement(Form, { isOpen: true })));
    act(() => vi.advanceTimersByTime(101));
    expect(focus).toHaveBeenCalledOnce();
  });

  it('cancels the pending timer on unmount', async () => {
    const view = await openForm();
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('focuses name on initial mount in StrictMode', async () => {
    await act(async () => render(createElement(StrictMode, null, createElement(Form, { isOpen: true }))));
    act(() => vi.advanceTimersByTime(101));
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });
});
