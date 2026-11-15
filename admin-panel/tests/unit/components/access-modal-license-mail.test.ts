// @vitest-environment happy-dom
/**
 * Granting access with a license in the admin panel: a key mail held back by the mail provider limit
 * is a successful grant with a delivery notice, and a grant whose license step failed still shows the
 * saved access instead of a stale list.
 * @see src/components/AccessManagementModal.tsx
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AccessManagementModal from '@/components/AccessManagementModal';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';
import type { UserWithAccess } from '@/types';

const licensed = { id: 'p-lic', name: 'Kurs z licencją', slug: 'kurs', price: 10, currency: 'PLN', is_active: true, issue_license_on_purchase: true, license_tier: 'pro', license_duration_days: null, custom_checkout_fields: [] };
vi.mock('@/hooks/useProducts', () => ({ fetchAllProductsForDropdown: async () => [licensed] }));

const savedAccess = { id: 'a1', product_id: 'p-lic', product_name: 'Kurs z licencją', product_description: '', product_price: 10, product_currency: 'PLN', product_is_active: true, access_created_at: '2026-11-15T10:00:00Z', product_slug: 'kurs', has_grant_license: true };
const state = { access: [] as unknown[], post: { status: 201, body: {} as unknown } };
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === 'POST') {
    state.access = [savedAccess];
    return new Response(JSON.stringify(state.post.body), { status: state.post.status });
  }
  return new Response(JSON.stringify({ access: state.access }), { status: 200 });
});

beforeEach(() => { state.access = []; vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); fetchMock.mockClear(); vi.unstubAllGlobals(); });

const user = { id: 'u1', email: 'buyer@example.com' } as UserWithAccess;
const view = (locale: 'pl' | 'en') => createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en, timeZone: 'Europe/Warsaw' },
  createElement(AccessManagementModal, { user, isOpen: true, onClose: () => {}, onAccessChange: () => {} }));

async function grant(locale: 'pl' | 'en') {
  render(view(locale));
  const t = (locale === 'pl' ? pl : en).admin.users.accessModal;
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(t.addNewAccess) }));
  fireEvent.change(screen.getByLabelText(t.selectProductLabel), { target: { value: 'p-lic' } });
  fireEvent.click(screen.getByRole('button', { name: t.grantAccess }));
}

it('reports a granted license whose mail waits for the provider limit and shows the new access (PL)', async () => {
  state.post = { status: 201, body: { license: { id: 'l1', status: 'issued', email_sent: false, email_pending: true }, access: savedAccess } };
  await grant('pl');
  expect(await screen.findByText('Licencja przyznana, mail czeka na wysłanie (limit dostawcy poczty). Wyślemy go automatycznie.')).toBeTruthy();
  expect(screen.getByText('Kurs z licencją')).toBeTruthy();
  expect(screen.queryByText(pl.admin.users.accessModal.licenseError)).toBeNull();
});

it('uses the English notice in the English panel', async () => {
  state.post = { status: 201, body: { license: { id: 'l1', status: 'issued', email_sent: false, email_pending: true }, access: savedAccess } };
  await grant('en');
  expect(await screen.findByText('License granted. The email is waiting to be sent (mail provider limit); we will send it automatically.')).toBeTruthy();
});

it('refreshes the access list when the license step fails after the access was saved', async () => {
  state.post = { status: 500, body: { error: 'Access and license saved, but the license email could not be sent.', error_code: 'LICENSE_ISSUANCE_FAILED', access: savedAccess } };
  await grant('pl');
  expect(await screen.findByText(pl.admin.users.accessModal.licenseError)).toBeTruthy();
  await waitFor(() => expect(screen.getByText('Kurs z licencją', { selector: 'h4' })).toBeTruthy());
});
