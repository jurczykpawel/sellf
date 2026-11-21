// @vitest-environment happy-dom
import React, { createElement } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), signOut: vi.fn(), resolveRole: vi.fn() }));
vi.mock('@/lib/auth/resolve-role', () => ({ resolveUserRole: mocks.resolveRole }));
vi.mock('@/lib/supabase/client', () => ({ createClient: async () => ({ auth: {
  getSession: async () => ({ data: { session: { user: { id: 'buyer' } } }, error: null }),
  getUser: mocks.getUser, signOut: mocks.signOut,
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
} }) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it.each([0, 503, 429])('keeps the session after a temporary user read failure (%i)', async status => {
  vi.stubGlobal('React', React);
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: status === 429 ? new AuthApiError('Read limit', 429) : new AuthRetryableFetchError('Temporary service failure', status) });
  mocks.resolveRole.mockResolvedValue('user');
  const { result } = renderHook(useAuth, { wrapper: ({ children }) => createElement(AuthProvider, null, children) });
  await act(async () => {});
  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(result.current.user?.id).toBe('buyer');
});

it('clears a session whose user was deleted', async () => {
  vi.stubGlobal('React', React);
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError('User not found', 403, 'user_not_found') });
  const { result } = renderHook(useAuth, { wrapper: ({ children }) => createElement(AuthProvider, null, children) });
  await act(async () => {});
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(result.current.user).toBeNull();
});

it('does not sign out from an initialization that already unmounted', async () => {
  vi.stubGlobal('React', React);
  let finish!: (value: unknown) => void;
  mocks.getUser.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = renderHook(useAuth, { wrapper: ({ children }) => createElement(AuthProvider, null, children) });
  await act(async () => {});
  view.unmount();
  await act(async () => { finish({ data: { user: null }, error: new AuthApiError('User not found', 403, 'user_not_found') }); });
  expect(mocks.signOut).not.toHaveBeenCalled();
});
