import { describe, it, expect, beforeAll, vi } from 'vitest';
import { encryptHeaderMap } from '@/lib/webhooks/custom-headers';

beforeAll(() => { process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); });

// Capture the headers actually sent.
const captured: { headers?: Record<string, string> } = {};
vi.mock('undici', () => ({
  fetch: vi.fn(async (_url: string, init: any) => {
    captured.headers = init.headers;
    return { ok: true, status: 200, text: async () => 'ok' };
  }),
}));
vi.mock('@/lib/security/safe-fetch', () => ({
  getSsrfSafeAgent: vi.fn(() => undefined),
}));
vi.mock('@/lib/validations/webhook', () => ({
  validateWebhookUrlAsync: vi.fn(async () => ({ valid: true })),
}));

import { WebhookDispatcher } from '@/lib/services/webhook-queue/dispatcher';

describe('dispatcher custom headers', () => {
  it('adds decrypted custom headers without overriding owned headers', async () => {
    const enc = await encryptHeaderMap({ Authorization: 'Bearer T', 'Content-Type': 'text/x' });
    const endpoint = { id: 'e1', url: 'https://example.com/h', secret: 's', custom_headers_encrypted: enc };
    const res = await WebhookDispatcher.dispatch(endpoint, 'purchase.completed', { a: 1 }, { attemptCount: 1 });
    expect(res.ok).toBe(true);
    expect(captured.headers!['Authorization']).toBe('Bearer T');
    // owned header wins over a custom attempt to override it
    expect(captured.headers!['Content-Type']).toBe('application/json');
    expect(captured.headers!['X-Sellf-Signature']).toBeDefined();
  });
});
