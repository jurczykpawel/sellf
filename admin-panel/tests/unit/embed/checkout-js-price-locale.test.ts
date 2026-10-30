// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { waitFor } from '@testing-library/react';
import { GET } from '@/app/embed/v1/checkout.js/route';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(window, 'Stripe');
  document.body.innerHTML = '';
  document.documentElement.lang = '';
});

describe('embedded button price locale', () => {
  it.each([
    ['pl', 'en-US', 'PLN', 49, '49,00\u00a0zł'],
    ['en', 'pl-PL', 'PLN', 49, 'PLN\u00a049.00'],
    ['', 'pl-PL', 'PLN', 49, '49,00\u00a0zł'],
    ['en', 'pl-PL', 'JPY', 1500.7, '¥1,501'],
  ])('uses page %s before browser %s for %s', async (pageLocale, browserLocale, currency, price, expected) => {
    document.documentElement.lang = pageLocale;
    document.body.innerHTML = '<div data-sellf-embed data-product-slug="course" data-modal="true" data-show-price="true"></div>';
    const scriptTag = document.createElement('script');
    scriptTag.src = 'https://sellf.example/embed/v1/checkout.js';
    vi.spyOn(document, 'currentScript', 'get').mockReturnValue(scriptTag);
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ kind: 'paid_needs_captcha', product: { price, currency } }),
    });

    const script = await (await GET()).text();
    runInNewContext(script, { document, window, navigator: { language: browserLocale }, URL, fetch });

    await waitFor(() => expect(document.querySelector('button')?.textContent).toContain(expected));
    expect(fetch).toHaveBeenCalledOnce();
  });
});

it.each(['page', 'attribute'])('uses Polish coupon labels from %s', async (source) => {
  vi.stubEnv('STRIPE_PUBLISHABLE_KEY', 'pk_test_example');
  document.documentElement.lang = source === 'page' ? 'pl' : 'en';
  document.body.innerHTML = '<div data-sellf-embed data-product-slug="course" data-coupon="SAVE"></div>';
  if (source === 'attribute') document.querySelector('[data-sellf-embed]')?.setAttribute('lang', 'pl');
  const scriptTag = document.createElement('script');
  scriptTag.src = 'https://sellf.example/embed/v1/checkout.js';
  vi.spyOn(document, 'currentScript', 'get').mockReturnValue(scriptTag);
  Object.defineProperty(window, 'Stripe', { configurable: true, value: () => ({ initEmbeddedCheckout: async () => ({ mount: () => {}, destroy: () => {} }) }) });
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ kind: 'paid', clientSecret: 'secret', publishableKey: 'pk_test', product: { price: 49, currency: 'PLN' } }) });
  runInNewContext(await (await GET()).text(), { document, window, navigator: { language: 'en' }, URL, fetch });
  await waitFor(() => expect(document.querySelector('input')?.placeholder).toBe('Kod kuponu'));
  expect(document.body.innerHTML).toContain('Zastosuj');
  await waitFor(() => expect(document.querySelector('[role=status]')?.textContent).toBe('Zastosowano kupon SAVE.'));
});

it.each(['none', 'query', 'attribute'])('only exposes coupon controls for a supplied code: %s', async source => {
  vi.stubEnv('STRIPE_PUBLISHABLE_KEY', 'pk_test_example');
  window.history.replaceState({}, '', source === 'query' ? '/?coupon=LINK10' : '/');
  document.body.innerHTML = `<div data-sellf-embed data-product-slug="course"${source === 'attribute' ? ' data-coupon="LINK10"' : ''}></div>`;
  const scriptTag = document.createElement('script'); scriptTag.src = 'https://sellf.example/embed/v1/checkout.js';
  vi.spyOn(document, 'currentScript', 'get').mockReturnValue(scriptTag);
  const mount = vi.fn();
  Object.defineProperty(window, 'Stripe', { configurable: true, value: () => ({ initEmbeddedCheckout: async () => ({ mount, destroy: () => {} }) }) });
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ kind: 'paid', clientSecret: 'secret', product: { price: 49, currency: 'PLN' } }) });
  runInNewContext(await (await GET()).text(), { document, window, navigator: { language: 'en' }, URL, fetch });
  await waitFor(() => expect(mount).toHaveBeenCalledOnce());
  expect(!!document.querySelector('input[name=coupon]')).toBe(source !== 'none');
  expect(JSON.parse(fetch.mock.calls[0][1].body).couponCode).toBe(source === 'none' ? undefined : 'LINK10');
  window.history.replaceState({}, '', '/');
});
