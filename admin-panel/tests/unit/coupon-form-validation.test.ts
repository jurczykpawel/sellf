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
it('focuses and reveals the code when saving an empty coupon from the footer', async () => {
  const { form, code } = await setup();
  const scroll = vi.fn(); code.scrollIntoView = scroll;
  screen.getByRole('button', { name: pl.admin.coupons.form.save }).focus();
  fireEvent.submit(form);
  await vi.waitFor(() => expect(document.activeElement).toBe(code));
  expect(scroll).toHaveBeenCalled();
});
it('keeps zero visible and validates the global usage limit before submitting', async () => {
  const { form, code, value, submit } = await setup();
  fireEvent.change(code, { target: { value: 'LIMIT' } });
  fireEvent.change(value, { target: { value: '10' } });
  const limit = form.querySelectorAll<HTMLInputElement>('input[type=number]')[1];
  fireEvent.change(limit, { target: { value: '0' } });
  expect(limit.value).toBe('0');
  fireEvent.submit(form);
  expect(submit).not.toHaveBeenCalled();
  expect(limit.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(limit);
  fireEvent.change(limit, { target: { value: '' } });
  fireEvent.submit(form);
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ usage_limit_global: null }));
});
it('rejects malformed restriction email before creating a chip', async () => {
  const { form, submit, code, value } = await setup();
  const email = form.querySelector<HTMLInputElement>('input[type=email]')!;
  fireEvent.change(email, { target: { value: 'zlyemail' } });
  fireEvent.click(screen.getByRole('button', { name: pl.admin.coupons.form.add }));
  expect(form.querySelector('span.bg-sf-accent-soft')).toBeNull();
  expect(email.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(email.getAttribute('aria-describedby')!)?.textContent).toBe('Wpisz poprawny adres e-mail.');
  fireEvent.change(code, { target: { value: 'VALID' } });
  fireEvent.change(value, { target: { value: '10' } });
  fireEvent.submit(form);
  expect(submit).not.toHaveBeenCalled();
});
it('explains an overlong coupon name beside its input', async () => {
  const { form, code, value, submit } = await setup();
  fireEvent.change(code, { target: { value: 'VALID' } });
  fireEvent.change(value, { target: { value: '10' } });
  const name = form.querySelectorAll<HTMLInputElement>('input[type=text]')[1];
  fireEvent.change(name, { target: { value: 'R'.repeat(201) } });
  fireEvent.submit(form);
  expect(submit).not.toHaveBeenCalled();
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(name.getAttribute('aria-describedby')!)?.textContent).toBe('Nazwa może mieć najwyżej 200 znaków.');
});
