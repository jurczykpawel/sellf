// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import ApiKeyFormModal from '@/components/ApiKeyFormModal';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';
afterEach(cleanup);
const open = (locale = 'pl', edit = false) => {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, createElement(ApiKeyFormModal, { isOpen: true, onClose: vi.fn(), onSubmit: submit, isSubmitting: false, ...(edit ? { initialData: { name: 'Existing', scopes: ['*'], rate_limit_per_minute: 60 } } : {}) })));
  return submit;
};
it.each([false, true])('names the key input in create/edit (%s)', edit => {
  open('pl', edit);
  const input = screen.getByRole('textbox', { name: /Nazwa klucza/ }) as HTMLInputElement;
  expect(input.labels?.length).toBe(1);
});
it('names advanced inputs', () => {
  open(); fireEvent.click(screen.getByText(pl.admin.apiKeys.showAdvanced));
  expect(screen.getByLabelText(pl.admin.apiKeys.rateLimit)).toBeTruthy();
  expect(screen.getByLabelText(pl.admin.apiKeys.expiration)).toBeTruthy();
});
it.each(['pl', 'en'])('validates 101 characters inline in %s for create and edit', async locale => {
  for (const edit of [false, true]) {
    const submit = open(locale, edit);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'X'.repeat(101) } });
    fireEvent.submit(input.closest('form')!);
    expect(submit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const error = document.getElementById(input.getAttribute('aria-describedby')!);
    expect(error?.textContent).toBe(locale === 'pl' ? 'Nazwa klucza może mieć najwyżej 100 znaków.' : 'Key name must be at most 100 characters.');
    fireEvent.change(input, { target: { value: 'X'.repeat(100) } });
    fireEvent.submit(input.closest('form')!);
    expect(submit).toHaveBeenCalledOnce();
    cleanup();
  }
});
it.each(['pl', 'en'])('associates the required-name error in %s before submission', locale => {
  open(locale);
  const input = screen.getByRole('textbox');
  fireEvent.invalid(input);
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe((locale === 'pl' ? pl : en).admin.apiKeys.nameRequired);
});
it('clears rejected-name feedback when another key is opened', () => {
  const key = (name: string) => createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, createElement(ApiKeyFormModal, { isOpen: true, onClose: vi.fn(), onSubmit: vi.fn().mockResolvedValue(undefined), isSubmitting: false, initialData: { name, scopes: ['*'], rate_limit_per_minute: 60 } }));
  const view = render(key('First key'));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'X'.repeat(101) } }); fireEvent.submit(input.closest('form')!);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  view.rerender(key('Second key'));
  expect((input as HTMLInputElement).value).toBe('Second key');
  expect(input.getAttribute('aria-invalid')).toBe('false');
});
it('preserves the draft and feedback when the parent repeats identical initial values', () => {
  const key = () => createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, createElement(ApiKeyFormModal, { isOpen: true, onClose: vi.fn(), onSubmit: vi.fn().mockResolvedValue(undefined), isSubmitting: false, initialData: { name: 'First key', scopes: ['*'], rate_limit_per_minute: 60 } }));
  const view = render(key()); const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'X'.repeat(101) } }); fireEvent.submit(input.closest('form')!);
  view.rerender(key());
  expect((input as HTMLInputElement).value).toBe('X'.repeat(101));
  expect(input.getAttribute('aria-invalid')).toBe('true');
});
