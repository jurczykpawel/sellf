import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  readBodyWithByteLimit,
  readJsonBody,
  ApiPayloadTooLargeError,
  DEFAULT_MAX_BODY_BYTES,
} from '@/lib/api/body-limit';

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
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    // Node's fetch requires duplex when streaming a request body.
    // @ts-expect-error -- not in the DOM lib types this project targets
    duplex: 'half',
    body: stream,
  });
}

describe('readBodyWithByteLimit', () => {
  it('has no Content-Length header on a streamed body (the gap this closes)', () => {
    const req = makeStreamingRequest(1024);
    expect(req.headers.get('content-length')).toBeNull();
  });

  it('rejects a chunked body over the cap even with no declared Content-Length', async () => {
    const req = makeStreamingRequest(2 * 1024 * 1024); // 2MB
    await expect(readBodyWithByteLimit(req, DEFAULT_MAX_BODY_BYTES)).rejects.toBeInstanceOf(
      ApiPayloadTooLargeError,
    );
  });

  it('reads a body under a custom, larger cap (e.g. the Stripe webhook variant)', async () => {
    const req = makeStreamingRequest(2 * 1024 * 1024); // 2MB — over the default, under a 5MB cap
    const text = await readBodyWithByteLimit(req, DEFAULT_MAX_BODY_BYTES * 5);
    expect(text).toHaveLength(2 * 1024 * 1024);
  });

  it('defaults to DEFAULT_MAX_BODY_BYTES when no cap is passed', async () => {
    const req = makeStreamingRequest(2 * 1024 * 1024); // 2MB — over the 1MB default
    await expect(readBodyWithByteLimit(req)).rejects.toBeInstanceOf(ApiPayloadTooLargeError);
  });

  it('returns an empty string for a request with no body', async () => {
    const req = new NextRequest('http://localhost/api/test', { method: 'GET' });
    await expect(readBodyWithByteLimit(req)).resolves.toBe('');
  });
});

describe('readJsonBody — drop-in replacement for request.json()', () => {
  it('parses a normal small JSON body', async () => {
    const req = new NextRequest('http://localhost/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    const data = await readJsonBody<{ hello: string }>(req);
    expect(data).toEqual({ hello: 'world' });
  });

  it('rejects a chunked, over-limit body with no declared Content-Length', async () => {
    const req = makeStreamingRequest(2 * 1024 * 1024); // 2MB
    await expect(readJsonBody(req)).rejects.toBeInstanceOf(ApiPayloadTooLargeError);
  });

  it('throws the same way request.json() does on malformed JSON, not ApiPayloadTooLargeError', async () => {
    const makeMalformedRequest = () =>
      new NextRequest('http://localhost/api/test', { method: 'POST', body: 'not json' });

    await expect(readJsonBody(makeMalformedRequest())).rejects.not.toBeInstanceOf(ApiPayloadTooLargeError);
    await expect(readJsonBody(makeMalformedRequest())).rejects.toBeInstanceOf(SyntaxError);
  });
});
