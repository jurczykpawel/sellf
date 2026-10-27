// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FreeProductForm from '@/app/[locale]/checkout/[slug]/components/FreeProductForm';
import type { Product } from '@/types';

vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useRouter: () => ({}), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'buyer@example.com' }, isAdmin: false }) }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ oauthProviders: [], siteUrl: 'http://localhost' }) }));
vi.mock('@/hooks/useTracking', () => ({ useTracking: () => ({ track: vi.fn() }) }));
vi.mock('@/hooks/useOto', () => ({ useOto: () => ({}) }));
vi.mock('@/hooks/useCheckoutRedirect', () => ({ useCheckoutRedirect: () => ({ hasAccess: false }) }));
vi.mock('@/components/captcha/CaptchaWidget', () => ({ default: () => null }));
vi.mock('@/app/[locale]/checkout/[slug]/components/ProductShowcase', () => ({ default: () => null }));
afterEach(cleanup);
it('keeps authenticated free access ready when no captcha widget is mounted', () => {
  const view = render(createElement(FreeProductForm, { product: { id: 'free', slug: 'free', name: 'Free guide', price: 0, currency: 'PLN' } as Product, collectTermsOfService: false }));
  const button = view.getByRole('button', { name: 'getFreeAccess' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  expect(view.queryByText('verifying')).toBeNull();
});
