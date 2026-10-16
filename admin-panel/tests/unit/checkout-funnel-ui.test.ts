// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

const mocks = vi.hoisted(() => ({ load: vi.fn(), productId: undefined as string | undefined }));
vi.mock('@/lib/actions/checkout-funnel', () => ({ getCheckoutFunnel: mocks.load }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(mocks.productId ? { productId: mocks.productId } : {}) }));
vi.mock('@/contexts/UserPreferencesContext', () => ({ useUserPreferences: () => ({ hideValues: false }) }));

import CheckoutFunnel from '@/components/dashboard/CheckoutFunnel';

function show(locale = 'en') {
  return render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(CheckoutFunnel)));
}
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.productId = undefined; });

const counts = { started: 4, paid: 2, pending: 1, abandoned: 1 };
const result = { success: true, data: { totals: counts, products: [{ ...counts, productId: 'p1', name: 'Course' }] } };

describe('checkout funnel view', () => {
  it('shows product counts, honest definitions and reloads the selected period', async () => {
    mocks.load.mockResolvedValue(result);
    mocks.productId = 'p1';
    show();
    await screen.findByText('Course');
    expect(screen.getByText(/pending@sellf.app/)).toBeTruthy();
    expect(screen.getByText(/unique buyers/)).toBeTruthy();
    expect(screen.getAllByText(/50%/)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '7' } });
    await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(7, 'p1'));
  });

  it('offers retry on a failed read instead of displaying zeros', async () => {
    mocks.load.mockResolvedValueOnce({ success: false }).mockResolvedValueOnce(result);
    show();
    await screen.findByRole('alert');
    expect(screen.queryByText('Course')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Course');
  });

  it('shows an empty state in Polish', async () => {
    mocks.load.mockResolvedValue({ success: true, data: { totals: { started: 0, paid: 0, pending: 0, abandoned: 0 }, products: [] } });
    show('pl');
    await screen.findByText('Brak zapisanych płatności w tym okresie.');
    expect(screen.queryByText('NaN%')).toBeNull();
  });

  it('ignores an older response after the period changes', async () => {
    let finish: (value: typeof result) => void = () => {};
    mocks.load.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(result);
    show();
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '7' } });
    await screen.findByText('Course');
    finish({ ...result, data: { ...result.data, products: [] } });
    await waitFor(() => expect(screen.queryByText('Course')).toBeTruthy());
  });
});
