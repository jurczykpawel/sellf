import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// One-time RPC rejects subscriptions (trial = "Invalid amount", paid = "Amount
// mismatch" against products.price=0). Webhooks handle subscription access.

const source = readFileSync(
  resolve(__dirname, '../../src/lib/payment/verify-payment.ts'),
  'utf-8',
);

describe('verifyPaymentSession subscription branch', () => {
  it('short-circuits for mode=subscription before the one-time RPC', () => {
    const subBranchIdx = source.indexOf("session.mode === 'subscription'");
    const rpcIdx = source.indexOf(".rpc('process_stripe_payment_completion_with_bump'");
    expect(subBranchIdx).toBeGreaterThan(-1);
    expect(rpcIdx).toBeGreaterThan(-1);
    expect(subBranchIdx).toBeLessThan(rpcIdx);
  });

  it('gates on status=complete AND payment_status=paid AND mode=subscription', () => {
    const block = source.match(
      /if\s*\(\s*\n?\s*session\.status === 'complete'[\s\S]+?session\.mode === 'subscription'/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toContain("payment_status === 'paid'");
  });

  it('uses the saved invoice receipt and waits for fulfillment for signed-in buyers', () => {
    expect(source).toContain('getProcessedPaymentFromDatabase(invoiceId, serviceClient, user)');
    expect(source).toContain("if (user) return { ...baseResponse, access_granted: false, scenario: 'subscription' }");
  });

  it('returns guest scenario with magic-link flags when buyer was not logged in', () => {
    const guestBlock = source.match(
      /scenario:\s*['"]subscription_guest['"][\s\S]{0,200}/,
    );
    const reverseBlock = source.match(
      /access_granted:\s*false[\s\S]{0,300}scenario:\s*['"]subscription_guest['"]/,
    );
    expect(guestBlock || reverseBlock).not.toBeNull();
    const subBranch = source.match(
      /session\.mode === 'subscription'[\s\S]{0,1500}/,
    );
    expect(subBranch).not.toBeNull();
    expect(subBranch![0]).toMatch(/is_guest_purchase:\s*true/);
    expect(subBranch![0]).toMatch(/send_magic_link:\s*true/);
    expect(subBranch![0]).toMatch(/requires_login:\s*true/);
  });
});
