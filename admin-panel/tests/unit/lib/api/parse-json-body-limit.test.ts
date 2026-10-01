import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { parseJsonBody, ApiPayloadTooLargeError, ApiValidationError } from '@/lib/api/middleware';

/** A chunked (no Content-Length) body of exactly `totalBytes`. */
function makeStreamingRequest(totalBytes: number): NextRequest {
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
  return new NextRequest('http://localhost/api/v1/test', {
    method: 'POST',
    // Node's fetch requires duplex when streaming a request body.
    // @ts-expect-error -- not in the DOM lib types this project targets
    duplex: 'half',
    body: stream,
  });
}

describe('parseJsonBody — byte limit', () => {
  it('has no Content-Length header on a streamed body (the gap this closes)', () => {
    const req = makeStreamingRequest(1024);
    expect(req.headers.get('content-length')).toBeNull();
  });

  it('rejects a chunked body over the cap even with no declared Content-Length', async () => {
    const req = makeStreamingRequest(2 * 1024 * 1024); // 2MB
    await expect(parseJsonBody(req)).rejects.toBeInstanceOf(ApiPayloadTooLargeError);
  });

  it('parses a normal small JSON body', async () => {
    const req = new NextRequest('http://localhost/api/v1/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    const data = await parseJsonBody<{ hello: string }>(req);
    expect(data).toEqual({ hello: 'world' });
  });

  it('still rejects malformed JSON as ApiValidationError, not ApiPayloadTooLargeError', async () => {
    const req = new NextRequest('http://localhost/api/v1/test', {
      method: 'POST',
      body: 'not json',
    });
    await expect(parseJsonBody(req)).rejects.toBeInstanceOf(ApiValidationError);
  });
});
