// @vitest-environment happy-dom
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CouponFormModal from '@/components/CouponFormModal';
import pl from '@/messages/pl.json';
vi.mock('@/lib/actions/shop-config', () => ({ getMyShopConfig: async () => ({ default_currency: 'PLN' }) }));
vi.mock('@/components/affiliates/products/Settings', () => ({ AffiliateCouponEditor: () => null }));
afterEach(cleanup);
const messages = pl;
async function setup() {
  const submit = vi.fn();
  const view = render(React.createElement(NextIntlClientProvider, { locale: 'pl', messages }, React.createElement(CouponFormModal, { products: [], editingCoupon: null, onSubmit: submit, onClose: vi.fn(), isSubmitting: false })));
  await screen.findByText(`${pl.admin.coupons.fixed} (PLN)`);
  return { submit, form: view.container.querySelector('form')!, code: view.container.querySelector('input[type=text]') as HTMLInputElement, value: view.container.querySelector('input[name=discount_value]') as HTMLInputElement };
}
it('shows a Polish percentage error next to the field and blocks submission at 101%', async () => {
  const { form, code, value, submit } = await setup();
  fireEvent.change(code, { target: { value: 'SAVE' } });
  fireEvent.change(value, { target: { value: '101' } });
  fireEvent.submit(form);
  expect(submit).not.toHaveBeenCalled();
  expect(form.noValidate).toBe(true);
  expect(value.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(value.getAttribute('aria-describedby')!)?.textContent).toBe(messages.admin.coupons.form.percentageInvalid);
});
it('keeps the typed coupon code and explains spaces instead of silently normalizing', async () => {
  const { form, code, value, submit } = await setup();
  fireEvent.change(code, { target: { value: 'summer sale' } });
  fireEvent.change(value, { target: { value: '10' } });
  fireEvent.submit(form);
  expect(submit).not.toHaveBeenCalled();
  expect(code.value).toBe('summer sale');
  expect(code.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(code.getAttribute('aria-describedby')!)?.textContent).toBe(messages.admin.coupons.form.codeInvalid);
});
