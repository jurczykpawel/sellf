// @vitest-environment happy-dom
/** Password login feedback. @see components/LoginForm.tsx */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import pl from '@/messages/pl.json';
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ demoMode: false, passwordLoginEnabled: true, oauthProviders: [] }) }));
vi.mock('@/hooks/useCaptcha', () => ({ useCaptcha: () => ({ isLoading: false }) }));
vi.mock('@/components/captcha/CaptchaWidget', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithPassword: async () => ({ error: { code: 'email_not_confirmed', message: 'Email not confirmed' } }) } }) }));
import LoginForm from '@/components/LoginForm';
afterEach(cleanup);
it('explains email confirmation in Polish', async () => {
  const view = render(React.createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, React.createElement(LoginForm)));
  fireEvent.change(view.container.querySelector('#email')!, { target: { value: 'buyer@example.com' } });
  fireEvent.change(view.container.querySelector('#password')!, { target: { value: 'password123' } });
  fireEvent.submit(view.container.querySelector('form')!);
  expect(await screen.findByText('Potwierdź swój adres e-mail, klikając link w otrzymanej wiadomości.')).toBeTruthy();
  expect(screen.queryByText('Email not confirmed')).toBeNull();
});
