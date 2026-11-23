// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const error = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error } }));
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
import SessionExpiryNotice from '@/components/SessionExpiryNotice';
afterEach(() => { cleanup(); error.mockClear(); window.history.replaceState(null, '', '/'); });
it('explains a consumed Auth link returned in a fragment without displaying provider text', () => {
  window.history.replaceState(null, '', '/#error=access_denied&error_code=otp_expired&error_description=provider-text');
  render(createElement(SessionExpiryNotice));
  expect(error).toHaveBeenCalledWith('magicLinkExpired', expect.objectContaining({ duration: Infinity }));
  const options = error.mock.calls[0][1];
  expect(options.description.props.href).toBe('/pl/login?error=magic_link_expired');
  expect(window.location.hash).toBe('');
});
it('leaves ordinary fragments untouched', () => {
  window.history.replaceState(null, '', '/#catalogue'); render(createElement(SessionExpiryNotice));
  expect(error).not.toHaveBeenCalled(); expect(window.location.hash).toBe('#catalogue');
});
