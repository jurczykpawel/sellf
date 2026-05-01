/**
 * Regression guard for the handleSubscriptionUpdated revocation /
 * grant escalation contract. Stripe's default dunning leaves a
 * subscription at 'unpaid' indefinitely without firing
 * customer.subscription.deleted, so the update event is the only
 * signal we get for that revocation. The handler MUST escalate
 * helper failures to processed:false so a Stripe redelivery (the
 * event lives in RETRIABLE_EVENTS) eventually lands the change.
 *
 * Without this contract a transient DB blip during the dunning
 * webhook leaves the customer with permanent access — the failure
 * mode the audit pass uncovered.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const HANDLER_FILE = join(
  __dirname,
  '../../src/app/api/webhooks/stripe/subscription-handlers.ts',
);

describe('handleSubscriptionUpdated escalation contract', () => {
  const source = readFileSync(HANDLER_FILE, 'utf-8');

  function bodyOf(name: string): string {
    const re = new RegExp(
      String.raw`export\s+async\s+function\s+${name}[\s\S]*?\n\}\n`,
      'm',
    );
    const m = source.match(re);
    if (!m) throw new Error(`${name} not found`);
    return m[0];
  }

  it('returns processed:false when the revoke helper fails', () => {
    const body = bodyOf('handleSubscriptionUpdated');
    const revokeBlockMatch = body.match(
      /revokeUserProductAccessForSubscription[\s\S]*?if\s*\(\s*!r\.ok\s*\)\s*\{[\s\S]*?\}/,
    );
    expect(revokeBlockMatch, 'revoke helper call + ok-check missing').toBeTruthy();
    const block = revokeBlockMatch![0];
    expect(block).toMatch(/return\s*\{[\s\S]*?processed:\s*false/);
    // Sanity: must NOT silently log-and-continue.
    expect(block).not.toMatch(/console\.warn[\s\S]*?\}\s*$/);
  });

  it('returns processed:false when the grant helper fails', () => {
    const body = bodyOf('handleSubscriptionUpdated');
    const grantBlockMatch = body.match(
      /upsertUserProductAccess\([\s\S]*?if\s*\(\s*!r\.ok\s*\)\s*\{[\s\S]*?\}/,
    );
    expect(grantBlockMatch, 'grant helper call + ok-check missing').toBeTruthy();
    const block = grantBlockMatch![0];
    expect(block).toMatch(/return\s*\{[\s\S]*?processed:\s*false/);
  });
});
