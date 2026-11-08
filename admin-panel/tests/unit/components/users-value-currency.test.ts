// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import UserDetailsModal from '@/components/UserDetailsModal';
import UsersTable from '@/components/UsersTable';
import type { UserWithAccess } from '@/types';
const translate = (key: string) => key;
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => translate }));
afterEach(cleanup);
it('shows product access value separately in its original currencies', () => {
  const user = { id: 'u', email: 'buyer@example.com', created_at: '2026-11-08', product_access: [
    { product_slug: 'pln', product_name: 'PL product', product_price: 20, product_currency: 'PLN' },
    { product_slug: 'usd', product_name: 'US product', product_price: 10, product_currency: 'USD' },
  ], stats: { total_value: 30 } } as UserWithAccess;
  const noop = () => {};
  render(createElement(UsersTable, { users: [user], loading: false, error: null, onViewDetails: noop, onManageAccess: noop, onRefresh: noop, currentPage: 1, totalPages: 1, totalItems: 1, onPageChange: noop, limit: 20, sortBy: 'email', sortOrder: 'asc', onSort: noop }));
  expect(screen.getByText('PLN 20.00')).toBeTruthy();
  expect(screen.getByText('$10.00')).toBeTruthy();
});

it('shows the same original currencies in customer details', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: { email: 'buyer@example.com', created_at: '2026-11-08' }, stats: { total_products: 1, total_value: 20 }, access: [{ id: 'a', product_price: 20, product_currency: 'PLN', product_name: 'PL product' }] }) }));
  await act(async () => { render(createElement(UserDetailsModal, { userId: 'u', isOpen: true, onClose: () => {}, onManageAccess: () => {} })); });
  expect(screen.queryAllByText('$20.00')).toHaveLength(0);
  expect(screen.getAllByText('PLN 20.00').length).toBeGreaterThanOrEqual(3);
  vi.unstubAllGlobals();
});
