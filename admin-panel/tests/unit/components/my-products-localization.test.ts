// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import MyProductsPage from '@/app/[locale]/my-products/page';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({ localizations: vi.fn() }));
vi.mock('@/lib/actions/product-localization', () => ({ getProductLocalizations: mocks.localizations }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.pl' }, loading: false }) }));
vi.mock('@/components/DashboardLayout', () => ({ default: ({ children }: { children: unknown }) => createElement('div', null, children as never) }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => createElement('img', { alt }) }));

const base = { icon: '📦', price: 49, currency: 'PLN', is_active: true, is_featured: false, created_at: '2026-01-01T00:00:00Z' };
const owned = { ...base, id: 'p-owned', name: 'Owned canonical', slug: 'owned', description: 'Owned canonical text', image_url: 'https://example.com/a.png' };
const other = { ...base, id: 'p-other', name: 'Other canonical', slug: 'other', description: 'Other canonical text', image_url: null };
vi.mock('@/lib/supabase/client', () => ({
  createClient: async () => ({
    from: (table: string) => {
      const result = table === 'user_product_access'
        ? { data: [{ id: 'a1', access_granted_at: '2026-01-02T00:00:00Z', access_expires_at: null, product: owned, subscription: null }], error: null }
        : { data: [other], error: null };
      const chain: Record<string, unknown> = { then: (resolve: (value: unknown) => void) => resolve(result) };
      for (const method of ['select', 'eq', 'neq', 'order']) chain[method] = () => chain;
      return chain;
    },
  }),
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); });
const view = (locale: 'pl' | 'en') => createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, createElement(MyProductsPage));

it('renders owned and available cards in the active locale with locale-preserving links and canonical fallback (GitHub #73)', async () => {
  mocks.localizations.mockResolvedValue({ 'p-owned': { name: 'Własny kurs', description: 'Opis własnego', imageAlt: 'Okładka własnego' }, 'p-other': { name: 'Inny kurs' } });
  render(view('pl'));
  await screen.findByText('Własny kurs');
  expect(mocks.localizations).toHaveBeenCalledWith(expect.arrayContaining(['p-owned', 'p-other']), 'pl');
  expect(screen.getByText('Opis własnego')).toBeTruthy();
  expect(screen.getByAltText('Okładka własnego')).toBeTruthy();
  expect(screen.getByText('Inny kurs')).toBeTruthy();
  expect(screen.getByText('Other canonical text')).toBeTruthy();
  expect(screen.queryByText('Owned canonical')).toBeNull();
  expect(screen.getAllByRole('link').map(link => link.getAttribute('href')).sort()).toEqual(['/pl/p/other', '/pl/p/owned']);
});

it('keeps canonical text and unprefixed links in the default locale when nothing is translated', async () => {
  mocks.localizations.mockResolvedValue({});
  render(view('en'));
  await waitFor(() => expect(screen.getByText('Owned canonical')).toBeTruthy());
  expect(screen.getAllByRole('link').map(link => link.getAttribute('href')).sort()).toEqual(['/p/other', '/p/owned']);
});
