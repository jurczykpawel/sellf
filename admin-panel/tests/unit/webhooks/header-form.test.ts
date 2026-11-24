// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import WebhookFormModal from '@/components/webhooks/WebhookFormModal';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

vi.mock('@/hooks/useProducts', () => ({ useProductsDropdown: () => ({ products: [], loading: false, fetchProducts: vi.fn() }) }));
afterEach(cleanup);

it.each(['en', 'pl'] as const)('shows header feedback in %s before saving duplicate names', locale => {
  const messages = locale === 'pl' ? pl : en;
  const text = messages.admin.webhooks;
  const submit = vi.fn();
  render(React.createElement(NextIntlClientProvider, { locale, messages }, React.createElement(WebhookFormModal, {
    isOpen: true, onClose: vi.fn(), onSubmit: submit, editingEndpoint: null, isSubmitting: false, onSecretRotated: vi.fn(),
  })));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(text.customization.title.replace(/[()]/g, '\\$&')) }));
  for (const name of ['Authorization', 'authorization']) {
    fireEvent.click(screen.getByRole('button', { name: text.customization.addHeader }));
    fireEvent.change(screen.getAllByPlaceholderText(text.customization.headerNamePlaceholder).at(-1)!, { target: { value: name } });
    fireEvent.change(screen.getAllByPlaceholderText(text.customization.headerValuePlaceholder).at(-1)!, { target: { value: 'fixture' } });
  }
  fireEvent.submit(document.getElementById('webhook-form')!);
  expect(screen.getByText(text.customization.headerInvalid)).toBeTruthy();
  expect(document.activeElement?.getAttribute('aria-describedby')).toBe('webhook-header-error-0');
  expect(submit).not.toHaveBeenCalled();
});
