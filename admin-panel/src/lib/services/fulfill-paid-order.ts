/**
 * Recoverable fulfillment for a reconciled paid order.
 * @see src/lib/services/webhook-service.ts
 * @see supabase/migrations/20261002000000_payment_order_reconciliation.sql
 */
import { revalidateTag } from 'next/cache';
import { purchaseEventMail } from '@/lib/events/mail';
import { handleChargeDispute } from '@/app/api/webhooks/stripe/dispute-handlers';
import { issuedInvoice, issueInvoiceForTransaction } from '@/lib/invoicing/service';
import { snapshotFromRows } from '@/lib/orders/local-tax';
import { mailOrderLicenses } from '@/lib/license-keys/license-mail';
import { issueLicensesForOrder, resolveComponentProductIds } from '@/lib/services/bundle-order';
import { buildPurchaseWebhookPayload } from '@/lib/services/webhook-payload';
import { captureAndPersistOrderTax } from '@/lib/services/tax-snapshot';
import { trackServerSideConversion, generatePurchaseEventId } from '@/lib/tracking';
import { WebhookService } from '@/lib/services/webhook-service';
import { getPublicBaseUrl } from '@/lib/utils/canonical-url';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

import { fromMinorUnits } from '@/lib/currency/minor-units';
import { PURCHASE_ATTRIBUTION_COLUMNS, toPurchaseAttributionView, toWebhookAttribution } from '@/lib/attribution/report';
type OrderClient = SupabaseClient<any, any, any>;

type PaymentProvider = { kind: 'stripe'; stripe: Stripe; sessionId: string; paymentIntentId?: string | null }
  | { kind: 'offline' };
interface FulfillmentInput {
  supabase: OrderClient;
  source?: 'stripe_webhook';
  transactionId?: string;
  productId: string;
  customerEmail: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string | undefined> | null;
  customerDetails?: Stripe.Checkout.Session.CustomerDetails | null;
  isGuest?: boolean;
  couponId?: string | null;
}
type StripeFulfillmentInput = FulfillmentInput & { stripe: Stripe; sessionId: string; paymentIntentId?: string | null };
type ProviderFulfillmentInput = FulfillmentInput & { provider: PaymentProvider };

export async function fulfillStripeOrder(args: StripeFulfillmentInput): Promise<void> {
  const { stripe, sessionId, paymentIntentId, ...order } = args;
  return fulfillPaidOrder({ ...order, provider: { kind: 'stripe', stripe, sessionId, paymentIntentId } });
}

export async function fulfillPaidOrder(args: ProviderFulfillmentInput | StripeFulfillmentInput): Promise<void> {
  const provider: PaymentProvider = 'provider' in args ? args.provider
    : { kind: 'stripe', stripe: args.stripe, sessionId: args.sessionId, paymentIntentId: args.paymentIntentId };
  if (provider.kind === 'offline' && !args.transactionId) throw new Error('Order transaction required');
  let query = args.supabase.from('payment_transactions').select('id, session_id, user_id, customer_email, metadata, custom_field_values, order_details, fulfillment_pending, order_number, stripe_payment_intent_id, settled_via');
  query = args.transactionId ? query.eq('id', args.transactionId) : query.eq('session_id', provider.kind === 'stripe' ? provider.sessionId : null);
  const { data: tx, error } = await query.single();
  if (error || !tx) throw new Error('Order transaction unavailable');
  if (tx.fulfillment_pending !== true) return;
  const { data: items, error: itemsError } = await args.supabase.from('payment_line_items').select('product_id,item_type,discounted_total,currency,vat_rate,tax_behavior,vat_exempt,net_amount,tax_amount,session_id,tier_id,session_label,session_starts_at,tier_label').eq('transaction_id', tx.id);
  if (itemsError) throw new Error('Order items unavailable');
  const bumpProductIds: string[] = (items ?? []).filter((item: { item_type: string }) => item.item_type === 'order_bump').map((item: { product_id: string }) => item.product_id);
  const componentProductIds = await resolveComponentProductIds(args.supabase, args.productId);
  const productIds = new Set([args.productId, ...componentProductIds, ...bumpProductIds]);
  for (const bumpId of bumpProductIds) {
    for (const component of await resolveComponentProductIds(args.supabase, bumpId)) productIds.add(component);
  }
  const customFieldValues = (tx.custom_field_values ?? {}) as Record<string, string>;
  const metadata = { ...(tx.metadata ?? {}), ...(args.metadata ?? {}) };
  const { error: metadataError } = await args.supabase.from('payment_transactions').update({ metadata }).eq('id', tx.id);
  if (metadataError) throw new Error('Order metadata unavailable');
  const orderKey = provider.kind === 'offline' ? tx.id : provider.paymentIntentId || tx.session_id;
  if (provider.kind === 'stripe' && provider.paymentIntentId) {
    await reconcileEarlyDisputes(provider.stripe, args.supabase, provider.paymentIntentId);
  }
  const licenses = await issueLicensesForOrder(args.supabase, {
    productIds: [...productIds], email: tx.customer_email || args.customerEmail,
    userId: tx.user_id, orderId: orderKey, customFieldValues,
  });
  const taxSnapshot = provider.kind === 'offline' ? snapshotFromRows(items ?? []) : await captureAndPersistOrderTax({
    stripe: provider.stripe, supabase: args.supabase, transactionId: tx.id,
    sessionId: tx.session_id, paymentIntentId: provider.paymentIntentId ?? null,
  });
  const payload = await buildPurchaseWebhookPayload({
    eventLines: items ?? [], supabaseClient: args.supabase, customerEmail: tx.customer_email || args.customerEmail,
    userId: tx.user_id, productId: args.productId, bumpProductIds,
    componentProductIds, metadata, stripeCustomerDetails: args.customerDetails,
    amount: args.amount, currency: args.currency, sessionId: provider.kind === 'stripe' ? tx.session_id : undefined,
    // A transfer order paid online carries the payment intent it was settled with (W147-10).
    paymentIntentId: provider.kind === 'stripe' ? provider.paymentIntentId ?? null : tx.stripe_payment_intent_id ?? null, taxSnapshot, couponId: args.couponId ?? null,
    isGuest: args.isGuest, customFieldValues, orderDetails: tx.order_details, source: args.source,
  });
  payload.order.orderId = tx.id;
  payload.order.orderNumber = tx.order_number;
  payload.order.settledVia = tx.settled_via ?? (provider.kind === 'offline' ? 'bank_transfer' : null);
  if (licenses.length) payload.licenses = licenses;
  try {
    // Purchase source is informative: a lookup failure never blocks fulfilment.
    const { data: attributionRow } = await args.supabase.from('purchase_attribution')
      .select(PURCHASE_ATTRIBUTION_COLUMNS).eq('transaction_id', tx.id).maybeSingle();
    if (attributionRow) payload.attribution = toWebhookAttribution(toPurchaseAttributionView(attributionRow as unknown as Parameters<typeof toPurchaseAttributionView>[0]));
  } catch (error) {
    console.error('[fulfillPaidOrder] Attribution unavailable:', error instanceof Error ? error.message : 'Unknown error');
  }
  const invoice = await issuedInvoice(tx.id, args.supabase).catch(() => null);
  if (invoice) payload.invoice = { ...payload.invoice, ...invoice };
  await WebhookService.trigger('purchase.completed', payload, args.supabase, [...productIds]);
  if (licenses.length) {
    const locale = metadata.locale === 'pl' || metadata.locale === 'en' ? metadata.locale : undefined;
    await mailOrderLicenses(args.supabase, { email: tx.customer_email || args.customerEmail, userId: tx.user_id, licenses, mailData: { ...await purchaseEventMail(tx.customer_email || args.customerEmail, args.productId, undefined, undefined, locale ?? 'en', { allowPending: true, transactionId: tx.id }), ...(provider.kind === 'offline' ? { payment_received: 'true' } : {}) }, ...(locale ? { locale } : {}) });
  }
  await issueInvoiceForTransaction(tx.id, { client: args.supabase });
  const { error: savedError } = await args.supabase.from('payment_transactions').update({
    fulfillment_pending: false,
  }).eq('id', tx.id);
  if (savedError) throw new Error('Order fulfillment state unavailable');
  if (provider.kind === 'stripe' && args.source === 'stripe_webhook') {
    const slug = 'slug' in payload.product ? payload.product.slug : null;
    if (typeof slug === 'string') {
      revalidateTag('recent-supporters', { expire: 0 });
      revalidateTag(`product:${slug}`, { expire: 0 });
    }
    const baseUrl = getPublicBaseUrl();
    trackServerSideConversion({
      eventName: 'Purchase', eventId: generatePurchaseEventId(tx.session_id),
      eventSourceUrl: slug ? `${baseUrl}/p/${slug}` : baseUrl,
      value: fromMinorUnits(args.amount, args.currency), currency: args.currency.toUpperCase(),
      items: [{ item_id: args.productId, item_name: 'name' in payload.product ? payload.product.name : 'Unknown Product', price: fromMinorUnits(args.amount, args.currency), quantity: 1 }],
      orderId: tx.session_id, userEmail: tx.customer_email || args.customerEmail,
    }).catch(error => console.error('[fulfillPaidOrder] Purchase tracking error:', error));
  }
}

/**
 * A dispute opened before the payment row existed was answered "awaiting storage" and waits
 * for Stripe's redelivery. Apply it now so access, licenses and dispute.created follow the
 * stored payment immediately. Fail-safe: the redelivered event remains the fallback.
 */
async function reconcileEarlyDisputes(stripe: Stripe, supabase: OrderClient, paymentIntentId: string): Promise<void> {
  try {
    const disputes = await stripe.disputes.list({ payment_intent: paymentIntentId, limit: 10 });
    for (const dispute of disputes.data) {
      await handleChargeDispute(dispute, supabase as never, stripe, false);
    }
  } catch (error) {
    console.error('[fulfillPaidOrder] Early dispute reconciliation deferred:', error instanceof Error ? error.message : 'Unknown error');
  }
}
