// @vitest-environment happy-dom
/** Offer decline keeps the original buyer destination. @see components/checkout-templates/OtoDeclineButton.tsx */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ query: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ locale: 'pl' }), useSearchParams: () => state.query }));
vi.mock('next-intl', () => ({ useTranslations: () => () => 'No thanks' }));
import OtoDeclineButton from '@/components/checkout-templates/OtoDeclineButton';
afterEach(cleanup);
it('forwards purchase status through downsell and returns there on final decline', () => {
  const original = '/pl/p/guide/payment-status?session_id=cs_test_order&offer_declined=1';
  state.query = new URLSearchParams({ oto: '1', downsell_slug: 'toolkit', downsell_coupon: 'SAVE', purchase_return: original });
  const view = render(React.createElement(OtoDeclineButton));
  const url = new URL(screen.getByRole('link').getAttribute('href')!, 'http://localhost');
  expect(url.pathname).toBe('/pl/checkout/toolkit');
  expect(url.searchParams.get('purchase_return')).toBe(original);
  state.query = url.searchParams;
  view.rerender(React.createElement(OtoDeclineButton));
  expect(screen.getByRole('link').getAttribute('href')).toBe(original);
});
it('uses the standard destination for an unrelated origin', () => {
  state.query = new URLSearchParams({ oto: '1', purchase_return: 'https://other.test/page' });
  render(React.createElement(OtoDeclineButton));
  expect(screen.getByRole('link').getAttribute('href')).toBe('/pl/my-products');
});
