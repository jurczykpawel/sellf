// @vitest-environment happy-dom
import { createElement, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useLocale: () => 'pl',
  useTranslations: () => (key: string) => key,
}));

import { PriceVatInline } from '@/components/ProductFormModal/sections/PriceVatInline';
import { initialFormData, type ProductFormData } from '@/components/ProductFormModal/types';

let latest: ProductFormData;

function Harness({ currency, initial }: { currency: string; initial?: Partial<ProductFormData> }) {
  const [formData, setFormData] = useState<ProductFormData>({ ...initialFormData, currency, ...initial });
  const [display, setDisplay] = useState('');
  latest = formData;
  return createElement(PriceVatInline, {
    formData,
    setFormData,
    t: (k: string) => k,
    priceDisplayValue: display,
    setPriceDisplayValue: setDisplay,
    shopDefaultVatRate: 23,
    taxMode: 'local',
  });
}

function type(value: string) {
  fireEvent.change(document.getElementById('price') as HTMLInputElement, { target: { value } });
}

afterEach(cleanup);

describe('price input never changes the typed magnitude', () => {
  it('keeps "1000.5" visible and flags it for JPY instead of turning it into 10005', () => {
    render(createElement(Harness, { currency: 'JPY' }));
    for (const v of ['1', '10', '100', '1000', '1000.', '1000.5']) type(v);

    expect((document.getElementById('price') as HTMLInputElement).value).toBe('1000.5');
    expect(latest.price).toBe(0);
    expect(screen.getByRole('alert').textContent).toBe('fractionNotAllowed');
  });

  it('reads "1 000" and "1.000" as one thousand yen', () => {
    render(createElement(Harness, { currency: 'JPY' }));
    type('1 000');
    expect(latest.price).toBe(1000);
    type('1.000');
    expect(latest.price).toBe(1000);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps decimal amounts for two-decimal currencies', () => {
    render(createElement(Harness, { currency: 'PLN' }));
    type('1000,5');
    expect(latest.price).toBe(1000.5);
  });

  it('re-checks the typed amount when the currency changes to a zero-decimal one', () => {
    render(createElement(Harness, { currency: 'PLN' }));
    type('19,99');
    act(() => {
      fireEvent.change(document.getElementById('currency') as HTMLSelectElement, { target: { value: 'JPY' } });
    });
    expect(latest.price).toBe(0);
    expect(screen.getByRole('alert').textContent).toBe('fractionNotAllowed');
  });
});

describe('VAT rate field', () => {
  it('stays visible and editable when the price excludes VAT', () => {
    render(createElement(Harness, { currency: 'PLN', initial: { price: 100, price_includes_vat: false, vat_rate: 8 } }));
    const rate = document.getElementById('vat_rate') as HTMLInputElement;
    expect(rate.value).toBe('8');
    fireEvent.change(rate, { target: { value: '23' } });
    expect(latest.vat_rate).toBe(23);
  });
});
