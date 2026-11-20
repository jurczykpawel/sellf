// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/pl/order/test/transfer' }));
vi.mock('@/components/providers/tracking-config-provider', () => ({ useTrackingConfig: () => ({ cookie_consent_enabled: true }) }));
import CookiePreferences, { BuyerCookieFooter } from '@/components/CookiePreferences';
afterEach(cleanup);
it('removes buyer cookie controls and their footer from print layout', () => {
  const { container } = render(createElement(BuyerCookieFooter));
  expect(container.querySelector('footer')?.classList.contains('print:hidden')).toBe(true);
  expect(screen.getByRole('button').classList.contains('print:hidden')).toBe(true);
});
it('also hides the shared preferences button when placed outside the buyer footer', () => {
  render(createElement(CookiePreferences, { locale: 'pl' }));
  expect(screen.getByRole('button').classList.contains('print:hidden')).toBe(true);
});
