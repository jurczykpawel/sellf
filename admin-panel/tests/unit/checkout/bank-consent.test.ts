// @vitest-environment happy-dom
/** Both payment methods follow the same configured guest-consent rule. */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BankTransferForm from '@/components/checkout/BankTransferForm';
import en from '@/messages/en.json';
import type { Product } from '@/types';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useCaptcha', () => ({ useCaptcha: () => ({ token: 'solved', onVerify: vi.fn(), onError: vi.fn(), onTimeout: vi.fn() }) }));
vi.mock('@/components/captcha/CaptchaWidget', () => ({ default: () => null }));
afterEach(cleanup);
it.each([[true, true, true], [true, false, false], [false, true, false], [false, false, false]])
  ('collects consent only when required (collect=%s guest=%s)', (collectTermsOfService, isGuest, visible) => {
    const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(BankTransferForm, {
      collectTermsOfService, isGuest, termsAccepted: false, onTermsAcceptedChange: vi.fn(), disabled: false, onModuleErrors: vi.fn(), product: { id: 'product', currency: 'PLN' } as Product,
      email: 'prefilled@example.com', lockedEmail: !isGuest, onEmailChange: vi.fn(), moduleValues: {}, sessionId: null, bumpIds: [], fields: [], values: {}, onValuesChange: vi.fn(),
    })));
    expect(!!view.queryByRole('checkbox')).toBe(visible);
    expect((view.getByRole('button') as HTMLButtonElement).disabled).toBe(visible);
  });

it('uses the accepted consent supplied by the shared checkout when switching methods', () => {
  const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(BankTransferForm, {
    collectTermsOfService: true, isGuest: true, termsAccepted: true, onTermsAcceptedChange: vi.fn(), disabled: false, onModuleErrors: vi.fn(), product: { id: 'product', currency: 'PLN' } as Product,
    email: 'buyer@example.com', onEmailChange: vi.fn(), moduleValues: {}, sessionId: null, bumpIds: [], fields: [], values: {}, onValuesChange: vi.fn(),
  })));
  expect((view.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect((view.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
});
