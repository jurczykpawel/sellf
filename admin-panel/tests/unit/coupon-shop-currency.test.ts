// @vitest-environment happy-dom
/** New coupons inherit shop currency. @see components/CouponFormModal.tsx */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CouponFormModal from '@/components/CouponFormModal';
import en from '@/messages/en.json';
vi.mock('@/lib/actions/shop-config', () => ({ getMyShopConfig: async () => ({ default_currency: 'PLN' }) }));
vi.mock('@/components/affiliates/products/Settings', () => ({ AffiliateCouponEditor: () => null }));
afterEach(cleanup);
it('labels a new fixed coupon with the shop currency and selects that currency', async () => {
  const submit = vi.fn();
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(CouponFormModal, { products: [], editingCoupon: null, onSubmit: submit, onClose: vi.fn(), isSubmitting: false })));
  const fixed = await screen.findByText(`${en.admin.coupons.fixed} (PLN)`);
  fireEvent.click(fixed);
  expect((screen.getByRole('combobox', { name: en.admin.coupons.form.currency }) as HTMLSelectElement).value).toBe('PLN');
});

it('continues to submit percentage coupons without a currency', async () => {
  const submit = vi.fn();
  const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(CouponFormModal, { products: [], editingCoupon: null, onSubmit: submit, onClose: vi.fn(), isSubmitting: false })));
  await screen.findByText(`${en.admin.coupons.fixed} (PLN)`);
  fireEvent.change(view.container.querySelector('input[type=text]')!, { target: { value: 'SAVE' } });
  fireEvent.change(view.container.querySelector('input[name=discount_value]')!, { target: { value: '10' } });
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ discount_type: 'percentage', currency: null })));
});

it('explains empty limits outside the input placeholder', async () => {
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(CouponFormModal, { products: [], editingCoupon: null, onSubmit: vi.fn(), onClose: vi.fn(), isSubmitting: false })));
  await screen.findByText(`${en.admin.coupons.fixed} (PLN)`);
  expect(screen.getByText(en.admin.coupons.form.unlimited, { exact: true })).toBeTruthy();
});

it('submits a set-price coupon with zero and shop currency', async () => {
  const submit = vi.fn();
  const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(CouponFormModal, { products: [], editingCoupon: null, onSubmit: submit, onClose: vi.fn(), isSubmitting: false })));
  await screen.findByText(`${en.admin.coupons.fixed} (PLN)`);
  fireEvent.click(screen.getByRole('button', { name: en.admin.coupons.setPrice }));
  expect((screen.getByRole('combobox', { name: en.admin.coupons.form.currency }) as HTMLSelectElement).value).toBe('PLN');
  fireEvent.change(view.container.querySelector('input[type=text]')!, { target: { value: 'SAVE' } });
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ discount_type: 'set_price', discount_value: 0, currency: 'PLN' })));
});
