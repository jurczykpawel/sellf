/**
 * Our paid Stripe payment for a product that no longer exists in this database: nothing can be granted
 * and redeliveries would never succeed, so the payment is stored in the admin-readable audit log
 * (admin_actions) for the administrator to reconcile (refund or manual access) and the webhook is acknowledged.
 * One record per payment, enforced by the database (unique index on the payment id, shared by Checkout Session
 * and PaymentIntent deliveries); log retention keeps these records (migration 20261115120000).
 * @see src/app/api/webhooks/stripe/onetime-handlers.ts
 * @see src/components/admin/PaymentsReconciliationPanel.tsx
 */
import type { createAdminClient } from '@/lib/supabase/admin';

type Db = ReturnType<typeof createAdminClient>;

export const PAYMENT_RECONCILIATION_ACTION = 'stripe_payment_needs_reconciliation';
const TARGET_TYPE = 'stripe_payment';
const UNIQUE_VIOLATION = '23505';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MissingProductPayment {
  productId: string;
  sessionId: string | null;
  paymentIntentId: string | null;
  amount: number;
  currency: string;
  customerEmail: string;
  eventType: string;
}

export interface PaymentToReconcile {
  id: string;
  paymentId: string;
  sessionId: string | null;
  productId: string;
  amount: number;
  currency: string;
  customerEmail: string;
  reason: 'product_deleted';
  recordedAt: string;
}

interface ReconciliationDetails {
  reason: 'product_deleted';
  product_id: string;
  session_id: string | null;
  payment_intent_id: string | null;
  amount: number;
  currency: string;
  customer_email: string;
  event_type: string;
  severity: 'WARNING';
  context: 'payment_reconciliation';
}

/**
 * Returns the acknowledged result when the product is gone, or null when it still exists (an inactive
 * product keeps the normal handling). Throws when the database cannot be read or written.
 */
export async function reconcilePaymentForMissingProduct(
  db: Db, payment: MissingProductPayment,
): Promise<{ processed: true; message: string } | null> {
  if (UUID.test(payment.productId)) {
    const { data, error } = await db.from('products').select('id').eq('id', payment.productId).maybeSingle();
    if (error) throw new Error('Product lookup unavailable');
    if (data) return null;
  }
  const targetId = payment.paymentIntentId ?? payment.sessionId;
  if (!targetId) return null;
  const details: ReconciliationDetails = {
    reason: 'product_deleted', product_id: payment.productId, session_id: payment.sessionId,
    payment_intent_id: payment.paymentIntentId, amount: payment.amount, currency: payment.currency,
    customer_email: payment.customerEmail, event_type: payment.eventType, severity: 'WARNING', context: 'payment_reconciliation',
  };
  const { error } = await db.from('admin_actions').insert({
    action: PAYMENT_RECONCILIATION_ACTION, target_type: TARGET_TYPE, target_id: targetId, details: { ...details },
  });
  // 23505: this payment is already recorded (redelivery, or the session and its PaymentIntent in parallel).
  if (error && error.code !== UNIQUE_VIOLATION) throw new Error('Reconciliation record unavailable');
  console.error('[stripe-webhook] PAYMENT_NEEDS_RECONCILIATION | payment=%s | product=%s | amount=%d %s',
    targetId, payment.productId, payment.amount, payment.currency);
  return { processed: true, message: 'Paid for a deleted product; recorded for reconciliation' };
}

export async function listPaymentsNeedingReconciliation(db: Db, limit = 100): Promise<PaymentToReconcile[]> {
  const { data, error } = await db.from('admin_actions').select('id, target_id, details, created_at')
    .eq('action', PAYMENT_RECONCILIATION_ACTION).order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error('Reconciliation records unavailable');
  return (data ?? []).map((row) => {
    const details = row.details as unknown as ReconciliationDetails;
    return {
      id: row.id, paymentId: row.target_id, sessionId: details.session_id, productId: details.product_id,
      amount: details.amount, currency: details.currency, customerEmail: details.customer_email,
      reason: details.reason, recordedAt: row.created_at,
    };
  });
}
