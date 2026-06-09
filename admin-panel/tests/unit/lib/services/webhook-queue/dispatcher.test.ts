import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('undici', () => ({
  fetch: vi.fn(),
}));
vi.mock('@/lib/security/safe-fetch', () => ({
  getSsrfSafeAgent: vi.fn(() => undefined),
}));
vi.mock('@/lib/validations/webhook', () => ({
  validateWebhookUrlAsync: vi.fn(async () => ({ valid: true })),
}));

import { fetch as undiciFetch } from 'undici';
import { validateWebhookUrlAsync } from '@/lib/validations/webhook';
import { WebhookDispatcher } from '@/lib/services/webhook-queue/dispatcher';
import { verifyWebhookSignature } from '@/lib/services/webhook-queue/signature';

const endpoint = {
  id: 'ep_1',
  url: 'https://example.com/hook',
  secret: 'whsec_test_abc',
};
const payload = {
  event: 'test.event',
  timestamp: '2026-05-23T12:00:00Z',
  data: { foo: 'bar' },
};

describe('WebhookDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (validateWebhookUrlAsync as any).mockResolvedValue({ valid: true });
  });

  it('signs payload with the timestamped v1 scheme (t=<unix>,v1=<hmac>) and includes required headers', async () => {
    (undiciFetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });

    const [, init] = (undiciFetch as any).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['X-Sellf-Event']).toBe('test.event');
    expect(init.headers['X-Sellf-Signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    // The signature must verify over the exact raw body sent.
    expect(verifyWebhookSignature(endpoint.secret, init.body, init.headers['X-Sellf-Signature'])).toBe(true);
    // The unsigned, replay-exploitable timestamp header is gone (t lives in the signature).
    expect(init.headers['X-Sellf-Timestamp']).toBeUndefined();
    expect(init.redirect).toBe('error');
  });

  it('adds X-Sellf-Retry-Attempt header when attemptCount > 1', async () => {
    (undiciFetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 3 });
    const [, init] = (undiciFetch as any).mock.calls[0];
    expect(init.headers['X-Sellf-Retry-Attempt']).toBe('3');
  });

  it('omits X-Sellf-Retry-Attempt header on first attempt', async () => {
    (undiciFetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    const [, init] = (undiciFetch as any).mock.calls[0];
    expect(init.headers['X-Sellf-Retry-Attempt']).toBeUndefined();
  });

  it('returns ok=true and httpStatus on 2xx', async () => {
    (undiciFetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => 'hello' });
    const result = await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.responseBody).toBe('hello');
    expect(result.errorMessage).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ok=false and HTTP <status> error on non-2xx', async () => {
    (undiciFetch as any).mockResolvedValue({ ok: false, status: 503, text: async () => 'down' });
    const result = await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(503);
    expect(result.errorMessage).toBe('HTTP 503');
  });

  it('rejects URL when pre-flight guard fails (no fetch call)', async () => {
    (validateWebhookUrlAsync as any).mockResolvedValueOnce({ valid: false, error: 'private IP' });
    const result = await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(0);
    expect(result.errorMessage).toMatch(/private IP/);
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it('caps responseBody at 5000 chars', async () => {
    (undiciFetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => 'x'.repeat(10000) });
    const result = await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    expect(result.responseBody!.length).toBe(5000);
  });

  it('returns httpStatus=408 on AbortError (timeout)', async () => {
    const err: any = new Error('aborted');
    err.name = 'AbortError';
    (undiciFetch as any).mockRejectedValue(err);
    const result = await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    expect(result.httpStatus).toBe(408);
    expect(result.errorMessage).toMatch(/timed out/i);
  });

  it('returns httpStatus=0 on generic network error', async () => {
    (undiciFetch as any).mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    expect(result.httpStatus).toBe(0);
    expect(result.errorMessage).toBe('ECONNREFUSED');
  });

  it('forwards extra headers but does not allow overwriting X-Sellf-Signature', async () => {
    (undiciFetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, {
      attemptCount: 1,
      extraHeaders: { 'X-Custom': 'value', 'X-Sellf-Signature': 'forged' },
    });
    const [, init] = (undiciFetch as any).mock.calls[0];
    expect(init.headers['X-Custom']).toBe('value');
    expect(init.headers['X-Sellf-Signature']).not.toBe('forged');
    expect(init.headers['X-Sellf-Signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
  });
});
