// @vitest-environment happy-dom
/** The navigation can be expanded without hovering and remembers an explicit choice. */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DashboardLayout from '@/components/DashboardLayout';
import en from '@/messages/en.json';
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => React.createElement('a', props, children) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ role: 'user', user: { id: 'buyer', email: 'buyer@example.com' }, loading: false, signOut: vi.fn() }) }));
vi.mock('@/hooks/useUpdateCheck', () => ({ useUpdateCheck: () => ({ showModal: false }) }));
vi.mock('@/components/SiteMenu', () => ({ default: () => null }));
vi.mock('@/components/DemoBanner', () => ({ default: () => null }));
vi.mock('@/components/UpdateNotificationModal', () => ({ default: () => null }));
const saved = new Map<string, string>();
beforeEach(() => {
  saved.clear();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), clear: () => saved.clear() };
  vi.stubGlobal('localStorage', storage);
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup() {
  return render(React.createElement(NextIntlClientProvider, { locale: 'en', timeZone: 'UTC', messages: en }, React.createElement(DashboardLayout, { children: 'Content' })));
}
it('defaults to expanded navigation when no preference exists', async () => {
  const view = setup();
  await waitFor(() => expect(view.container.querySelector('aside')?.style.width).toBe('var(--sf-sidebar-width-expanded)'));
});
it('keeps the expansion control usable while collapsed and persists the change', async () => {
  window.localStorage.setItem('sf_sidebar_pinned', 'false');
  const view = setup();
  const toggle = view.getByRole('button', { name: /Expand navigation|Pin sidebar open/ });
  expect(toggle.style.pointerEvents).not.toBe('none');
  expect(toggle.style.opacity).not.toBe('0');
  fireEvent.click(toggle);
  expect(window.localStorage.getItem('sf_sidebar_pinned')).toBe('true');
  view.unmount();
  const next = setup();
  await waitFor(() => expect(next.container.querySelector('aside')?.style.width).toBe('var(--sf-sidebar-width-expanded)'));
});
