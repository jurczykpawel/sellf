import { describe, it, expect } from 'vitest';
import { runBatch } from '@/lib/webhooks/batch-runner';

describe('runBatch', () => {
  it('returns succeeded:0 failed:0 for empty input', async () => {
    const r = await runBatch<string>([], async () => undefined);
    expect(r).toEqual({ succeeded: 0, failed: 0 });
  });

  it('counts all resolves as succeeded', async () => {
    const r = await runBatch(['a', 'b', 'c'], async () => 'ok');
    expect(r).toEqual({ succeeded: 3, failed: 0 });
  });

  it('counts all rejections as failed', async () => {
    const r = await runBatch(['a', 'b'], async () => {
      throw new Error('boom');
    });
    expect(r).toEqual({ succeeded: 0, failed: 2 });
  });

  it('counts mixed results correctly', async () => {
    const r = await runBatch(['ok', 'fail', 'ok', 'fail', 'ok'], async (x) => {
      if (x === 'fail') throw new Error('x');
      return x;
    });
    expect(r).toEqual({ succeeded: 3, failed: 2 });
  });

  it('runs in parallel (total time ≈ slowest, not sum)', async () => {
    const start = Date.now();
    await runBatch([50, 50, 50, 50], async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(150);
  });

  it('does not throw when individual items reject', async () => {
    await expect(
      runBatch(['x'], async () => {
        throw new Error('intentional');
      }),
    ).resolves.toEqual({ succeeded: 0, failed: 1 });
  });
});
