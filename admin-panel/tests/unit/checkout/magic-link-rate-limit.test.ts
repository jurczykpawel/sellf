// @vitest-environment happy-dom
/** Payment receipt remains visible when access email delivery is limited. */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMagicLink } from '@/app/[locale]/p/[slug]/payment-status/hooks/useMagicLink';
import MagicLinkStatus from '@/app/[locale]/p/[slug]/payment-status/components/MagicLinkStatus';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

vi.mock('@/components/captcha/CaptchaWidget', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const noop = () => {};
const product = { id: 'product', name: 'Course', slug: 'course', price: 100, currency: 'PLN' };

function Fixture() {
  const link = useMagicLink({ paymentStatus: 'magic_link_sent', customerEmail: 'buyer@example.com',
    sessionId: 'session', product, termsAccepted: true, captchaToken: 'solved',
    captchaReset: noop, showInteractiveWarning: false });
  return React.createElement(MagicLinkStatus, { product, customerEmail: 'buyer@example.com',
    magicLinkSent: link.sent, magicLinkError: link.error, termsAccepted: true,
    captchaToken: 'solved', captchaError: null, captchaTimeout: false, showInteractiveWarning: false,
    onTermsAccept: noop, onCaptchaSuccess: noop, onCaptchaError: noop, onCaptchaTimeout: noop,
    onBeforeInteractive: noop, onAfterInteractive: noop, sendMagicLink: link.sendMagicLink });
}

it.each([['en', en], ['pl', pl]] as const)('translates a magic-link 429 and keeps the receipt in %s', async (locale, messages) => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    ok: false, code: 'rate_limited', message: 'Service request quota reached',
  }), { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  const view = render(React.createElement(NextIntlClientProvider, { locale, messages }, React.createElement(Fixture)));
  await waitFor(() => expect(view.getByText(messages.paymentStatus.rateLimitError, { exact: false })).toBeTruthy());
  expect(view.getByText(messages.paymentStatus.purchaseReceipt.replace('{productName}', product.name))).toBeTruthy();
  expect(view.queryByText('Service request quota reached')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe('/api/auth/magic-link');
});
