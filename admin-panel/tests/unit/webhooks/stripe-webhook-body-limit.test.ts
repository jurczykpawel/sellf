import { describe, it, expect, vi, beforeEach } from 'vitest';

const stripeServer = vi.hoisted(() => ({
  verifyWebhookSignature: vi.fn(),
  getStripeServer: vi.fn(),
}));
vi.mock('@/lib/stripe/server', () => stripeServer);

const rateLimiting = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  RATE_LIMITS: { STRIPE_WEBHOOK: { maxRequests: 100, windowMinutes: 1, actionType: 'stripe_webhook' } },
}));
vi.mock('@/lib/rate-limiting', () => rateLimiting);

const supabaseAdmin = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createPlatformClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => supabaseAdmin);

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (k: string) => (k === 'stripe-signature' ? 'sig_test' : null),
  })),
}));

import { POST } from '@/app/api/webhooks/stripe/route';

/** A chunked (no Content-Length) body of exactly `totalBytes`. */
function makeStreamingRequest(totalBytes: number): Request {
  const chunkSize = 64 * 1024;
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, totalBytes - sent);
      controller.enqueue(new Uint8Array(size).fill(97)); // 'a'
      sent += size;
    },
  });
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    // Node's fetch requires duplex when streaming a request body.
    // @ts-expect-error -- not in the DOM lib types this project targets
    duplex: 'half',
    body: stream,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/webhooks/stripe — body size limit', () => {
  it('rejects a chunked, over-limit body with no declared Content-Length as 413, before verifying the signature', async () => {
    // Comfortably over the webhook's own generous cap, still a chunked stream with no Content-Length.
    const req = makeStreamingRequest(6 * 1024 * 1024); // 6MB
    const res = await POST(req as never);

    expect(res.status).toBe(413);
    expect(stripeServer.verifyWebhookSignature).not.toHaveBeenCalled();
    expect(rateLimiting.checkRateLimit).not.toHaveBeenCalled();
  });
});
