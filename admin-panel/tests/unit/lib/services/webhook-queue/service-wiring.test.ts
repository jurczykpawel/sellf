import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchEndpointsMock, dispatchMock, recordFirstAttemptMock, adminClient } = vi.hoisted(() => {
  const fetchEndpointsMock = vi.fn();
  const dispatchMock = vi.fn();
  const recordFirstAttemptMock = vi.fn();
  const adminClient = {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      contains: fetchEndpointsMock,
    })),
  };
  return { fetchEndpointsMock, dispatchMock, recordFirstAttemptMock, adminClient };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminClient,
  createPlatformClient: vi.fn(),
}));

vi.mock('@/lib/services/webhook-queue/dispatcher', () => ({
  WebhookDispatcher: { dispatch: dispatchMock },
}));

vi.mock('@/lib/services/webhook-queue/supabase-queue', () => ({
  SupabaseWebhookQueue: class {
    recordFirstAttempt = recordFirstAttemptMock;
  },
}));

import { WebhookService } from '@/lib/services/webhook-service';

describe('WebhookService.trigger → queue.recordFirstAttempt wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchEndpointsMock.mockResolvedValue({
      data: [{ id: 'ep_1', url: 'https://example.com/h', secret: 'whsec_x' }],
      error: null,
    });
    dispatchMock.mockResolvedValue({
      ok: false,
      httpStatus: 503,
      responseBody: 'down',
      errorMessage: 'HTTP 503',
      durationMs: 22,
    });
    recordFirstAttemptMock.mockResolvedValue({ deliveryId: 'log_1', willRetry: true });
  });

  it('dispatches once per active endpoint and records via queue.recordFirstAttempt', async () => {
    await WebhookService.trigger('purchase.completed', { foo: 'bar' });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(recordFirstAttemptMock).toHaveBeenCalledTimes(1);
    const [input] = recordFirstAttemptMock.mock.calls[0];
    expect(input.endpointId).toBe('ep_1');
    expect(input.eventType).toBe('purchase.completed');
    expect(input.result.ok).toBe(false);
    expect(input.result.httpStatus).toBe(503);
  });

  it('does nothing when no active endpoint matches the event', async () => {
    fetchEndpointsMock.mockResolvedValue({ data: [], error: null });
    await WebhookService.trigger('purchase.completed', {});
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(recordFirstAttemptMock).not.toHaveBeenCalled();
  });

  it('passes attempt count = 1 to the dispatcher on the optimistic first attempt', async () => {
    await WebhookService.trigger('purchase.completed', { foo: 'bar' });
    const [, , , options] = dispatchMock.mock.calls[0];
    expect(options.attemptCount).toBe(1);
  });
});
