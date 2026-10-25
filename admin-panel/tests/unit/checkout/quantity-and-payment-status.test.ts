// @vitest-environment happy-dom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/pl.json';
import { CheckoutQuantityField } from '@/components/checkout/CheckoutProfileFields';
import MagicLinkStatus from '@/app/[locale]/p/[slug]/payment-status/components/MagicLinkStatus';

vi.mock('@/components/captcha/CaptchaWidget', () => ({ default: () => null }));
afterEach(cleanup);

const wrap = (node: React.ReactElement) => render(React.createElement(NextIntlClientProvider, { locale: 'pl', messages }, node));
const linkProps = {
  product: { id: 'p', slug: 's', name: 'Kurs' } as never, customerEmail: 'a@example.com', magicLinkSent: false, termsAccepted: true,
  captchaToken: 'token', captchaError: null, captchaTimeout: false, showInteractiveWarning: false, magicLinkError: null, retryCountdown: 0, sending: false,
  onTermsAccept: vi.fn(), onCaptchaSuccess: vi.fn(), onCaptchaError: vi.fn(), onCaptchaTimeout: vi.fn(), onBeforeInteractive: vi.fn(), onAfterInteractive: vi.fn(), sendMagicLink: vi.fn(),
};

describe('quantity error message', () => {
  it('states the allowed range', () => {
    wrap(React.createElement(CheckoutQuantityField, { config: { id: 'quantity', min: 1, max: 20, mode: 'checkout' }, value: 'abc', onChange: vi.fn(), invalid: true }));
    expect(screen.getByRole('alert').textContent).toBe(`${messages.checkout.profile.errors.invalid} (1–20)`);
  });
});

describe('payment status after a paid purchase', () => {
  it('does not show a failure icon next to a paid purchase whose link could not be sent', () => {
    wrap(React.createElement(MagicLinkStatus, { ...linkProps, magicLinkError: messages.paymentStatus.paidLinkSendError }));
    const notice = screen.getByText(messages.paymentStatus.paidLinkSendError, { exact: false });
    expect(notice.textContent).not.toContain('❌');
    expect(notice.textContent).toContain('⚠️');
  });
  it('does not show a verification spinner beside the payment confirmation while the link is prepared', () => {
    wrap(React.createElement(MagicLinkStatus, { ...linkProps, captchaToken: null }));
    expect(screen.queryByText(/Trwa weryfikacja/)).toBeNull();
    expect(screen.getByText(messages.paymentStatus.preparingLoginLink)).toBeTruthy();
  });
});
