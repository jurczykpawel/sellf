// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import WebhookLogsTable from '@/components/webhooks/WebhookLogsTable';
import type { WebhookLog } from '@/types/webhooks';
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
afterEach(cleanup);
it('offers a stable disclosure button for each delivery', () => {
  const log: WebhookLog = { id: 'delivery', endpoint_id: 'endpoint', event_type: 'test.event', status: 'success', http_status: 200, payload: { value: 'Payload contents' }, response_body: 'OK', duration_ms: 1, attempt_count: 1, max_attempts: 3, next_retry_at: null, failed_permanently_at: null, created_at: '2026-01-01T00:00:00Z' };
  render(createElement(WebhookLogsTable, { logs: [log], onRetry: vi.fn(), retryingId: null }));
  const button = screen.getByRole('button', { name: /test.event/ });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  button.focus(); fireEvent.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(button.getAttribute('aria-controls')!)?.textContent).toContain('Payload contents');
  fireEvent.click(button); expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(button);
});
