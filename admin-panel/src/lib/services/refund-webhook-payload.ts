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
    /**
     * VAT breakdown of the refunded amount, for issuing a credit note (faktura
     * korygująca). MINOR units; net + tax sum to `amount`. vatRate is the order's
     * effective rate (blended for mixed-rate orders). Present only when the original
     * order has a tax snapshot (omitted for pre-feature / unavailable orders).
     */
    net?: number;
    tax?: number;
    vatRate?: number | null;
    /**
     * Exemption status of the ORIGINAL order, for the credit note (faktura korygująca):
     * `vatExempt: true` marks a "zwolniony / zw." sale — distinct from a 0% rate, so the
     * credit note can show "zw." rather than 0% VAT. `taxabilityReason` carries Stripe's reason
     * under stripe_tax (`reverse_charge`, `customer_exempt`, …). Sourced from the order's main
     * line; omitted when not exempt / no reason recorded.
     */
    vatExempt?: boolean;
    taxabilityReason?: string | null;
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

/**
 * PURE: VAT breakdown of a refund delta for a credit note (faktura korygująca).
 *
 * Tax for THIS refund = cumulative tax up to totalRefunded minus the tax already credited
 * up to previousRefundedAmount — i.e. the incremental VAT of this delta, proportional to
 * the gross charge. This stays correct across a SEQUENCE of partial refunds: the credited
 * tax across all credit notes sums to round(totalRefunded × taxTotal/amount), which equals
 * taxTotal exactly once the order is fully refunded (totalRefunded == amount). A single
 * full or single partial refund is therefore also exact.
 *
 * Returns null when the order has no tax snapshot (net/tax null) — never fabricate. All
 * MINOR units; net + tax == refundAmount. For a MIXED-RATE order the proportional split
 * is a (blended-rate) approximation — exact for single-rate orders and full refunds.
 */
export function computeRefundTax(params: {
  refundAmount: number;
  previousRefundedAmount: number;
  totalRefunded: number;
  amount: number | null;
  netTotal: number | null;
  taxTotal: number | null;
}): { net: number; tax: number; vatRate: number | null } | null {
  const { refundAmount, previousRefundedAmount, totalRefunded, amount, netTotal, taxTotal } = params;
  if (netTotal === null || taxTotal === null) return null;
  if (!amount || amount <= 0) return null;
  const cumulativeTax = Math.round((totalRefunded * taxTotal) / amount);
  const priorTax = Math.round((previousRefundedAmount * taxTotal) / amount);
  const tax = cumulativeTax - priorTax;
  const net = refundAmount - tax;
  // Effective rate from the TRUE net = gross(amount) - taxTotal. NOT netTotal: the stored
  // net_total is GROSS for legacy brutto orders captured before the inclusive-net fix, so
  // deriving from amount - taxTotal is robust (e.g. 2300/(12300-2300) = 23%, not 18.7%).
  const trueNet = amount - taxTotal;
  const vatRate =
    taxTotal === 0 ? 0 : trueNet > 0 ? Math.round((taxTotal / trueNet) * 10000) / 100 : null;
  return { net, tax, vatRate };
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

  // VAT breakdown of the refund for credit notes — derived from the order's tax snapshot
  // (recorded at purchase). One fetch here keeps all 4 refund callers unchanged.
  const { data: txTax } = await input.supabaseClient
    .from('payment_transactions')
    .select('net_total, tax_total')
    .eq('id', input.transaction.id)
    .maybeSingle();
  const refundTax = computeRefundTax({
    refundAmount: input.refundAmount,
    previousRefundedAmount: input.previousRefundedAmount,
    totalRefunded: input.totalRefunded,
    amount: input.transaction.amount,
    netTotal: txTax?.net_total ?? null,
    taxTotal: txTax?.tax_total ?? null,
  });

  // Exemption status from the order's main line, so a credit note distinguishes "zw."
  // (legal exemption) from a 0% rate. One small fetch; omitted from the payload when absent.
  const { data: mainLine } = await input.supabaseClient
    .from('payment_line_items')
    .select('vat_exempt, taxability_reason')
    .eq('transaction_id', input.transaction.id)
    .eq('item_type', 'main_product')
    .maybeSingle();

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
      ...(refundTax && { net: refundTax.net, tax: refundTax.tax, vatRate: refundTax.vatRate }),
      ...(mainLine?.vat_exempt ? { vatExempt: true } : {}),
      ...(mainLine?.taxability_reason ? { taxabilityReason: mainLine.taxability_reason } : {}),
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
