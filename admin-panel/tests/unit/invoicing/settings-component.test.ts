// @vitest-environment happy-dom
import { StrictMode, createElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ get: vi.fn(), translate: (key: string) => key }));
vi.mock('next-intl', () => ({ useTranslations: () => mock.translate }));
vi.mock('@/lib/actions/invoicing', () => ({ getInvoiceSettings: mock.get, checkInvoiceConnection: vi.fn(), saveInvoiceSettings: vi.fn() }));
import InvoicingSettings from '@/components/settings/InvoicingSettings';

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
