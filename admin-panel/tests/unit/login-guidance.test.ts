// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
const state = vi.hoisted(() => ({ locale: 'pl', path: '/pl/affiliates/apply', config: { demoMode: false, passwordLoginEnabled: false, oauthProviders: [] as string[] } }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], state.locale === 'pl' ? pl : en) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams({ redirect_to: state.path }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => state.config }));
vi.mock('@/components/SiteMenu', () => ({ default: () => null }));
vi.mock('@/components/LoginForm', () => ({ default: () => createElement('form', { 'aria-label': 'Login' }) }));
import LoginPage from '@/components/LoginPage';
afterEach(cleanup);
for (const locale of ['en', 'pl'] as const) {
  it.each([
    ['password', { demoMode: false, passwordLoginEnabled: true, oauthProviders: [] }, locale === 'pl' ? /poproś.*sklep/i : /ask.*store/i],
    ['demo', { demoMode: true, passwordLoginEnabled: true, oauthProviders: [] }, locale === 'pl' ? /konta demonstracyjnego/i : /demo account/i],
    ['magic', { demoMode: false, passwordLoginEnabled: false, oauthProviders: [] }, locale === 'pl' ? /konto.*automatycznie/i : /account.*automatically/i],
    ['oauth', { demoMode: false, passwordLoginEnabled: false, oauthProviders: ['google'] }, locale === 'pl' ? /przycisk.*poniżej/i : /button.*below/i],
  ])('%s guidance matches the available form in ' + locale, (_mode, config, guidance) => {
    state.locale = locale; state.config = config; state.path = `/${locale}/affiliates/apply`;
    render(createElement(LoginPage));
    expect(screen.getByText(guidance)).toBeTruthy();
    expect(screen.queryByText(locale === 'pl' ? /Zaloguj się lub utwórz konto Sellf/ : /Sign in or create your Sellf account/)).toBeNull();
  });
  it('uses ordinary login guidance for a product return in ' + locale, () => {
    state.locale = locale; state.config = { demoMode: false, passwordLoginEnabled: true, oauthProviders: [] }; state.path = `/${locale}/p/course`;
    render(createElement(LoginPage, { shopName: 'Pracownia kursów' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pracownia kursów');
    expect(screen.getByText(locale === 'pl' ? 'Zaloguj się, aby uzyskać dostęp do swoich zakupów.' : 'Sign in to access your purchases.')).toBeTruthy();
  });
}
