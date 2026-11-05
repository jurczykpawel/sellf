/**
 * Apply the stored dispute decision before delivering its durable consumer notification.
 * @see supabase/migrations/20261101035039_payment_dispute_state.sql
 */
import { buildLicenseRevokeWebhookData } from '@/lib/services/license-revoke-webhook-payload';
import type { RevokedLicenseRow } from '@/lib/services/license-revoke-webhook-payload';
import { WebhookService } from '@/lib/services/webhook-service';
import { findTransactionByOrderId } from '@/lib/services/transaction-lookup';
import { pendingPaymentResult } from '@/lib/stripe/pending-payment';
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';
import type Stripe from 'stripe';
import type { createAdminClient } from '@/lib/supabase/admin';

export async function handleChargeDispute(
  eventDispute: Stripe.Dispute, db: ReturnType<typeof createAdminClient>, stripe: Stripe,
  closed: boolean,
): Promise<{ processed: boolean; message: string }> {
  let dispute = eventDispute.charge ? eventDispute : await stripe.disputes.retrieve(eventDispute.id);
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return { processed: false, message: 'Dispute charge unavailable' };
  let charge: Stripe.Charge;
  try {
    charge = await stripe.charges.retrieve(chargeId);
  } catch (error) {
    if ((error as { code?: string }).code === 'resource_missing') return { processed: true, message: 'Dispute charge not found' };
    throw error;
  }
  let intent = charge.payment_intent ?? dispute.payment_intent;
  if (!intent) {
    dispute = await stripe.disputes.retrieve(dispute.id);
    intent = dispute.payment_intent;
  }
  const paymentIntentId = typeof intent === 'string' ? intent : intent?.id;
  if (!paymentIntentId) return { processed: true, message: 'Dispute has no payment intent' };
  const outcomeClosed = closed || ['won', 'lost', 'warning_closed'].includes(dispute.status);
  const transaction = await findTransactionByOrderId<{ id: string; order_number: number; product_id: string; session_id: string | null; status: string; refunded_amount: number | null }>(
    db,paymentIntentId,'id, order_number, product_id, session_id, status, refunded_amount',
  );
  if (!transaction) return pendingPaymentResult(db,stripe,paymentIntentId);
  if (transaction.status === 'pending') return { processed: false, message: 'Payment awaiting completion' };
  if (charge.amount_refunded !== (transaction.refunded_amount ?? 0)) {
    return { processed: false, message: 'Refund state awaiting reconciliation' };
  }
  const { data, error } = await db.rpc('apply_payment_dispute', {
    p_transaction_id: transaction.id, p_dispute_id: dispute.id, p_status: dispute.status,
    p_closed: outcomeClosed, p_reason: dispute.reason, p_amount: dispute.amount, p_currency: dispute.currency,
    p_created: new Date(dispute.created * 1000).toISOString(),
  });
  if (error) return { processed: false, message: 'Dispute state unavailable' };
  if (!data) return { processed: true, message: 'Dispute outcome already final' };
  const payload = data as Record<string, unknown>;
  const details = payload.dispute as Record<string, unknown>;
  const payment = payload.payment as Record<string, unknown>;
  const restoredLicenses = Array.isArray(details.restoredLicenses) ? details.restoredLicenses.map(raw => {
    const data = buildLicenseRevokeWebhookData(raw as RevokedLicenseRow, getCanonicalOriginOrNull() ?? '');
    return { ...data.license, productId: data.product.id, crlUrl: data.crlUrl };
  }) : [];
  const { data: product, error: productError } = await db.from('products')
    .select('id, name, slug').eq('id', transaction.product_id).single();
  if (productError) return { processed: false, message: 'Dispute product unavailable' };
  const restoredAccess = Array.isArray(details.restoredAccess) ? details.restoredAccess : [];
  for (const access of restoredAccess as Array<Record<string, unknown>>) {
    if (!access.guestPurchaseId || access.userId || details.status !== 'won') continue;
    const productId = String(access.productId);
    const { data: accessProduct, error: accessProductError } = productId === product?.id
      ? { data: product, error: null }
      : await db.from('products').select('id, name, slug').eq('id', productId).single();
    if (accessProductError) return { processed: false, message: 'Restored product unavailable' };
    await WebhookService.trigger('access.updated', {
      customer: payload.customer, product: accessProduct, reason: 'dispute_won',
      actor: { type: 'system', id: null }, occurredAt: new Date().toISOString(),
      sourceOrder: { id: payment.id, orderId: payment.id, orderNumber: transaction.order_number },
      sourceOrders: [{ id: payment.id, orderId: payment.id, orderNumber: transaction.order_number }],
      accessGrantedAt: access.grantedAt, accessExpiresAt: access.expiresAt,
      grantSource: 'purchase', accessEndsAt: access.expiresAt,
      access: { id: access.guestPurchaseId, grantedAt: access.grantedAt, expiresAt: access.expiresAt,
        statusBefore: 'revoked', statusAfter: 'active', expiredAt: null, revokedAt: null },
    }, db, productId, `dispute:${dispute.id}:guest:${access.guestPurchaseId}:${productId}`);
  }
  await WebhookService.trigger(outcomeClosed ? 'dispute.closed' : 'dispute.created', {
    ...payload, product: { ...(payload.product as object), ...product }, payment: { ...payment, paymentIntentId }, dispute: { ...details, restoredLicenses, stripeChargeId: chargeId },
  },db,transaction.product_id);
  return { processed: true, message: 'Dispute outcome recorded and integrations notified' };
}
