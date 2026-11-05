// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Product } from '@/types';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ captcha: { provider: 'none' } }) }));
vi.mock('@/components/checkout/CustomCheckoutFieldsForm', () => ({ default: () => null }));
import BankTransferForm from '@/components/checkout/BankTransferForm';
afterEach(cleanup);
it('uses the configured captcha provider so an unconfigured development checkout can submit', async () => {
  render(createElement(BankTransferForm, {
    collectTermsOfService: false, termsAccepted: false, onTermsAcceptedChange: vi.fn(), disabled: false,
    onModuleErrors: vi.fn(), product: { id: 'p', currency: 'PLN' } as Product, email: 'buyer@example.com', onEmailChange: vi.fn(),
    moduleValues: {}, sessionId: null, bumpIds: [], fields: [], values: {}, onValuesChange: vi.fn(),
  }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'placeOrder' }) as HTMLButtonElement).disabled).toBe(false));
});
