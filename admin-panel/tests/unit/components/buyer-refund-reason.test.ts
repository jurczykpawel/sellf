// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MyPurchasesPage from '@/app/[locale]/my-purchases/page';
const { rpc, user } = vi.hoisted(() => ({ rpc: vi.fn(), user: { id: 'buyer' } }));
vi.mock('@/lib/supabase/client', () => ({ createClient: async () => ({ rpc, from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user, loading: false }) }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/components/DashboardLayout', () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/MySubscriptions', () => ({ default: () => null }));
afterEach(() => { cleanup(); rpc.mockReset(); });
it('shows a field error for an overlong reason and allows correcting it before submitting', async () => {
  rpc.mockResolvedValue({ data: [{ transaction_id: 'tx', product_name: 'Course', amount: 900, currency: 'PLN', status: 'completed', is_refundable: true, refund_eligible: true, refund_request_status: null, purchase_date: new Date().toISOString(), refund_period_days: 14 }], error: null });
  await act(async () => { render(createElement(MyPurchasesPage)); });
  fireEvent.click(screen.getByRole('button', { name: 'requestRefund' }));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'x'.repeat(2001) } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'submitRequest' })); });
  expect(rpc.mock.calls.filter(([name]) => name === 'create_refund_request')).toHaveLength(0);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('alert').textContent).toBe('refundReasonTooLong');
  fireEvent.change(input, { target: { value: 'wrong edition' } });
  rpc.mockResolvedValueOnce({ data: { success: true }, error: null });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'submitRequest' })); });
  expect(rpc).toHaveBeenCalledWith('create_refund_request', { transaction_id_param: 'tx', reason_param: 'wrong edition' });
});
