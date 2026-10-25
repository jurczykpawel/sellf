// @vitest-environment happy-dom
/**
 * An expired session is announced once, by SessionExpiryNotice, never by the caller.
 * @see src/lib/api/client.ts
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useWebhooks } from '@/hooks/useWebhooks';
import { ApiError } from '@/lib/api/client';
const { remove, create, update, post, toastError } = vi.hoisted(() => ({ remove: vi.fn(), create: vi.fn(), update: vi.fn(), post: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/api/client', async importOriginal => ({ ...await importOriginal<object>(), api: { delete: remove, create, update, postCustom: post, listAll: vi.fn() } }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));
afterEach(() => { cleanup(); toastError.mockClear(); });

const expired = () => new ApiError('SESSION_EXPIRED', 'Session expired — sign in again', 401);

it.each([
  ['deleteEndpoint', remove, (h: ReturnType<typeof useWebhooks>) => h.deleteEndpoint('1')],
  ['createEndpoint', create, (h: ReturnType<typeof useWebhooks>) => h.createEndpoint({})],
  ['updateEndpoint', update, (h: ReturnType<typeof useWebhooks>) => h.updateEndpoint('1', {})],
  ['testEndpoint', post, (h: ReturnType<typeof useWebhooks>) => h.testEndpoint('1', 'x')],
])('%s shows no toast of its own on SESSION_EXPIRED', async (_name, mock, run) => {
  mock.mockRejectedValueOnce(expired());
  const { result } = renderHook(() => useWebhooks());
  await act(async () => { expect(await run(result.current)).toBe(false); });
  expect(toastError).not.toHaveBeenCalled();
});
