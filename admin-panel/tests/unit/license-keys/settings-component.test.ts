// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
const mock = vi.hoisted(() => ({ upload: vi.fn(), locale: 'pl' }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => ((mock.locale === 'pl' ? pl : en).settings.licenseKeys as Record<string, unknown>)[key] ?? key }));
vi.mock('@/lib/actions/license-config', () => ({ getSellerLicenseInfo: async () => ({ success: true, data: null }), generateSellerLicenseKey: vi.fn(), uploadSellerLicenseKey: mock.upload }));
vi.mock('@/components/settings/LicenseHowToUseModal', () => ({ default: () => null }));
import LicenseKeysSettings from '@/components/settings/LicenseKeysSettings';
afterEach(cleanup);
it.each(['pl', 'en'])('shows invalid imported key beside its field in %s', async locale => {
  mock.locale = locale;
  mock.upload.mockResolvedValue({ success: false, errorCode: 'INVALID_KEY', error: 'Invalid private key' });
  const copy = (locale === 'pl' ? pl : en).settings.licenseKeys;
  render(createElement(LicenseKeysSettings));
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: copy.upload }));
  const input = screen.getByLabelText(copy.uploadLabel);
  fireEvent.change(input, { target: { value: 'not a private key' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: copy.save })));
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toMatch(locale === 'pl' ? /Wklej klucz prywatny/ : /Paste an EC P-256 private key/);
  expect(document.activeElement).toBe(input);
});
