// @vitest-environment happy-dom
/** Embedded checkout uses the host language throughout. @see app/embed/v1/checkout.js/route.ts */
import { afterEach, expect, it, vi } from 'vitest';
import { waitFor, fireEvent } from '@testing-library/dom';
import { GET } from '@/app/embed/v1/checkout.js/route';
vi.mock('@/lib/stripe/publishable-key', () => ({ getStripePublishableKey: () => 'pk_test_fixture' }));
afterEach(() => { document.body.innerHTML = ''; document.documentElement.lang = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([['pl', '', 'en-US', 'pl'], ['pl', 'en', 'pl-PL', 'en'], ['', '', 'pl-PL', 'pl']])('resolves page %s and snippet %s before browser %s', async (page, snippet, browser, expected) => {
  document.documentElement.lang = page;
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(browser);
  document.body.innerHTML = `<div data-sellf-embed data-product-slug="book" lang="${snippet}"></div>`;
  const loader = document.createElement('script'); loader.src = 'https://sellf.test/embed/v1/checkout.js';
  vi.spyOn(document, 'currentScript', 'get').mockReturnValue(loader);
  const stripe = vi.fn(() => ({ initEmbeddedCheckout: async () => ({ mount() {} }) }));
  Object.assign(window, { Stripe: stripe });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ kind: 'paid', clientSecret: 'secret' }) }));
  new Function(await (await GET()).text())();
  await waitFor(() => expect(stripe).toHaveBeenCalledWith('pk_test_fixture', { locale: expected }));
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).locale).toBe(expected);
  const field = document.querySelector('input')!;
  expect(field.getAttribute('aria-label')).toBe(expected === 'pl' ? 'Kod kuponu' : 'Coupon code');
  await waitFor(() => expect((document.querySelector('button') as HTMLButtonElement).disabled).toBe(false));
  vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
  fireEvent.input(field, { target: { value: 'SAVE' } });
  fireEvent.submit(field.closest('form')!);
  await waitFor(() => expect(document.querySelector('[role=status]')?.textContent).toBe(expected === 'pl' ? 'Nie udało się połączyć. Spróbuj ponownie.' : 'Could not connect. Please try again.'));
});
