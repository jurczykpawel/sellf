// @vitest-environment happy-dom
/** Login methods by runtime mode. @see components/LoginForm.tsx */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ submit: vi.fn(), password: vi.fn(), captcha: { token: 'solved', isLoading: false }, config: { demoMode: false, passwordLoginEnabled: false, oauthProviders: [] } }));
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => state.config }));
vi.mock('@/lib/auth/magic-link/submit', () => ({ submitMagicLink: state.submit }));
vi.mock('@/lib/supabase/client', () => ({ createClient: async () => ({ auth: { signInWithPassword: state.password } }) }));
vi.mock('@/hooks/useCaptcha', () => ({ useCaptcha: () => state.captcha }));
vi.mock('@/components/captcha/CaptchaWidget', () => ({ default: () => createElement('div', null, 'Captcha') }));
import LoginForm from '@/components/LoginForm';
beforeEach(() => { vi.clearAllMocks(); state.config.demoMode = false; state.config.passwordLoginEnabled = false; state.captcha.isLoading = false; state.submit.mockResolvedValue({ ok: true }); state.password.mockResolvedValue({ error: null }); });
afterEach(cleanup);
it.each(['normal', 'e2e', 'demo'])('shows the expected methods in %s mode', (mode) => {
  state.config.passwordLoginEnabled = mode !== 'normal'; state.config.demoMode = mode === 'demo';
  render(createElement(LoginForm));
  expect(Boolean(screen.queryByLabelText('auth.password'))).toBe(mode !== 'normal');
  expect(Boolean(screen.queryByRole('button', { name: mode === 'e2e' ? 'auth.emailSignInLink' : 'auth.sendMagicLink' }))).toBe(mode !== 'demo');
  expect(Boolean(screen.queryByRole('checkbox'))).toBe(mode !== 'demo');
  expect(Boolean(screen.queryByText('Captcha'))).toBe(mode !== 'demo');
});
it.each([undefined, '/pl/affiliates/apply'])('requires consent and sends a link without a password (destination %s)', async (redirectTo) => {
  state.config.passwordLoginEnabled = true;
  render(createElement(LoginForm, { redirectTo }));
  fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'buyer@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'auth.emailSignInLink' }));
  expect(await screen.findByText('compliance.pleaseAcceptTerms')).toBeTruthy();
  expect(state.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'auth.emailSignInLink' }));
  await waitFor(() => expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({ email: 'buyer@example.com', captcha: state.captcha, flow: 'login', ...(redirectTo ? { redirectTo } : {}) })));
  expect(state.password).not.toHaveBeenCalled();
});
it('keeps password login as the default without consent or captcha readiness', async () => {
  state.config.passwordLoginEnabled = true; state.captcha.isLoading = true;
  const view = render(createElement(LoginForm));
  fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'buyer@example.com' } });
  fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: 'password123' } });
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(state.password).toHaveBeenCalledWith({ email: 'buyer@example.com', password: 'password123' }));
  expect(state.submit).not.toHaveBeenCalled();
});
it('does not send a link for an invalid email', () => {
  state.config.passwordLoginEnabled = true;
  render(createElement(LoginForm));
  fireEvent.change(screen.getByLabelText('auth.email'), { target: { value: 'invalid' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'auth.emailSignInLink' }));
  expect(state.submit).not.toHaveBeenCalled();
});
it('waits for captcha readiness before offering the email action', () => {
  state.config.passwordLoginEnabled = true; state.captcha.isLoading = true;
  render(createElement(LoginForm));
  expect((screen.getByRole('button', { name: 'auth.emailSignInLink' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'auth.signIn' }) as HTMLButtonElement).disabled).toBe(false);
});
it('rejects email longer than 254 beside the field before either login method', async () => {
  state.config.passwordLoginEnabled = true;
  render(createElement(LoginForm));
  const input = screen.getByLabelText('auth.email') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'a'.repeat(243) + '@example.com' } });
  fireEvent.submit(input.closest('form')!);
  expect(await screen.findByText('auth.emailTooLong')).toBeTruthy();
  expect(input.maxLength).toBe(254);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(state.password).not.toHaveBeenCalled();
  expect(state.submit).not.toHaveBeenCalled();
});
it('accepts a 254-character email after correcting an overlong email', async () => {
  state.config.passwordLoginEnabled = true;
  render(createElement(LoginForm));
  const input = screen.getByLabelText('auth.email');
  fireEvent.change(input, { target: { value: 'a'.repeat(243) + '@example.com' } });
  fireEvent.submit(input.closest('form')!);
  expect(screen.getByText('auth.emailTooLong')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: 'password123' } });
  const email = 'a'.repeat(242) + '@example.com';
  fireEvent.change(input, { target: { value: email } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(state.password).toHaveBeenCalledWith({ email, password: 'password123' }));
  expect(screen.queryByText('auth.emailTooLong')).toBeNull();
});
