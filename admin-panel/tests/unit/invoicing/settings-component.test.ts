// @vitest-environment happy-dom
import { StrictMode, createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), translate: (key: string) => key }));
vi.mock('next-intl', () => ({ useTranslations: () => mock.translate }));
vi.mock('@/lib/actions/invoicing', () => ({ getInvoiceSettings: mock.get, checkInvoiceConnection: vi.fn(), saveInvoiceSettings: mock.save }));
import InvoicingSettings from '@/components/settings/InvoicingSettings';

afterEach(cleanup);

it('ignores an obsolete initial settings response after the active response', async () => {
  const pending: ((value: unknown) => void)[] = [];
  mock.get.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  render(createElement(StrictMode, null, createElement(InvoicingSettings)));
  const result = { success: true, data: { provider: 'fakturownia', domain: 'old.fakturownia.pl', mode: 'manual', exemption: '', template: '{product}' } };
  expect(pending).toHaveLength(2);
  await act(async () => pending[1](result));
  fireEvent.change(screen.getByLabelText('domain'), { target: { value: 'new.fakturownia.pl' } });
  await act(async () => pending[0](result));
  expect((screen.getByLabelText('domain') as HTMLInputElement).value).toBe('new.fakturownia.pl');
});

const fakturowniaFields = ['domain', 'token', 'mode', 'exemption', 'template'] as const;

it('hides the Fakturownia fields and the connection check while the provider is Disabled @J654', async () => {
  mock.get.mockResolvedValue({ success: true, data: { provider: 'none', domain: 'kept.fakturownia.pl', mode: 'auto', exemption: 'art. 43', template: '{product}' } });
  render(createElement(InvoicingSettings));
  await act(async () => {});
  for (const label of fakturowniaFields) expect(screen.queryByLabelText(label)).toBeNull();
  expect(screen.queryByRole('button', { name: 'check' })).toBeNull();
  expect(screen.getByText('disabledHelp')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'save' })).toBeTruthy();

  fireEvent.change(screen.getByLabelText('provider'), { target: { value: 'fakturownia' } });
  for (const label of fakturowniaFields) expect(screen.getByLabelText(label)).toBeTruthy();
  // The saved values come back when the provider is switched on again.
  expect((screen.getByLabelText('domain') as HTMLInputElement).value).toBe('kept.fakturownia.pl');
  expect(screen.getByRole('button', { name: 'check' })).toBeTruthy();
  expect(screen.queryByText('disabledHelp')).toBeNull();
});

it.each(['domain', 'token', 'template'])('shows the %s validation error and focuses the field', async field => {
  mock.get.mockResolvedValue({ success: true, data: { provider: 'fakturownia', domain: '', mode: 'manual', exemption: '', template: '{product}' } });
  mock.save.mockResolvedValue({ success: false, fieldErrors: { [field]: field === 'token' ? 'tokenRequired' : 'invalidField' } });
  render(createElement(InvoicingSettings));
  await act(async () => {});
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'save' })));
  const input = screen.getByLabelText(field);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(input);
  expect(document.getElementById(input.getAttribute('aria-describedby')!)).toBeTruthy();
});
