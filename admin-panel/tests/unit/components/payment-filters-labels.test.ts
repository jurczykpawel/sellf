// @vitest-environment happy-dom
/**
 * Payments filters: the active status chip uses the same label as the status select.
 * @see src/components/admin/PaymentFilters.tsx
 */
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import pl from '@/messages/pl.json';
import PaymentFilters from '@/components/admin/PaymentFilters';

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, string>) => {
    const text = [...namespace.split('.'), key].reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], pl) as string;
    return text.replace(/\{(\w+)\}/g, (_, name) => values?.[name] ?? '');
  },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
afterEach(cleanup);

it.each([
  ['completed', 'Zakończona'], ['awaiting_payment', 'Oczekuje na przelew'], ['partially_refunded', 'Częściowo zwrócona'],
])('shows the translated label for status %s in the active filters', (status, label) => {
  render(createElement(PaymentFilters, {
    filters: { status, dateRange: '30', searchTerm: '' }, onFiltersChange: vi.fn(), onRefresh: vi.fn(), onSearchPendingChange: vi.fn(),
  }));
  expect(screen.getByText(`Status: ${label}`)).toBeTruthy();
  expect(screen.queryByText(`Status: ${status}`)).toBeNull();
});
