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
): { update: (task: CheckoutSessionTask<T> | null) => void } {
  let desired: CheckoutSessionTask<T> | null = null;
  let identity: CheckoutSessionIdentity | null = null;
  let signature: string | null = null;
  let running = false;

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (true) {
        const task = desired;
        if (!task) {
          if (identity) {
            await expire(identity);
            identity = null;
            signature = null;
            // The buyer may have returned to paid checkout during expiration.
            if (desired) continue;
          }
          return;
        }
        if (signature === task.key) return;
        try {
          const result = await task.run(identity);
          identity = result.clientSecret ? result : null;
          signature = task.key;
          const latest = desired as CheckoutSessionTask<T> | null;
          if (latest?.key === task.key) latest.apply(result);
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
      console.error('[checkoutSessionQueue] Expiration failed:', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      running = false;
    }
  }

  return {
    update(task) {
      desired = task;
      void drain();
    },
  };
}
