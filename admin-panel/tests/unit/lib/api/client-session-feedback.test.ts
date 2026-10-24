// @vitest-environment happy-dom
/**
 * Quiet cancellation and shared session feedback.
 * @see src/hooks/useWebhooks.ts
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useWebhooks } from '@/hooks/useWebhooks';
import { useWebhookDeliveries } from '@/hooks/useWebhookDeliveries';
import { ApiError } from '@/lib/api/client';
const { listAll, toastError } = vi.hoisted(() => ({ listAll: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/api/client', async importOriginal => ({ ...await importOriginal<object>(), api: { listAll, list: listAll } }));
vi.mock('next-intl', () => { const translate = (key: string) => key; return { useTranslations: () => translate }; });
vi.mock('sonner', () => ({ toast: { error: toastError } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); toastError.mockClear(); });

it.each([new DOMException('Cancelled', 'AbortError'), new ApiError('SESSION_EXPIRED', 'Session expired', 401)])('does not log or replace shared feedback for %s', async error => {
  listAll.mockRejectedValueOnce(error);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { result } = renderHook(() => useWebhooks());
  await act(() => result.current.fetchEndpoints());
  expect(result.current.loading).toBe(false);
  expect(log).not.toHaveBeenCalled();
  expect(toastError).not.toHaveBeenCalled();
});

it('does not log a webhook list request completed after unmount', async () => {
  let reject!: (error: Error) => void;
  listAll.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { result, unmount } = renderHook(() => useWebhooks());
  const request = result.current.fetchEndpoints();
  unmount();
  await act(async () => { reject(new TypeError('Failed to fetch')); await request; });
  expect(log).not.toHaveBeenCalled();
  expect(toastError).not.toHaveBeenCalled();
});

it.each([new DOMException('Cancelled', 'AbortError'), new ApiError('SESSION_EXPIRED', 'Session expired', 401)])('does not log delivery list cancellation or expiry: %s', async error => {
  listAll.mockRejectedValueOnce(error);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { renderHook(() => useWebhookDeliveries()); });
  expect(log).not.toHaveBeenCalled();
  expect(toastError).not.toHaveBeenCalled();
});

it('does not log a delivery list request completed after unmount', async () => {
  let reject!: (error: Error) => void;
  listAll.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { unmount } = renderHook(() => useWebhookDeliveries());
  unmount();
  await act(async () => { reject(new TypeError('Failed to fetch')); });
  expect(log).not.toHaveBeenCalled();
  expect(toastError).not.toHaveBeenCalled();
});
