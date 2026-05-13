/**
 * Asserts that `handleCheckoutSessionCompleted` returns early when
 * `session.mode === 'subscription'`. Subscription checkouts are owned
 * by `customer.subscription.created` + `invoice.paid`; this handler
 * stays scoped to the one-time-payment surface.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const ROUTE_FILE = join(__dirname, '../../src/app/api/webhooks/stripe/route.ts');

describe('checkout.session.completed — subscription-mode early-exit', () => {
  const source = readFileSync(ROUTE_FILE, 'utf-8');

  it('handleCheckoutSessionCompleted returns before the legacy RPC when session.mode === "subscription"', () => {
    // Locate the handler body.
    const handlerMatch = source.match(
      /async function handleCheckoutSessionCompleted[\s\S]*?\n\}\n/,
    );
    expect(handlerMatch, 'handleCheckoutSessionCompleted not found').toBeTruthy();
    const body = handlerMatch![0];

    // Find the early-exit on subscription mode.
    const earlyExitIdx = body.search(/session\.mode\s*===\s*['"]subscription['"]/);
    expect(earlyExitIdx, 'early-exit on session.mode === "subscription" missing').toBeGreaterThan(-1);

    // Find the legacy RPC call.
    const rpcIdx = body.search(/process_stripe_payment_completion(_with_bump)?/);
    expect(rpcIdx, 'legacy payment-completion RPC not found in handler').toBeGreaterThan(-1);

    // The early-exit must come BEFORE the RPC call.
    expect(earlyExitIdx).toBeLessThan(rpcIdx);
  });

  it('handler returns processed: true on the early-exit path (avoids forced retries)', () => {
    const handlerMatch = source.match(
      /async function handleCheckoutSessionCompleted[\s\S]*?\n\}\n/,
    );
    const body = handlerMatch![0];

    // Slice out the part between the mode check and the next return —
    // it should contain `processed: true`. Lax match: any `processed: true`
    // after the mode check and before the RPC call passes.
    const earlyExitIdx = body.search(/session\.mode\s*===\s*['"]subscription['"]/);
    const rpcIdx = body.search(/process_stripe_payment_completion(_with_bump)?/);
    const between = body.slice(earlyExitIdx, rpcIdx);

    expect(between).toMatch(/processed:\s*true/);
  });
});
