// @vitest-environment happy-dom
/**
 * U52-4: toggling a webhook after the session expired must not end in a silent/generic failure;
 * it goes through the API client, which refreshes the session or shows "sign in again".
 * @see src/hooks/useWebhooks.ts
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useWebhooks } from '@/hooks/useWebhooks';
import { ApiError } from '@/lib/api/client';
const { update, listAll, toastError, toastSuccess } = vi.hoisted(() => ({ update: vi.fn(), listAll: vi.fn(async () => []), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('@/lib/api/client', async importOriginal => ({ ...await importOriginal<object>(), api: { update, listAll, list: listAll } }));
vi.mock('next-intl', () => { const translate = (key: string) => key; return { useTranslations: () => translate }; });
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('activates an endpoint through the API client', async () => {
  update.mockResolvedValueOnce({});
  const { result } = renderHook(() => useWebhooks());
  await act(async () => { expect(await result.current.setEndpointActive('ep_1', true)).toBe(true); });
  expect(update).toHaveBeenCalledWith('webhooks', 'ep_1', { is_active: true });
  expect(toastSuccess).toHaveBeenCalledWith('statusActivated');
});

it('leaves an expired session to the shared "sign in again" notice instead of a generic error', async () => {
  update.mockRejectedValueOnce(new ApiError('SESSION_EXPIRED', 'Session expired', 401));
  const { result } = renderHook(() => useWebhooks());
  await act(async () => { expect(await result.current.setEndpointActive('ep_1', false)).toBe(false); });
  expect(toastError).not.toHaveBeenCalled();
});

it('reports other failures', async () => {
  update.mockRejectedValueOnce(new ApiError('INTERNAL', 'boom', 500));
  const { result } = renderHook(() => useWebhooks());
  await act(async () => { await result.current.setEndpointActive('ep_1', false); });
  expect(toastError).toHaveBeenCalledWith('statusToggleError');
});
