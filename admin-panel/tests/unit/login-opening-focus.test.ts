// @vitest-environment happy-dom

import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '@/app/[locale]/login/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('error=magic_link_expired'),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ demoMode: false }) }));
vi.mock('@/components/SiteMenu', () => ({ default: () => null }));
vi.mock('@/components/LoginForm', () => ({
  default: () => createElement('form', null,
    createElement('input', { id: 'email', 'aria-label': 'Email' }),
    createElement('input', { 'aria-label': 'Other field' }),
  ),
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Login opening focus', () => {
  it('preserves focus when the user has moved to another field', () => {
    render(createElement(LoginPage));
    const other = screen.getByLabelText<HTMLInputElement>('Other field');
    other.focus();
    act(() => vi.advanceTimersByTime(101));
    expect(document.activeElement).toBe(other);
  });

  it('focuses email for a recoverable error when no control is focused', () => {
    render(createElement(LoginPage));
    act(() => vi.advanceTimersByTime(101));
    expect(document.activeElement).toBe(screen.getByLabelText('Email'));
  });

  it('cancels pending focus on unmount', () => {
    const view = render(createElement(LoginPage));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
