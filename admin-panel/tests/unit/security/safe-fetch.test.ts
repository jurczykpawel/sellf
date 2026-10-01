import { describe, it, expect } from 'vitest';
import { readBoundedText } from '@/lib/security/safe-fetch';

function responseFromStream(stream: ReadableStream<Uint8Array> | null): Response {
  return new Response(stream);
}

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
    },
  });
}

/** A stream that would never terminate if fully consumed — proves early cancellation. */
function infiniteStream(onPull: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    pull(controller) {
      onPull();
      controller.enqueue(encoder.encode('x'.repeat(64)));
    },
  });
}

describe('readBoundedText', () => {
  it('returns the full body when it is smaller than the limit', async () => {
    const response = responseFromStream(chunkedStream(['hello', ' world']));
    await expect(readBoundedText(response, 100)).resolves.toBe('hello world');
  });

  it('truncates a body larger than the limit', async () => {
    const response = responseFromStream(chunkedStream(['a'.repeat(50), 'b'.repeat(50)]));
    const result = await readBoundedText(response, 60);
    expect(result).toHaveLength(60);
    expect(result).toBe('a'.repeat(50) + 'b'.repeat(10));
  });

  it('returns an empty string for a response with no body', async () => {
    const response = responseFromStream(null);
    await expect(readBoundedText(response, 100)).resolves.toBe('');
  });

  it('stops pulling more chunks once the limit is reached, instead of draining an unbounded stream', async () => {
    let pullCount = 0;
    const response = responseFromStream(infiniteStream(() => {
      pullCount += 1;
    }));

    const result = await readBoundedText(response, 100);

    expect(result.length).toBeGreaterThanOrEqual(100);
    // 64-byte chunks: reaching >=100 chars takes at most 2 pulls. A generous
    // upper bound (5) still proves this never drains the "infinite" stream.
    expect(pullCount).toBeLessThan(5);
  });

  it('returns whatever was read so far if the stream errors mid-read', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('partial-data'));
      },
      pull(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    const response = responseFromStream(stream);

    await expect(readBoundedText(response, 1000)).resolves.toBe('partial-data');
  });
});
