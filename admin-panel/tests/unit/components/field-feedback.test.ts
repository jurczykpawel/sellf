// @vitest-environment happy-dom
/** Field feedback prevents invalid submissions. */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';
import type { Product } from '@/types';
const mocks = vi.hoisted(() => ({ submit: vi.fn(), fetchProducts: vi.fn(), track: vi.fn() }));
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useRouter: () => ({}), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isAdmin: false }) }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ oauthProviders: [], siteUrl: 'http://localhost' }) }));
vi.mock('@/hooks/useTracking', () => ({ useTracking: () => ({ track: mocks.track }) }));
vi.mock('@/hooks/useOto', () => ({ useOto: () => ({}) }));
vi.mock('@/hooks/useCheckoutRedirect', () => ({ useCheckoutRedirect: () => ({ hasAccess: false }) }));
vi.mock('@/hooks/useCaptcha', () => ({ useCaptcha: () => ({ token: 'solved', isLoading: false }) }));
vi.mock('@/components/captcha/CaptchaWidget', () => ({ default: () => null }));
vi.mock('@/app/[locale]/checkout/[slug]/components/ProductShowcase', () => ({ default: () => null }));
vi.mock('@/lib/auth/magic-link/submit', () => ({ submitMagicLink: mocks.submit }));
vi.mock('@/hooks/useProducts', () => ({ useProductsDropdown: () => ({ products: [], loading: false, fetchProducts: mocks.fetchProducts }) }));
vi.mock('@/components/ui/Modal', () => ({
  BaseModal: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
  ModalHeader: () => null,
  ModalBody: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
  ModalFooter: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
  Button: ({ children }: { children: React.ReactNode }) => createElement('button', null, children),
}));
import FreeProductForm from '@/app/[locale]/checkout/[slug]/components/FreeProductForm';
import WebhookFormModal from '@/components/webhooks/WebhookFormModal';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('rejects a free-product email over 254 beside the email input', () => {
  render(createElement(FreeProductForm, { product: { id: 'free', slug: 'free', currency: 'PLN' } as Product, collectTermsOfService: false }));
  const email = screen.getByLabelText('emailAddress') as HTMLInputElement;
  fireEvent.change(email, { target: { value: 'a'.repeat(243) + '@example.com' } });
  fireEvent.submit(email.closest('form')!);
  expect(screen.getByText('emailTooLong')).toBeTruthy();
  expect(email.maxLength).toBe(254);
  expect(email.getAttribute('aria-invalid')).toBe('true');
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('reports description and missing events together and submits after correction', () => {
  const submit = vi.fn();
  const view = render(createElement(WebhookFormModal, { isOpen: true, onClose: vi.fn(), onSubmit: submit, editingEndpoint: null, isSubmitting: false, onSecretRotated: vi.fn() }));
  const description = screen.getByPlaceholderText('descriptionPlaceholder');
  fireEvent.change(screen.getByPlaceholderText('urlPlaceholder'), { target: { value: 'https://example.com/hook' } });
  fireEvent.change(description, { target: { value: 'x'.repeat(501) } });
  fireEvent.submit(view.container.querySelector('form')!);
  expect(screen.getByText('descriptionTooLong')).toBeTruthy();
  expect(screen.getByText('eventsRequired')).toBeTruthy();
  expect(description.getAttribute('aria-invalid')).toBe('true');
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(description, { target: { value: 'Valid' } });
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  fireEvent.submit(view.container.querySelector('form')!);
  expect(submit).toHaveBeenCalledOnce();
  expect(screen.queryByText('descriptionTooLong')).toBeNull();
  expect(screen.queryByText('eventsRequired')).toBeNull();
});
it('accepts a 254-character free-product email after correction', async () => {
  mocks.submit.mockResolvedValue({ ok: false, reason: 'rate_limited' });
  render(createElement(FreeProductForm, { product: { id: 'free', slug: 'free', currency: 'PLN' } as Product, collectTermsOfService: false }));
  const email = screen.getByLabelText('emailAddress');
  fireEvent.change(email, { target: { value: 'a'.repeat(243) + '@example.com' } });
  fireEvent.submit(email.closest('form')!);
  const valid = 'a'.repeat(242) + '@example.com';
  fireEvent.change(email, { target: { value: valid } });
  fireEvent.submit(email.closest('form')!);
  expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ email: valid }));
  expect(await screen.findByText('rateLimitError')).toBeTruthy();
  expect(screen.queryByText('emailTooLong')).toBeNull();
});

it('provides Polish and English field feedback', () => {
  for (const messages of [pl, en]) {
    expect(messages.auth.emailTooLong).toContain('254');
    expect(messages.productView.emailTooLong).toContain('254');
    expect(messages.admin.webhooks.descriptionTooLong).toContain('500');
    expect(messages.admin.webhooks.eventsRequired.length).toBeGreaterThan(10);
  }
  expect(pl.admin.webhooks.eventsRequired).toMatch(/Wybierz.*zdarzenie/);
});
