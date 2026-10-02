/**
 * Recoverable fulfillment for a reconciled paid order.
 * @see src/lib/services/webhook-service.ts
 * @see supabase/migrations/20261002000000_payment_order_reconciliation.sql
 */
import { revalidateTag } from 'next/cache';
import { issueLicensesForOrder, resolveComponentProductIds } from '@/lib/services/bundle-order';
import { buildPurchaseWebhookPayload } from '@/lib/services/webhook-payload';
import { captureAndPersistOrderTax } from '@/lib/services/tax-snapshot';
import { trackServerSideConversion, generatePurchaseEventId } from '@/lib/tracking';
import { WebhookService } from '@/lib/services/webhook-service';
import { getPublicBaseUrl } from '@/lib/utils/canonical-url';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

type OrderClient = SupabaseClient<any, any, any>;

export async function fulfillPaidOrder(args: {
  supabase: OrderClient;
  stripe: Stripe;
  source?: 'stripe_webhook';
  transactionId?: string;
  sessionId: string;
  paymentIntentId?: string | null;
  productId: string;
  customerEmail: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string | undefined> | null;
  customerDetails?: Stripe.Checkout.Session.CustomerDetails | null;
  isGuest?: boolean;
  couponId?: string | null;
}): Promise<void> {
  let query = args.supabase.from('payment_transactions').select('id, session_id, user_id, customer_email, metadata, custom_field_values, fulfillment_pending');
  query = args.transactionId ? query.eq('id', args.transactionId) : query.eq('session_id', args.sessionId);
  const { data: tx, error } = await query.single();
  if (error || !tx) throw new Error('Order transaction unavailable');
  if (tx.fulfillment_pending !== true) return;
  const { data: items, error: itemsError } = await args.supabase.from('payment_line_items').select('product_id,item_type').eq('transaction_id', tx.id);
  if (itemsError) throw new Error('Order items unavailable');
  const bumpProductIds: string[] = (items ?? []).filter((item: { item_type: string }) => item.item_type === 'order_bump').map((item: { product_id: string }) => item.product_id);
  const componentProductIds = await resolveComponentProductIds(args.supabase, args.productId);
  const productIds = new Set([args.productId, ...componentProductIds, ...bumpProductIds]);
  for (const bumpId of bumpProductIds) {
    for (const component of await resolveComponentProductIds(args.supabase, bumpId)) productIds.add(component);
  }
  const customFieldValues = (tx.custom_field_values ?? {}) as Record<string, string>;
  const metadata = { ...(tx.metadata ?? {}), ...(args.metadata ?? {}) };
  const licenses = await issueLicensesForOrder(args.supabase, {
    productIds: [...productIds], email: tx.customer_email || args.customerEmail,
    userId: tx.user_id, orderId: args.paymentIntentId || tx.session_id, customFieldValues,
  });
  const taxSnapshot = await captureAndPersistOrderTax({
    stripe: args.stripe, supabase: args.supabase, transactionId: tx.id,
    sessionId: tx.session_id, paymentIntentId: args.paymentIntentId ?? null,
  });
  const payload = await buildPurchaseWebhookPayload({
    supabaseClient: args.supabase, customerEmail: tx.customer_email || args.customerEmail,
    userId: tx.user_id, productId: args.productId, bumpProductIds,
    componentProductIds, metadata, stripeCustomerDetails: args.customerDetails,
    amount: args.amount, currency: args.currency, sessionId: tx.session_id,
    paymentIntentId: args.paymentIntentId ?? null, taxSnapshot, couponId: args.couponId ?? null,
    isGuest: args.isGuest, customFieldValues, source: args.source,
  });
  if (licenses.length) payload.licenses = licenses;
  await WebhookService.trigger('purchase.completed', payload, args.supabase, [...productIds]);
  const { error: savedError } = await args.supabase.from('payment_transactions').update({
    metadata, fulfillment_pending: false,
  }).eq('id', tx.id);
  if (savedError) throw new Error('Order fulfillment state unavailable');
  if (args.source === 'stripe_webhook') {
    const slug = 'slug' in payload.product ? payload.product.slug : null;
    if (typeof slug === 'string') {
      revalidateTag('recent-supporters', { expire: 0 });
      revalidateTag(`product:${slug}`, { expire: 0 });
    }
    const baseUrl = getPublicBaseUrl();
    trackServerSideConversion({
      eventName: 'Purchase', eventId: generatePurchaseEventId(tx.session_id),
      eventSourceUrl: slug ? `${baseUrl}/p/${slug}` : baseUrl,
      value: args.amount / 100, currency: args.currency.toUpperCase(),
      items: [{ item_id: args.productId, item_name: 'name' in payload.product ? payload.product.name : 'Unknown Product', price: args.amount / 100, quantity: 1 }],
      orderId: tx.session_id, userEmail: tx.customer_email || args.customerEmail,
    }).catch(error => console.error('[fulfillPaidOrder] Purchase tracking error:', error));
  }
}
