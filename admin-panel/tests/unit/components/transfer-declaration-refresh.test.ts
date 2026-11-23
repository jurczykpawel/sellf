// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
import TransferDeclaration from '@/components/checkout/TransferDeclaration';
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it.each([false, true])('refreshes the receipt after a successful declaration (late=%s)', async afterDeadline => {
  const fetcher = vi.fn(async () => Response.json({ declaredAt: '2026-11-23T12:00:00Z', releaseAt: afterDeadline ? null : '2026-11-26T12:00:00Z', afterDeadline }));
  vi.stubGlobal('fetch', fetcher);
  render(createElement(TransferDeclaration, { orderId: 'order', token: 'token', declaredAt: null }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'declareButton' })); });
  expect(refresh).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button')).toBeNull();
});
it('keeps the receipt and retry available when declaration fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 500 })));
  render(createElement(TransferDeclaration, { orderId: 'order', token: 'token', declaredAt: null }));
  await act(async () => { fireEvent.click(screen.getByRole('button')); });
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('declareError');
});
