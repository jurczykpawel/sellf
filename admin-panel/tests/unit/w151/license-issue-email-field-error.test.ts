// @vitest-environment happy-dom
/** B1 (W146): an invalid buyer e-mail in manual license issuance is reported next to the field in the page language, not as an English toast. */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key, useLocale: () => 'pl' }));
vi.mock('sonner', () => ({ toast: { error: h.toastError, success: vi.fn() } }));
import IssuedLicensesSettings from '@/components/settings/IssuedLicensesSettings';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Reflect.deleteProperty(window, 'confirm'); h.toastError.mockReset(); });

const product = { id: '11111111-1111-4111-8111-111111111111', name: 'Course', license_tier: 'pro', license_duration_days: 30, custom_checkout_fields: [] };

async function fillAndSubmit(email: string) {
  render(createElement(IssuedLicensesSettings, { enabled: true }));
  const option = await screen.findByRole('option', { name: 'Course' });
  const select = option.closest('select')!;
  fireEvent.change(select, { target: { value: product.id } });
  const input = document.querySelector('input[type="email"]') as HTMLInputElement;
  fireEvent.change(input, { target: { value: email } });
  fireEvent.submit(input.closest('form')!);
  return input;
}

it('shows the translated message under the e-mail field and sends nothing for a@b', async () => {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? new Response(JSON.stringify({ error: 'Invalid request', details: { fieldErrors: { email: ['Invalid email address'] } } }), { status: 400 })
    : new Response(JSON.stringify({ licenses: [], products: [product], total: 0 }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: () => true });
  const input = await fillAndSubmit('a@b');
  expect(await screen.findByText('invalidEmail')).toBeTruthy();
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  expect(h.toastError).not.toHaveBeenCalled();
});

it('maps a server-side e-mail rejection to the same field message', async () => {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? new Response(JSON.stringify({ error: 'Invalid request', details: { fieldErrors: { email: ['Invalid email address'] } } }), { status: 400 })
    : new Response(JSON.stringify({ licenses: [], products: [product], total: 0 }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: () => true });
  await fillAndSubmit('buyer@example.com');
  expect(await screen.findByText('invalidEmail')).toBeTruthy();
  expect(h.toastError).not.toHaveBeenCalledWith('Invalid request');
});

it('has the message in both languages', () => {
  expect((pl as unknown as { settings: { issuedLicenses: Record<string, string> } }).settings.issuedLicenses.invalidEmail).toMatch(/adres e-mail/i);
  expect((en as unknown as { settings: { issuedLicenses: Record<string, string> } }).settings.issuedLicenses.invalidEmail).toMatch(/email address/i);
});

it('keeps one license page title without repeating its heading inside the form', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ licenses: [], products: [product], total: 0 }), { status: 200 })));
  render(createElement('main', null,
    createElement('h1', null, 'title'),
    createElement(IssuedLicensesSettings, { enabled: true }),
  ));
  await screen.findByRole('option', { name: 'Course' });
  expect(screen.getAllByRole('heading', { name: 'title' })).toHaveLength(1);
});

it('rejects an invalid license domain beside the field without confirmation or POST', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ licenses: [], products: [{ ...product, custom_checkout_fields: [{ id: '_sellf_license_domain', type: 'domain', required: true }] }], total: 0 })));
  vi.stubGlobal('fetch', fetch);
  const confirm = vi.fn(() => true);
  Object.defineProperty(window, 'confirm', { configurable: true, value: confirm });
  const email = await fillAndSubmit('buyer@example.com');
  const domain = screen.getByPlaceholderText('example.com');
  fireEvent.change(domain, { target: { value: 'not-a-domain' } });
  fireEvent.submit(email.closest('form')!);
  expect(await screen.findByText('invalidDomain')).toBeTruthy();
  expect(domain.getAttribute('aria-invalid')).toBe('true');
  expect(confirm).not.toHaveBeenCalled();
  expect(h.toastError).not.toHaveBeenCalled();
});

it('caps license search at 254 and explains the limit at the field', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ licenses: [], products: [product], total: 0 }))));
  render(createElement(IssuedLicensesSettings, { enabled: true }));
  const search = screen.getByLabelText('search') as HTMLInputElement;
  fireEvent.change(search, { target: { value: 'x'.repeat(255) } });
  expect(search.maxLength).toBe(254);
  expect(search.value.length).toBeLessThanOrEqual(254);
  expect(await screen.findByText('searchTooLong')).toBeTruthy();
});

it('accepts a valid domain after correction and maps a server rejection to the domain field', async () => {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? new Response(JSON.stringify({ fieldErrors: { domain: ['Invalid domain'] } }), { status: 400 })
    : new Response(JSON.stringify({ licenses: [], products: [{ ...product, custom_checkout_fields: [{ id: '_sellf_license_domain', type: 'domain', required: true }] }], total: 0 })));
  vi.stubGlobal('fetch', fetch);
  Object.defineProperty(window, 'confirm', { configurable: true, value: () => true });
  const email = await fillAndSubmit('buyer@example.com');
  const domain = screen.getByPlaceholderText('example.com');
  fireEvent.change(domain, { target: { value: 'https://www.example.com' } });
  fireEvent.submit(email.closest('form')!);
  expect(await screen.findByText('invalidDomain')).toBeTruthy();
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
  expect(h.toastError).not.toHaveBeenCalled();
});

it('provides localized domain and search feedback', () => {
  expect(pl.settings.issuedLicenses.invalidDomain).toMatch(/domenę/);
  expect(en.settings.issuedLicenses.invalidDomain).toMatch(/domain/);
  expect(pl.settings.issuedLicenses.searchTooLong).toContain('254');
  expect(en.settings.issuedLicenses.searchTooLong).toContain('254');
});
