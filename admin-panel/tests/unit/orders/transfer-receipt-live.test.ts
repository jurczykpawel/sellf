// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import TransferStatusRefresh from '@/components/checkout/TransferStatusRefresh';
afterEach(() => { cleanup(); vi.useRealTimers(); refresh.mockClear(); });
it('refreshes exactly at the reservation deadline and follows external cancellation', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
  const view = render(createElement(TransferStatusRefresh, { status: 'awaiting_payment', releaseAt: '2026-11-19T12:00:02Z' }));
  vi.advanceTimersByTime(1999); expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(15000); expect(refresh.mock.calls.length).toBeGreaterThan(1);
  view.rerender(createElement(TransferStatusRefresh, { status: 'cancelled', releaseAt: null }));
  refresh.mockClear(); vi.advanceTimersByTime(30000); expect(refresh).not.toHaveBeenCalled();
});
