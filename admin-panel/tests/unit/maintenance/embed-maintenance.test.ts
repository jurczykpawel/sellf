// @vitest-environment happy-dom
/**
 * Embedded checkout on a seller's page during maintenance mode: the checkout-session call answers 503
 * and the embed says the shop is down for maintenance (not "could not connect") in the host language.
 * @see src/app/embed/v1/checkout.js/route.ts
 */
import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';
import { GET } from '@/app/embed/v1/checkout.js/route';
vi.mock('@/lib/stripe/publishable-key', () => ({ getStripePublishableKey: () => 'pk_test_fixture' }));
afterEach(() => { document.body.innerHTML = ''; document.documentElement.lang = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  ['pl', 'Sklep ma przerwę techniczną. Wracamy wkrótce.'],
  ['en', 'The shop is down for maintenance. We’ll be back soon.'],
])('the embed shows the maintenance notice in %s and does not start Stripe @J650', async (language, notice) => {
  document.documentElement.lang = language;
  document.body.innerHTML = '<div data-sellf-embed data-product-slug="book"></div>';
  const loader = document.createElement('script'); loader.src = 'https://sellf.test/embed/v1/checkout.js';
  vi.spyOn(document, 'currentScript', 'get').mockReturnValue(loader);
  const stripe = vi.fn();
  Object.assign(window, { Stripe: stripe });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'maintenance', code: 'MAINTENANCE', maintenance: { message: null, expected_end_at: null } }) }));
  new Function(await (await GET()).text())();
  await waitFor(() => expect(document.body.textContent).toContain(notice));
  expect(stripe).not.toHaveBeenCalled();
});
