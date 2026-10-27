// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ submit: vi.fn(), oauth: vi.fn(), password: vi.fn(), config: { passwordLoginEnabled: false, demoMode: false, oauthProviders: ['google'] } }));
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => mocks.config }));
vi.mock('@/lib/auth/magic-link/submit', () => ({ submitMagicLink: mocks.submit }));
vi.mock('@/lib/supabase/client', () => ({ createClient: async () => ({ auth: { signInWithPassword: mocks.password } }) }));
vi.mock('@/hooks/useCaptcha', () => ({ useCaptcha: () => ({ token: 'solved', isLoading: false }) }));
vi.mock('@/components/captcha/CaptchaWidget', () => ({ default: () => null }));
vi.mock('@/components/TermsCheckbox', () => ({ default: ({ onChange }: { onChange: (value: boolean) => void }) => createElement('input', { type: 'checkbox', 'aria-label': 'Terms', onChange: () => onChange(true) }) }));
vi.mock('@/components/OAuthIconButtons', () => ({ signInWithOAuth: mocks.oauth, OAuthIconButtons: ({ onSignIn }: { onSignIn: (provider: string) => void }) => createElement('button', { type: 'button', onClick: () => onSignIn('google') }, 'Google') }));
import LoginForm from '@/components/LoginForm';
beforeEach(() => { vi.clearAllMocks(); mocks.submit.mockResolvedValue({ ok: true }); mocks.config.passwordLoginEnabled = false; });
afterEach(cleanup);
it('uses the configured magic-link signup and keeps the application destination', async () => {
  render(createElement(LoginForm, { redirectTo: '/pl/affiliates/apply' }));
  fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'new@example.com' } });
  fireEvent.click(screen.getByLabelText('Terms'));
  fireEvent.click(screen.getByRole('button', { name: 'auth.sendMagicLink' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.com', flow: 'login', redirectTo: '/pl/affiliates/apply' })));
});
it('keeps the application destination for configured OAuth', async () => {
  render(createElement(LoginForm, { redirectTo: '/pl/affiliates/apply' }));
  fireEvent.click(screen.getByLabelText('Terms')); fireEvent.click(screen.getByRole('button', { name: 'Google' }));
  await waitFor(() => expect(mocks.oauth).toHaveBeenCalledWith('google', expect.stringContaining('/auth/callback')));
  expect(document.cookie).toContain('sf_oauth_redirect=%2Fpl%2Faffiliates%2Fapply');
});

it('shows a rate-limit retry time after a login request is limited', async () => {
  mocks.submit.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' });
  render(createElement(LoginForm));
  fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'buyer@example.com' } });
  fireEvent.click(screen.getByLabelText('Terms'));
  fireEvent.click(screen.getByRole('button', { name: 'auth.sendMagicLink' }));
  await waitFor(() => expect(screen.getByText('auth.magicLinkRateLimit')).toBeTruthy());
});
