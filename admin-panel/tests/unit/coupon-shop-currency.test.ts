// @vitest-environment happy-dom
/** New coupons inherit shop currency. @see components/CouponFormModal.tsx */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CouponFormModal from '@/components/CouponFormModal';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { Coupon } from '@/types/coupon';
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

it.each([['en', en], ['pl', pl]] as const)('marks the saved invalid address in %s and clears the error after removal', async (locale, messages) => {
  const submit = vi.fn();
  const coupon = { id: 'saved', code: 'SAVE', name: 'Saved coupon', discount_type: 'percentage', discount_value: 10, currency: null, is_active: true, allowed_emails: ['invalid-address', 'buyer@example.com'] } as Coupon;
  const view = render(React.createElement(NextIntlClientProvider, { locale, messages }, React.createElement(CouponFormModal, { products: [], editingCoupon: coupon, onSubmit: submit, onClose: vi.fn(), isSubmitting: false })));
  await screen.findByText(`${messages.admin.coupons.fixed} (PLN)`);
  fireEvent.submit(view.container.querySelector('form')!);
  const invalid = screen.getByText('invalid-address'), valid = screen.getByText('buyer@example.com');
  expect(invalid.getAttribute('aria-invalid')).toBe('true');
  expect(invalid.getAttribute('aria-describedby')).toBe('coupon-email-error');
  expect(invalid.className).toContain('border-sf-danger');
  expect(valid.getAttribute('aria-invalid')).not.toBe('true');
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(invalid.querySelector('button')!);
  expect(screen.queryByText(messages.admin.coupons.form.emailInvalid)).toBeNull();
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ allowed_emails: ['buyer@example.com'] })));
});
