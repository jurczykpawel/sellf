import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const rateLimiting = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  checkRateLimitForIdentifier: vi.fn(),
}));
vi.mock('@/lib/rate-limiting', () => rateLimiting);

import { POST } from '@/app/api/validate-email/route';

/** A chunked (no Content-Length) body of exactly `totalBytes`. */
function makeStreamingRequest(url: string, totalBytes: number): NextRequest {
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
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Node's fetch requires duplex when streaming a request body.
    // @ts-expect-error -- not in the DOM lib types this project targets
    duplex: 'half',
    body: stream,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimiting.checkRateLimit.mockResolvedValue(true);
  rateLimiting.checkRateLimitForIdentifier.mockResolvedValue(true);
});

describe('POST /api/validate-email — body size limit', () => {
  it('has no Content-Length header on the streamed body (the gap this closes)', () => {
    const req = makeStreamingRequest('http://localhost:3000/api/validate-email', 1024);
    expect(req.headers.get('content-length')).toBeNull();
  });

  it('rejects a chunked, over-limit body with no declared Content-Length as 413', async () => {
    const req = makeStreamingRequest('http://localhost:3000/api/validate-email', 2 * 1024 * 1024); // 2MB
    const res = await POST(req);
    expect(res.status).toBe(413);
  });
});

it.each([
  ['a'.repeat(255) + '@example.com', 'EMAIL_TOO_LONG'],
  ['invalid', 'INVALID_EMAIL_FORMAT'],
])('returns a stable field validation code for %s', async (email, code) => {
  const response = await POST(new NextRequest('http://localhost/api/validate-email', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
  }));
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe(code);
});
