// @vitest-environment happy-dom
/** The shop setting "collect a different invoice recipient" starts OFF and is saved at once. @J622 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn() }));
vi.mock('next-intl', () => { const t = (key: string) => key; return { useTranslations: () => t }; });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/actions/invoice-recipient-config', () => ({ getInvoiceRecipientSetting: h.read, setInvoiceRecipientSetting: h.save }));
import InvoiceRecipientSettings from '@/components/settings/InvoiceRecipientSettings';
afterEach(cleanup);

it('shows the saved state (off) and switches it on @J622', async () => {
  h.read.mockResolvedValue({ success: true, data: { enabled: false } });
  h.save.mockResolvedValue({ success: true });
  const view = render(createElement(InvoiceRecipientSettings));
  const input = view.getByRole('checkbox') as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  expect(input.checked).toBe(false);
  fireEvent.click(input);
  expect(h.save).toHaveBeenCalledWith(true);
  await waitFor(() => expect(input.checked).toBe(true));
});

it('restores the previous state when saving fails', async () => {
  h.read.mockResolvedValue({ success: true, data: { enabled: true } });
  h.save.mockResolvedValue({ success: false, error: 'x' });
  const view = render(createElement(InvoiceRecipientSettings));
  const input = view.getByRole('checkbox') as HTMLInputElement;
  await waitFor(() => expect(input.checked).toBe(true));
  fireEvent.click(input);
  await waitFor(() => { expect(input.checked).toBe(true); expect(input.disabled).toBe(false); });
});
