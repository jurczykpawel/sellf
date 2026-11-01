/**
 * Coalesce cart changes while retaining every returned session for replacement.
 * @see src/app/[locale]/checkout/[slug]/components/PaidProductForm.tsx
 */
export interface CheckoutSessionIdentity {
  clientSecret?: string;
  bindingToken?: string | null;
  checkoutSessionId?: string;
}

export interface CheckoutSessionTask<T extends CheckoutSessionIdentity> {
  key: string;
  run: (previous: CheckoutSessionIdentity | null) => Promise<T>;
  apply: (result: T) => void;
  fail: (error: unknown) => void;
}

export function createCheckoutSessionQueue<T extends CheckoutSessionIdentity>(
  expire: (identity: CheckoutSessionIdentity) => Promise<void>,
): { update: (task: CheckoutSessionTask<T> | null, quiet?: boolean) => void; pause: () => void } {
  let desired: CheckoutSessionTask<T> | null = null;
  let identity: CheckoutSessionIdentity | null = null;
  let signature: string | null = null;
  let running = false;
  let quietExpiration = false;
  let paused = false;
  let applyOnReturn = false;
  let result: T | null = null;

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (true) {
        if (paused) return;
        const task = desired;
        if (!task) {
          if (identity) {
            await expire(identity);
            identity = null;
            signature = null;
            result = null;
            // The buyer may have returned to paid checkout during expiration.
            if (desired) continue;
          }
          result = null;
          signature = null;
          applyOnReturn = false;
          return;
        }
        if (signature === task.key) {
          if (applyOnReturn && result) { applyOnReturn = false; task.apply(result); }
          return;
        }
        try {
          const received = await task.run(identity);
          result = received;
          identity = received.clientSecret ? received : null;
          signature = task.key;
          const latest = desired as CheckoutSessionTask<T> | null;
          if (latest?.key === task.key) { applyOnReturn = false; latest.apply(received); }
        } catch (error) {
          // The previous session may already have expired before creation failed.
          signature = null;
          const latest = desired as CheckoutSessionTask<T> | null;
          if (latest?.key === task.key) {
            desired = null;
            latest.fail(error);
            return;
          }
        }
      }
    } catch (error) {
      signature = null;
      result = null;
      if (quietExpiration || (error instanceof Error && error.name === 'AbortError')) return;
      console.error('[checkoutSessionQueue] Expiration failed:', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      running = false;
    }
  }

  return {
    update(task, quiet = false) {
      paused = false;
      quietExpiration = quiet;
      desired = task;
      void drain();
    },
    pause() {
      paused = true;
      applyOnReturn = true;
      desired = null;
    },
  };
}
