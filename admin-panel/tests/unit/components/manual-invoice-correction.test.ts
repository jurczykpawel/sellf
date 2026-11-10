// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import InvoiceSection from '@/components/admin/InvoiceSection';
const m = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/actions/invoicing', () => ({ getInvoiceSettings: async () => ({ success: true, data: { provider: 'none' } }), mutateInvoice: m.mutate }));
afterEach(cleanup);
it.each(['cancelled','refunded'])('reminds of correction for an externally issued invoice on %s', async status => {
 m.mutate.mockResolvedValue({ success: true }); const refresh = vi.fn();
 await act(async () => { render(createElement(InvoiceSection, { transactionId: 'tx', status, invoiceHoldAt: '2026-11-01', onRefresh: refresh })); });
 expect(screen.getByText('manualCorrectionHelp')).toBeTruthy();
 await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'correct' })); });
 expect(m.mutate).toHaveBeenCalledWith('tx','corrected'); expect(refresh).toHaveBeenCalled();
});
it('shows the saved correction and no further correction action', async () => {
 await act(async () => { render(createElement(InvoiceSection, { transactionId: 'tx', status: 'cancelled', invoiceHoldAt: '2026-11-01', invoice: { status: 'corrected', number: null, view_url: null, error: null, attempts: 1 } })); });
 expect(screen.getByText('corrected')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'correct' })).toBeNull();
});
