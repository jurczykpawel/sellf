import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const stripeWebhookSource = readFileSync(
  resolve(__dirname, '../../src/app/api/webhooks/stripe/route.ts'),
  'utf-8'
);

const stripeConstantsSource = readFileSync(
  resolve(__dirname, '../../src/lib/constants.ts'),
  'utf-8'
);

const paymentTransactionsTableSource = readFileSync(
  resolve(__dirname, '../../src/components/admin/PaymentTransactionsTable.tsx'),
  'utf-8'
);

const paymentsListRouteSource = readFileSync(
  resolve(__dirname, '../../src/app/api/v1/payments/route.ts'),
  'utf-8'
);

describe('stripe refund handling', () => {
  it('subscribes to the refund event family and routes them through refund handling', () => {
    expect(stripeConstantsSource).toContain("'refund.created'");
    expect(stripeConstantsSource).toContain("'refund.updated'");
    expect(stripeWebhookSource).toContain("case 'refund.created':");
    expect(stripeWebhookSource).toContain("case 'refund.updated':");
    expect(stripeWebhookSource).toContain('handleRefundEvent');
  });

  it('shows partial refund state in the admin payments table', () => {
    expect(paymentTransactionsTableSource).toContain('partialRefundWarning');
    expect(paymentTransactionsTableSource).toContain('partialRefunded');
    expect(paymentTransactionsTableSource).toContain('remainingRefundable');
  });

  it('returns refunded_amount at the top level for the admin payments table', () => {
    expect(paymentsListRouteSource).toContain('refunded_amount: p.refunded_amount ?? 0');
  });

  it('does not skip full-refund access revocation only because the transaction is already marked refunded', () => {
    const isFullRefundIndex = stripeWebhookSource.indexOf('const isFullRefund = charge.amount_refunded >= charge.amount');
    const refundedStatusGuardIndex = stripeWebhookSource.indexOf("transaction.status === 'refunded' && !isFullRefund");
    const revocationIndex = stripeWebhookSource.indexOf('const revocation = await revokeTransactionAccess');

    expect(isFullRefundIndex).toBeGreaterThan(-1);
    expect(refundedStatusGuardIndex).toBeGreaterThan(isFullRefundIndex);
    expect(revocationIndex).toBeGreaterThan(refundedStatusGuardIndex);
    expect(stripeWebhookSource).not.toContain("if (transaction.status === 'refunded') {\n    return");
  });
});
