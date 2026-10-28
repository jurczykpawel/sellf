// @vitest-environment happy-dom
/** Footer clicks wait for consent initialization. @see components/CookiePreferences.tsx */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CookiePreferences, { BuyerCookieFooter } from '@/components/CookiePreferences';
import { markCookieConsentReady } from '@/lib/tracking/consent-ready';

const route = vi.hoisted(() => ({ pathname: '/p/example' }));
const consent = vi.hoisted(() => ({ showPreferences: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('@/components/providers/tracking-config-provider', () => ({
  useTrackingConfig: () => ({ cookie_consent_enabled: true }),
}));
vi.mock('vanilla-cookieconsent', () => consent);

afterEach(cleanup);

it('opens preferences after initialization when clicked before it finishes', async () => {
  render(createElement(CookiePreferences, { locale: 'en' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cookie preferences' }));
  // Flush the dynamic import while initialization is still pending.
  await import('vanilla-cookieconsent');
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(consent.showPreferences).not.toHaveBeenCalled();

  markCookieConsentReady();
  await waitFor(() => expect(consent.showPreferences).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole('button', { name: 'Cookie preferences' }));
  await waitFor(() => expect(consent.showPreferences).toHaveBeenCalledTimes(2));
});

it.each(['/offer/example', '/pl/offer/example', '/en/offer/example'])('uses the offer footer at %s', pathname => {
  route.pathname = pathname;
  const { container } = render(createElement(BuyerCookieFooter));
  expect(container.querySelector('footer')).toBeNull();
});
it.each(['/pl/p/example', '/pl/login'])('keeps the buyer footer at %s', pathname => {
  route.pathname = pathname;
  render(createElement(BuyerCookieFooter));
  expect(screen.getByRole('button', { name: 'Preferencje ciasteczek' })).toBeTruthy();
});
