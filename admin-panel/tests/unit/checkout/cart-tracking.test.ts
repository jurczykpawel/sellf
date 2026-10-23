// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCartTracking } from '@/hooks/useCartTracking';
import { trackEvent } from '@/lib/tracking/client';
import { CONSENT_COOKIE_NAME } from '@/lib/constants';

const data = { currency: 'PLN', value: 162, items: [
  { item_id: 'main', item_name: 'Workshop', price: 49, quantity: 3 },
  { item_id: 'bump', item_name: 'Book', price: 15, quantity: 1 },
] };
it('sends add_to_cart once on entry to payment with quantity and bumps', () => {
  const track = vi.fn();
  const view = renderHook(({ started }) => useCartTracking(started, data, track), { initialProps: { started: false } });
  expect(track).not.toHaveBeenCalled();
  view.rerender({ started: true });
  view.rerender({ started: false });
  view.rerender({ started: true });
  expect(track).toHaveBeenCalledExactlyOnceWith('add_to_cart', data);
});
it('uses analytics consent for dataLayer and never emits an undefined Facebook event', async () => {
  window.dataLayer = []; window.fbq = vi.fn();
  const config = { gtmEnabled: true, fbPixelEnabled: true, fbCAPIEnabled: false };
  document.cookie = `${CONSENT_COOKIE_NAME}=; max-age=0; path=/`;
  await trackEvent('add_to_cart', data, config);
  expect(window.dataLayer).toEqual([]);
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(JSON.stringify({ services: { analytics: ['gtm'], marketing: ['pixel'] } }))}; path=/`;
  await trackEvent('add_to_cart', data, config);
  expect(window.dataLayer).toContainEqual(expect.objectContaining({ event: 'add_to_cart', ecommerce: expect.objectContaining(data) }));
  expect(window.fbq).not.toHaveBeenCalled();
  document.cookie = `${CONSENT_COOKIE_NAME}=; max-age=0; path=/`;
});
