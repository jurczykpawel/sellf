import type { SupabaseClient } from '@supabase/supabase-js';
import { WebhookService } from '@/lib/services/webhook-service';

type AnySupabaseClient = SupabaseClient<any, any, any>;

export interface RefundProductSummary {
  id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  icon: string | null;
}

export interface RefundCustomerSummary {
  email: string;
  userId: string | null;
}

export interface RefundIssuedPayload {
  customer: RefundCustomerSummary;
  product: RefundProductSummary | { id: string };
  payment: {
    id: string;
    amount: number;
    currency: string;
    sessionId: string | null;
    paymentIntentId: string | null;
    statusBefore: string;
    statusAfter: string;
  };
  refund: {
    stripeRefundId: string | null;
    amount: number;
    currency: string;
    reason: string | null;
    status: string | null;
    isFullRefund: boolean;
    totalRefunded: number;
    refundedAt: string;
    initiatedByAdminId?: string | null;
    refundRequestId?: string | null;
    source: 'admin' | 'api' | 'refund_request' | 'stripe_webhook';
  };
}

export interface RefundTransactionSummary {
  id: string;
  user_id: string | null;
  product_id: string;
  session_id: string | null;
  stripe_payment_intent_id: string | null;
  amount: number;
  currency: string;
  status: string;
  customer_email: string | null;
}

export interface BuildRefundIssuedPayloadInput {
  customer: RefundCustomerSummary;
  product: RefundIssuedPayload['product'];
  payment: RefundIssuedPayload['payment'];
  refund: RefundIssuedPayload['refund'];
}

export function shouldEmitRefundWebhook(input: {
  previousRefundedAmount: number | null | undefined;
  nextRefundedAmount: number | null | undefined;
}): boolean {
  return (input.nextRefundedAmount ?? 0) > (input.previousRefundedAmount ?? 0);
}

export function buildRefundIssuedPayload(input: BuildRefundIssuedPayloadInput): RefundIssuedPayload {
  return {
    customer: input.customer,
    product: input.product,
    payment: input.payment,
    refund: input.refund,
  };
}

async function fetchProductSummary(
  supabaseClient: AnySupabaseClient,
  productId: string
): Promise<RefundIssuedPayload['product']> {
  const { data } = await supabaseClient
    .from('products')
    .select('id, name, slug, price, currency, icon')
    .eq('id', productId)
    .maybeSingle();

  if (!data) return { id: productId };

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    price: data.price,
    currency: data.currency,
    icon: data.icon,
  };
}

export async function buildRefundIssuedPayloadFromTransaction(input: {
  supabaseClient: AnySupabaseClient;
  transaction: RefundTransactionSummary;
  stripeRefundId: string | null;
  refundAmount: number;
  refundCurrency?: string | null;
  refundReason?: string | null;
  refundStatus?: string | null;
  previousRefundedAmount: number;
  totalRefunded: number;
  isFullRefund: boolean;
  statusBefore: string;
  statusAfter: string;
  refundedAt: string;
  initiatedByAdminId?: string | null;
  refundRequestId?: string | null;
  source: RefundIssuedPayload['refund']['source'];
}): Promise<RefundIssuedPayload> {
  const product = await fetchProductSummary(input.supabaseClient, input.transaction.product_id);
  const currency = (input.refundCurrency || input.transaction.currency || '').toUpperCase();

  return buildRefundIssuedPayload({
    customer: {
      email: input.transaction.customer_email || '',
      userId: input.transaction.user_id,
    },
    product,
    payment: {
      id: input.transaction.id,
      amount: input.transaction.amount,
      currency: input.transaction.currency,
      sessionId: input.transaction.session_id,
      paymentIntentId: input.transaction.stripe_payment_intent_id,
      statusBefore: input.statusBefore,
      statusAfter: input.statusAfter,
    },
    refund: {
      stripeRefundId: input.stripeRefundId,
      amount: input.refundAmount,
      currency,
      reason: input.refundReason || null,
      status: input.refundStatus || null,
      isFullRefund: input.isFullRefund,
      totalRefunded: input.totalRefunded,
      refundedAt: input.refundedAt,
      ...(input.initiatedByAdminId !== undefined && { initiatedByAdminId: input.initiatedByAdminId }),
      ...(input.refundRequestId !== undefined && { refundRequestId: input.refundRequestId }),
      source: input.source,
    },
  });
}

export async function emitRefundIssuedWebhook(input: Parameters<typeof buildRefundIssuedPayloadFromTransaction>[0]) {
  if (!shouldEmitRefundWebhook({
    previousRefundedAmount: input.previousRefundedAmount,
    nextRefundedAmount: input.totalRefunded,
  })) {
    return false;
  }

  const payload = await buildRefundIssuedPayloadFromTransaction(input);
  WebhookService.trigger('refund.issued', payload, input.supabaseClient, payload.product.id)
    .catch((error) => console.error('[refund-webhook] Failed to dispatch refund.issued:', error));
  return true;
}
