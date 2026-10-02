import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchEndpointsMock, dispatchMock, enqueueMock, adminClient } = vi.hoisted(() => {
  const fetchEndpointsMock = vi.fn();
  const dispatchMock = vi.fn();
  const enqueueMock = vi.fn();
  const adminClient = {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      contains: fetchEndpointsMock,
    })),
  };
  return { fetchEndpointsMock, dispatchMock, enqueueMock, adminClient };
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
    enqueue = enqueueMock;
    markFailed = vi.fn();
    markDelivered = vi.fn();
  },
}));

import { WebhookService } from '@/lib/services/webhook-service';

describe('WebhookService.trigger → queue.enqueue wiring', () => {
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
    enqueueMock.mockImplementation(async (input) => ({ id: input.deliveryId, payload: input.payload, attemptCount: 0 }));
  });

  it('dispatches once per active endpoint and persists before dispatch', async () => {
    await WebhookService.trigger('purchase.completed', { foo: 'bar' });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const [input] = enqueueMock.mock.calls[0];
    expect(input.endpointId).toBe('ep_1');
    expect(input.eventType).toBe('purchase.completed');
    expect(enqueueMock.mock.invocationCallOrder[0]).toBeLessThan(dispatchMock.mock.invocationCallOrder[0]);
    expect(dispatchMock.mock.calls[0][2].id).toBe(input.deliveryId);
  });

  it('does nothing when no active endpoint matches the event', async () => {
    fetchEndpointsMock.mockResolvedValue({ data: [], error: null });
    await WebhookService.trigger('purchase.completed', {});
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('passes attempt count = 1 to the dispatcher on the optimistic first attempt', async () => {
    await WebhookService.trigger('purchase.completed', { foo: 'bar' });
    const [, , , options] = dispatchMock.mock.calls[0];
    expect(options.attemptCount).toBe(1);
  });
});
