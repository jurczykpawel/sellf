// @vitest-environment happy-dom
import { createElement } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Panel from '@/components/settings/SecurityAuditSettings';
import pl from '@/messages/pl.json';

vi.mock('@/lib/actions/security-audit', () => ({
  getSecurityAudit: vi.fn().mockResolvedValue({ success: true, timestamp: '2026-10-17T12:00:00Z', checks: [
    { id: 'count-header-leak', name: 'Liczba wierszy w nagłówku Prefer', status: 'warn', message: 'Nagłówek ujawnia liczbę wierszy.', steps: ['Sprawdź ustawienia proxy.'] },
  ] }),
  runSecurityAudit: vi.fn(),
}));
afterEach(cleanup);
it('renders the Polish row status and instructions', async () => {
  render(createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, createElement(Panel)));
  expect(await screen.findByText('Ostrzeżenie')).toBeTruthy();
  expect(screen.getByText('Jak poprawić')).toBeTruthy();
  expect(screen.queryByText('How to fix')).toBeNull();
});
it('uses Polish sentence case for refund reasons', () => {
  expect(pl.admin.payments.refund.reason).toBe('Powód zwrotu');
  expect(pl.admin.payments.refund.reasons.requested_by_customer).toBe('Prośba klienta');
  expect(pl.admin.payments.refund.reasons.duplicate).toBe('Duplikat płatności');
});
