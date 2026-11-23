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
