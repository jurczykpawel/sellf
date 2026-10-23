// @vitest-environment happy-dom
/** Stripe is loaded only by the online payment step. */
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });
it('does not append a Stripe script when the checkout client module is imported', async () => {
  const append = vi.spyOn(document.head, 'appendChild').mockImplementation(node => node);
  await import('@/lib/stripe/client');
  await Promise.resolve();
  expect(append).not.toHaveBeenCalled();
});
