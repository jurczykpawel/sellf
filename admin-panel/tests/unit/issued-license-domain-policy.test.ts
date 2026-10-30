// @vitest-environment happy-dom
/** The manual form follows the selected product's domain definition. */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import IssuedLicensesSettings from '@/components/settings/IssuedLicensesSettings';
const intl = vi.hoisted(() => ({ translate: (key: string) => key }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => intl.translate }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('hides the domain for ordinary products and requires it only when configured', async () => {
  const base = { name: 'Product', slug: 'product', license_tier: 'registered', license_duration_days: null };
  const field = { id: '_sellf_license_domain', type: 'domain', label: { en: 'Domain' }, required: true, max_length: 253 };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ licenses: [], total: 0, products: [{ ...base, id: 'plain', custom_checkout_fields: [] }, { ...base, id: 'required', custom_checkout_fields: [field] }, { ...base, id: 'optional', custom_checkout_fields: [{ ...field, required: false }] }] }) })));
  render(createElement(IssuedLicensesSettings, { enabled: true }));
  await waitFor(() => expect((screen.getByLabelText('product') as HTMLSelectElement).value).toBe('plain'));
  expect(screen.queryByPlaceholderText('example.com')).toBeNull();
  fireEvent.change(screen.getByLabelText('product'), { target: { value: 'required' } });
  expect((screen.getByPlaceholderText('example.com') as HTMLInputElement).required).toBe(true);
  fireEvent.change(screen.getByPlaceholderText('example.com'), { target: { value: 'previous.example.com' } });
  fireEvent.change(screen.getByLabelText('product'), { target: { value: 'optional' } });
  expect((screen.getByPlaceholderText('example.com') as HTMLInputElement).required).toBe(false);
  expect((screen.getByPlaceholderText('example.com') as HTMLInputElement).value).toBe('');
});
