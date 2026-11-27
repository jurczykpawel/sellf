// @vitest-environment happy-dom
/**
 * Webhook list: each row action names its webhook, and a webhook that cannot be loaded for
 * editing is reported with a specific message in the panel language.
 *
 * @see src/components/webhooks/WebhookListTable.tsx
 * @see src/components/WebhooksPageContent.tsx
 */
import React, { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import WebhooksPageContent from '@/components/WebhooksPageContent';
import { ApiError } from '@/lib/api/client';
import type { WebhookEndpoint } from '@/types/webhooks';

const mocks = vi.hoisted(() => ({ get: vi.fn(), toastError: vi.fn(), endpoints: [] as unknown[] }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));
vi.mock('@/lib/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/client')>()), api: { get: mocks.get } }));
vi.mock('@/hooks/useWebhooks', () => ({
  useWebhooks: () => ({ endpoints: mocks.endpoints, loading: false, submitting: false, fetchEndpoints: vi.fn(), createEndpoint: vi.fn(),
    updateEndpoint: vi.fn(), deleteEndpoint: vi.fn(), setEndpointActive: vi.fn(), testEndpoint: vi.fn() }),
}));
vi.mock('@/components/webhooks/AbandonedEventsPanel', () => ({ default: () => null }));
vi.mock('@/components/WebhookFailuresPanel', () => ({ default: () => null }));
vi.mock('@/components/WebhookLogsDrawer', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

const endpoint = (id: string, description: string | null, url: string) =>
  ({ id, description, url, events: ['purchase.completed'], is_active: true, secret: 'whsec_x', created_at: '2026-11-01T00:00:00Z' }) as unknown as WebhookEndpoint;
const messages = { en, pl } as const;
const show = (locale: 'en' | 'pl') => render(createElement(NextIntlClientProvider, { locale, messages: messages[locale] as never, onError: () => {} },
  createElement(WebhooksPageContent)));

beforeEach(() => {
  vi.stubGlobal('React', React);
  mocks.endpoints = [endpoint('w1', 'CRM sync', 'https://crm.example/hook'), endpoint('w2', null, 'https://n8n.example/hook')];
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it.each([
  ['pl', ['Edytuj CRM sync', 'Usuń CRM sync', 'Wyślij Test CRM sync', 'Logi CRM sync', 'Edytuj https://n8n.example/hook']],
  ['en', ['Edit CRM sync', 'Delete CRM sync', 'Send Test CRM sync', 'Logs CRM sync', 'Edit https://n8n.example/hook']],
] as const)('row actions carry the webhook name (%s)', (locale, names) => {
  const view = show(locale);
  for (const name of names) expect(view.getByRole('button', { name })).toBeTruthy();
});

it.each([
  ['pl', 'Nie udało się wczytać webhooka. Spróbuj ponownie.'],
  ['en', 'Could not load the webhook. Try again.'],
] as const)('a webhook that cannot be loaded is reported specifically (%s)', async (locale, text) => {
  mocks.get.mockRejectedValue(new ApiError('NOT_FOUND', 'Webhook not found', 404));
  const view = show(locale);
  await act(async () => { fireEvent.click(view.getByRole('button', { name: locale === 'pl' ? 'Edytuj CRM sync' : 'Edit CRM sync' })); });
  expect(mocks.toastError).toHaveBeenCalledWith(text);
});
