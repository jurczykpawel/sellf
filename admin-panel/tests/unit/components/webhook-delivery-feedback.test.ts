// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useWebhooks } from '@/hooks/useWebhooks';
import WebhookLogsDrawer from '@/components/WebhookLogsDrawer';
import WebhookFailuresPanel from '@/components/WebhookFailuresPanel';
import en from '@/messages/en.json';
import type { WebhookEndpoint } from '@/types/webhooks';

const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: mocks }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, children);

describe('webhook delivery feedback', () => {
  it('displays the HTTP status returned by the test endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { success: true, http_status: 202 } }))));
    const { result } = renderHook(useWebhooks, { wrapper });
    await act(async () => { expect(await result.current.testEndpoint('endpoint', 'purchase.completed')).toBe(true); });
    expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining('HTTP 202'));
  });

  it('reports a rejected delivery rather than treating the API response as delivery success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { success: false, http_status: 503, error: 'HTTP 503' } }))));
    const { result } = renderHook(useWebhooks, { wrapper });
    await act(async () => { expect(await result.current.testEndpoint('endpoint', 'purchase.completed')).toBe(false); });
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('opens delivery history with successful test and purchase rows visible', async () => {
    const fetch = vi.fn(async (input: string) => new Response(JSON.stringify({
      data: new URL(input, 'http://localhost').searchParams.get('status') === 'all'
        ? ['test', 'purchase'].map(id => ({ id, event_type: 'purchase.completed', status: 'success', http_status: 200, created_at: '2026-10-17T15:32:00Z', duration_ms: 20 })) : [],
      pagination: { has_more: false, next_cursor: null },
    })));
    vi.stubGlobal('fetch', fetch);
    render(React.createElement(WebhookLogsDrawer, { endpoint: { id: 'endpoint', url: 'https://example.com/hook' } as WebhookEndpoint, isOpen: true, onClose: vi.fn() }), { wrapper });
    await waitFor(() => expect(screen.getAllByText('HTTP 200')).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'Resend', exact: true })).toBeNull();
    expect(new URL(fetch.mock.calls[0][0], 'http://localhost').searchParams.get('endpoint_id')).toBe('endpoint');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'failed' } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('status=all_failed'), expect.anything()));
  });

  it('includes scheduled and exhausted deliveries in the failures panel', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [], pagination: { has_more: false, next_cursor: null } })));
    vi.stubGlobal('fetch', fetch);
    render(React.createElement(WebhookFailuresPanel, { refreshTrigger: 0 }), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('status=all_failed'), expect.anything()));
  });
});
