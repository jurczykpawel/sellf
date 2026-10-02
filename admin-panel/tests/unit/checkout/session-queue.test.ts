/** @see src/lib/checkout/session-queue.ts */
import { describe, expect, it, vi } from 'vitest';
import { createCheckoutSessionQueue } from '@/lib/checkout/session-queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const identity = (id: string) => ({ clientSecret: `${id}_secret_value`, bindingToken: `binding-${id}`, checkoutSessionId: id });

describe('checkout session queue', () => {
  it('coalesces cart changes and passes the superseded response identity to the next request', async () => {
    const first = deferred<ReturnType<typeof identity>>();
    const last = deferred<ReturnType<typeof identity>>();
    const apply = vi.fn();
    const runFirst = vi.fn(() => first.promise);
    const runIntermediate = vi.fn();
    const runLast = vi.fn(() => last.promise);
    const queue = createCheckoutSessionQueue(vi.fn());
    queue.update({ key: 'base', run: runFirst, apply, fail: vi.fn() });
    queue.update({ key: 'one-bump', run: runIntermediate, apply, fail: vi.fn() });
    queue.update({ key: 'two-bumps', run: runLast, apply, fail: vi.fn() });
    expect(runLast).not.toHaveBeenCalled();
    first.resolve(identity('cs_test_first'));
    await vi.waitFor(() => expect(runLast).toHaveBeenCalledWith(identity('cs_test_first')));
    expect(runIntermediate).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    last.resolve(identity('cs_test_last'));
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(identity('cs_test_last')));
    queue.update({ key: 'two-bumps', run: runLast, apply, fail: vi.fn() });
    expect(runLast).toHaveBeenCalledTimes(1);
  });

  it('expires the returned session when checkout stops while creation is in flight', async () => {
    const first = deferred<ReturnType<typeof identity>>();
    const expire = vi.fn();
    const apply = vi.fn();
    const queue = createCheckoutSessionQueue(expire);
    queue.update({ key: 'base', run: () => first.promise, apply, fail: vi.fn() });
    queue.update(null);
    first.resolve(identity('cs_test_first'));
    await vi.waitFor(() => expect(expire).toHaveBeenCalledWith(identity('cs_test_first')));
    expect(apply).not.toHaveBeenCalled();
  });

  it('retains the previous identity when a replacement fails and uses it on retry', async () => {
    const apply = vi.fn();
    const fail = vi.fn();
    const queue = createCheckoutSessionQueue(vi.fn());
    queue.update({ key: 'base', run: async () => identity('cs_test_first'), apply, fail });
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    queue.update({ key: 'bump', run: async () => { throw new Error('temporary'); }, apply, fail });
    await vi.waitFor(() => expect(fail).toHaveBeenCalledTimes(1));
    const retry = vi.fn(async () => identity('cs_test_retry'));
    queue.update({ key: 'bump', run: retry, apply, fail });
    await vi.waitFor(() => expect(retry).toHaveBeenCalledWith(identity('cs_test_first')));
  });
  it('recreates the original cart when a superseded replacement fails after expiration', async () => {
    const apply = vi.fn();
    const fail = vi.fn();
    const queue = createCheckoutSessionQueue(vi.fn());
    queue.update({ key: 'base', run: async () => identity('cs_test_first'), apply, fail });
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    let reject!: (error: Error) => void;
    const replacement = new Promise<ReturnType<typeof identity>>((_, rejectPromise) => { reject = rejectPromise; });
    queue.update({ key: 'bump', run: () => replacement, apply, fail });
    const retry = vi.fn(async () => identity('cs_test_retry'));
    queue.update({ key: 'base', run: retry, apply, fail });
    reject(new Error('replacement unavailable'));
    await vi.waitFor(() => expect(retry).toHaveBeenCalledWith(identity('cs_test_first')));
    expect(fail).not.toHaveBeenCalled();
  });

});
