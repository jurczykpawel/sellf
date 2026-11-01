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

it('does not log an aborted expiration and accepts a later checkout', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const expire = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    const queue = createCheckoutSessionQueue(expire);
    const apply = vi.fn();
    const task = { key: 'base', run: async () => identity('cs_test_first'), apply, fail: vi.fn() };
    queue.update(task);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    queue.update(null);
    await vi.waitFor(() => expect(expire).toHaveBeenCalledOnce());
    expect(log).not.toHaveBeenCalled();
    queue.update({ ...task, key: 'next' });
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
  } finally { log.mockRestore(); }
});

it('keeps failed cleanup quiet after page exit while preserving active errors', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const quiet of [true, false]) {
      const expire = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
      const queue = createCheckoutSessionQueue(expire);
      const apply = vi.fn();
      queue.update({ key: 'base', run: async () => identity('cs_test_first'), apply, fail: vi.fn() });
      await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
      queue.update(null, quiet);
      await vi.waitFor(() => expect(expire).toHaveBeenCalledOnce());
      expect(log).toHaveBeenCalledTimes(quiet ? 0 : 1);
    }
  } finally { log.mockRestore(); }
});

it('retains a quote across method choice and expires it only when checkout is left', async () => {
  const apply = vi.fn(), expire = vi.fn();
  const quote = { clientSecret: 'quote-a', checkoutSessionId: 'quote-a' };
  const run = vi.fn(async () => quote);
  const queue = createCheckoutSessionQueue(expire);
  queue.update({ key: 'cart-a', run, apply, fail: vi.fn() });
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  queue.pause();
  expect(expire).not.toHaveBeenCalled();
  queue.update({ key: 'cart-a', run, apply, fail: vi.fn() });
  await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
  queue.update({ key: 'cart-a', run, apply, fail: vi.fn() });
  expect(run).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledTimes(2);
  queue.update(null);
  await vi.waitFor(() => expect(expire).toHaveBeenCalledWith(quote));
});
it('retains an in-flight quote during a method choice and applies it once on return', async () => {
  const pending = deferred<{ clientSecret: string }>();
  const run = vi.fn(() => pending.promise), apply = vi.fn(), expire = vi.fn();
  const queue = createCheckoutSessionQueue(expire);
  queue.update({ key: 'cart-a', run, apply, fail: vi.fn() }); queue.pause();
  pending.resolve({ clientSecret: 'quote-a' });
  await vi.waitFor(() => expect(run).toHaveResolved());
  expect(apply).not.toHaveBeenCalled(); expect(expire).not.toHaveBeenCalled();
  queue.update({ key: 'cart-a', run, apply, fail: vi.fn() });
  await vi.waitFor(() => expect(apply).toHaveBeenCalledExactlyOnceWith({ clientSecret: 'quote-a' }));
  expect(run).toHaveBeenCalledOnce();
});
it('replaces a retained quote only when the priced cart changed', async () => {
  const expire = vi.fn(), apply = vi.fn(); const quote = { clientSecret: 'quote-a' };
  const queue = createCheckoutSessionQueue(expire);
  queue.update({ key: 'quantity-1', run: async () => quote, apply, fail: vi.fn() });
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce()); queue.pause();
  const changed = vi.fn(async () => ({ clientSecret: 'quote-b' }));
  queue.update({ key: 'quantity-2', run: changed, apply, fail: vi.fn() });
  await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(quote));
  await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith({ clientSecret: 'quote-b' }));
  queue.update(null); await vi.waitFor(() => expect(expire).toHaveBeenCalledWith({ clientSecret: 'quote-b' }));
});

it('expires a quote returned after a paused checkout was left', async () => {
  const pending = deferred<{ clientSecret: string }>();
  const expire = vi.fn(), apply = vi.fn(); const queue = createCheckoutSessionQueue(expire);
  queue.update({ key: 'cart', run: () => pending.promise, apply, fail: vi.fn() });
  queue.pause(); queue.update(null, true); pending.resolve({ clientSecret: 'quote-a' });
  await vi.waitFor(() => expect(expire).toHaveBeenCalledExactlyOnceWith({ clientSecret: 'quote-a' }));
  expect(apply).not.toHaveBeenCalled();
});
