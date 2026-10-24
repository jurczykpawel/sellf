// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import RecentActivity from '@/components/RecentActivity';
import { getRecentActivity } from '@/lib/actions/dashboard';

vi.mock('@/lib/actions/dashboard', () => ({ getRecentActivity: vi.fn() }));
const fetchActivity = vi.mocked(getRecentActivity);
const mount = () => render(createElement(NextIntlClientProvider, { locale: 'en', messages: en }, createElement(RecentActivity)));
beforeEach(() => vi.clearAllMocks());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('retries a network failure once and renders the recovered activity', async () => {
  fetchActivity.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ accessGrants: [], recentProducts: [{ id: 'p', name: 'Course', created_at: '2026-01-01T00:00:00Z' }] } as never);
  mount();
  await waitFor(() => expect(screen.getByText('New product created: Course')).toBeTruthy());
  expect(fetchActivity).toHaveBeenCalledTimes(2);
});

it('shows a message after two network failures', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchActivity.mockRejectedValue(new TypeError('Failed to fetch'));
  mount();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not load activity'));
  expect(fetchActivity).toHaveBeenCalledTimes(2);
});

it('does not retry or log an aborted request', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchActivity.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
  mount();
  await waitFor(() => expect(screen.getByText('No recent activity')).toBeTruthy());
  expect(fetchActivity).toHaveBeenCalledTimes(1);
  expect(log).not.toHaveBeenCalled();
});

it('ignores a rejected request after unmount', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let reject!: (error: Error) => void;
  fetchActivity.mockReturnValue(new Promise((_, rejectPromise) => { reject = rejectPromise; }));
  const view = mount();
  view.unmount();
  await act(async () => reject(new TypeError('Failed to fetch')));
  expect(fetchActivity).toHaveBeenCalledTimes(1);
  expect(log).not.toHaveBeenCalled();
});
