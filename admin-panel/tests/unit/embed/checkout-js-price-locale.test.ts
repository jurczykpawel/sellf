// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { waitFor } from '@testing-library/react';
import { GET } from '@/app/embed/v1/checkout.js/route';

afterEach(() => {
  vi.restoreAllMocks();
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
