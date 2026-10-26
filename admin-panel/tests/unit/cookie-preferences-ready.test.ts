// @vitest-environment happy-dom
/** Footer clicks wait for consent initialization. @see components/CookiePreferences.tsx */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CookiePreferences from '@/components/CookiePreferences';
import { markCookieConsentReady } from '@/lib/tracking/consent-ready';

const consent = vi.hoisted(() => ({ showPreferences: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/p/example' }));
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
