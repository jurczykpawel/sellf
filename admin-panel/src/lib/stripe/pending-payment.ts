/**
 * Classify an unmatched order using provider data and local product bindings.
 * @see src/app/api/webhooks/stripe/dispute-handlers.ts
 */
import type Stripe from 'stripe';
import type { createAdminClient } from '@/lib/supabase/admin';

interface PaymentResult { processed: boolean; message: string }

export async function pendingPaymentResult(
  db: ReturnType<typeof createAdminClient>, stripe: Stripe, paymentIntentId: string,
): Promise<PaymentResult> {
  const payment = await stripe.paymentIntents.retrieve(paymentIntentId);
  const candidates = new Set<string>();
  if (payment.metadata?.product_id) candidates.add(payment.metadata.product_id);
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  for (const session of sessions.data) if (session.metadata?.product_id) candidates.add(session.metadata.product_id);
  if (!candidates.size) {
    const payments = await stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: paymentIntentId }, limit: 1 });
    for (const item of payments.data) {
      const invoice = typeof item.invoice === 'string' ? await stripe.invoices.retrieve(item.invoice) : item.invoice;
      if ('deleted' in invoice && invoice.deleted) continue;
      const binding = invoice.parent?.subscription_details;
      if (binding?.metadata?.product_id) candidates.add(binding.metadata.product_id);
      const id = typeof binding?.subscription === 'string' ? binding.subscription : binding?.subscription?.id;
      if (id) {
        const subscription = await stripe.subscriptions.retrieve(id);
        if (subscription.metadata?.product_id) candidates.add(subscription.metadata.product_id);
        const bound = await db.from('subscriptions').select('id').eq('stripe_subscription_id',id).maybeSingle();
        if (bound.error) throw new Error('Subscription binding unavailable');
        if (bound.data) return { processed: false, message: 'Local payment awaiting storage' };
      }
    }
  }
  for (const productId of candidates) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) continue;
    const product = await db.from('products').select('id').eq('id',productId).maybeSingle();
    if (product.error) throw new Error('Product binding unavailable');
    if (product.data) return { processed: false, message: 'Local payment awaiting storage' };
  }
  return { processed: true, message: 'Payment belongs to another installation' };
}
