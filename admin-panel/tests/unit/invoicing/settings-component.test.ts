// @vitest-environment happy-dom
import { StrictMode, createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ get: vi.fn(), translate: (key: string) => key }));
vi.mock('next-intl', () => ({ useTranslations: () => mock.translate }));
vi.mock('@/lib/actions/invoicing', () => ({ getInvoiceSettings: mock.get, checkInvoiceConnection: vi.fn(), saveInvoiceSettings: vi.fn() }));
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
