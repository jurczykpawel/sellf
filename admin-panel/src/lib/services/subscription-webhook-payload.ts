/**
 * Subscription webhook payload builders.
 *
 * One pure helper per outgoing event type. Pure = no I/O — DB lookups happen
 * upstream so the resulting payload is fully serializable and easy to test.
 *
 * Outgoing events:
 *   subscription.created
 *   subscription.updated
 *   subscription.canceled
 *   subscription.trial_ending
 *   subscription.renewal_upcoming
 *   invoice.paid
 *   invoice.payment_failed
 *
 * @see /app/api/webhooks/stripe/route.ts (inbound -> outbound dispatch)
 * @see /lib/services/webhook-payload.ts (purchase.completed pattern)
 */

import type Stripe from 'stripe';
import { fromMinorUnits } from '@/lib/currency/minor-units';
import { describeTaxId } from '@/lib/validation/tax-id';
import type { OrderTaxSnapshot } from '@/lib/services/tax-snapshot';

export interface SubProductSummary {
  id: string;
  name: string;
  slug: string;
  currency: string;
  recurring_price?: number | null;
  billing_interval?: string | null;
  billing_interval_count?: number | null;
}

export interface SubCustomerSummary {
  email: string;
  userId: string | null;
}

interface BaseInput {
  customer: SubCustomerSummary;
  product: SubProductSummary;
}

function fromMinor(amount: number | null | undefined, currency: string): number {
  return typeof amount === 'number' ? fromMinorUnits(Math.round(amount), currency) : 0;
}

function toIso(unix: number | null | undefined): string | null {
  if (!unix && unix !== 0) return null;
  return new Date(unix * 1000).toISOString();
}

export function getPaidInvoicePeriod(invoice: Stripe.Invoice, subscriptionId: string): Stripe.InvoiceLineItem['period'] | null {
  const recurringLines = invoice.lines?.data.filter((line) => {
    const parent = line.parent;
    const details = parent?.subscription_item_details;
    return parent?.type === 'subscription_item_details'
      && details?.subscription === subscriptionId && !details.proration;
  }) ?? [];
  const period = recurringLines.length === 1 ? recurringLines[0].period : undefined;
  const hasPeriod = !invoice.lines?.has_more && period && Number.isSafeInteger(period.start) && Number.isSafeInteger(period.end)
    && period.start >= 0 && period.end >= period.start
    && period.end <= 8640000000000;
  return hasPeriod ? period : null;
}

function subscriptionAccessEnd(sub: Stripe.Subscription, paidPeriodEnd?: number | null): string | null {
  if (paidPeriodEnd != null) return toIso(paidPeriodEnd);
  if (sub.ended_at != null) return toIso(sub.ended_at);
  if (sub.status === 'canceled' && !sub.cancel_at_period_end) return toIso(sub.canceled_at);
  return sub.cancel_at_period_end ? toIso(paidPeriodEnd) : null;
}

export function buildSubscriptionCreatedPayload(input: BaseInput & {
  subscription: Stripe.Subscription;
}) {
  const sub = input.subscription;
  const item = sub.items.data[0];
  return {
    customer: input.customer,
    product: input.product,
    subscription: {
      stripeSubscriptionId: sub.id,
      stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      status: sub.status,
      billingInterval: item?.price.recurring?.interval ?? null,
      billingIntervalCount: item?.price.recurring?.interval_count ?? null,
      recurringPrice: fromMinor(item?.price.unit_amount ?? null, item?.price.currency ?? 'usd'),
      trialEnd: toIso(sub.trial_end),
      currentPeriodStart: toIso(sub.items.data[0]?.current_period_start ?? null),
      currentPeriodEnd: toIso(sub.items.data[0]?.current_period_end ?? null),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
  };
}

/** Previous values of the contract fields a subscription change touched (camelCase, ISO dates). */
export interface SubscriptionPreviousValues {
  status?: string;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: string | null;
  canceledAt?: string | null;
  endedAt?: string | null;
  trialEnd?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  quantity?: number | null;
  stripePriceId?: string | null;
}

/**
 * Maps Stripe's raw `previous_attributes` to the normalized fields integrators receive.
 * Raw Stripe objects (items, plan, invoices) never leave Sellf (W147-4).
 */
export function normalizePreviousAttributes(raw?: Partial<Stripe.Subscription>): SubscriptionPreviousValues {
  if (!raw) return {};
  const out: SubscriptionPreviousValues = {};
  if (typeof raw.status === 'string') out.status = raw.status;
  if (typeof raw.cancel_at_period_end === 'boolean') out.cancelAtPeriodEnd = raw.cancel_at_period_end;
  if ('cancel_at' in raw) out.cancelAt = toIso(raw.cancel_at);
  if ('canceled_at' in raw) out.canceledAt = toIso(raw.canceled_at);
  if ('ended_at' in raw) out.endedAt = toIso(raw.ended_at);
  if ('trial_end' in raw) out.trialEnd = toIso(raw.trial_end);
  const item = raw.items?.data?.[0];
  if (item) {
    if ('current_period_start' in item) out.currentPeriodStart = toIso(item.current_period_start);
    if ('current_period_end' in item) out.currentPeriodEnd = toIso(item.current_period_end);
    if ('quantity' in item) out.quantity = item.quantity ?? null;
    if (item.price && 'id' in item.price) out.stripePriceId = item.price.id ?? null;
  }
  return out;
}

export function buildSubscriptionUpdatedPayload(input: BaseInput & {
  subscription: Stripe.Subscription;
  previousAttributes?: Partial<Stripe.Subscription>;
  paidPeriodEnd?: number | null;
}) {
  const sub = input.subscription;
  const endsAt = subscriptionAccessEnd(sub, input.paidPeriodEnd);
  const previousAttributes = normalizePreviousAttributes(input.previousAttributes);
  return {
    customer: input.customer,
    product: input.product,
    subscription: {
      stripeSubscriptionId: sub.id,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: sub.ended_at != null || sub.status === 'canceled' || sub.cancel_at_period_end
        ? endsAt : toIso(sub.items?.data[0]?.current_period_end ?? null),
      endsAt,
      endedAt: toIso(sub.ended_at),
      canceledAt: toIso(sub.canceled_at),
      previousAttributes,
      changedFields: Object.keys(previousAttributes),
    },
  };
}

export function buildSubscriptionCanceledPayload(input: BaseInput & {
  subscription: Stripe.Subscription;
  paidPeriodEnd?: number | null;
}) {
  const sub = input.subscription;
  return {
    customer: input.customer,
    product: input.product,
    subscription: {
      stripeSubscriptionId: sub.id,
      status: sub.status,
      canceledAt: toIso(sub.canceled_at),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      endedAt: toIso(sub.ended_at),
      endsAt: subscriptionAccessEnd(sub, input.paidPeriodEnd),
    },
  };
}

export function buildSubscriptionTrialEndingPayload(input: BaseInput & {
  subscription: Stripe.Subscription;
}) {
  return {
    customer: input.customer,
    product: input.product,
    subscription: {
      stripeSubscriptionId: input.subscription.id,
      trialEnd: toIso(input.subscription.trial_end),
    },
  };
}

export function buildSubscriptionRenewalUpcomingPayload(input: BaseInput & {
  invoice: Stripe.Invoice;
  subscription: Stripe.Subscription;
}) {
  const inv = input.invoice;
  const sub = input.subscription;
  return {
    customer: input.customer,
    product: input.product,
    subscription: {
      stripeSubscriptionId: sub.id,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: toIso(sub.items.data[0]?.current_period_end ?? null),
    },
    invoice: {
      stripeInvoiceId: inv.id ?? null,
      amountDue: fromMinor(inv.amount_due, inv.currency || 'usd'),
      currency: (inv.currency || 'usd').toUpperCase(),
      nextPaymentAttempt: toIso(inv.next_payment_attempt),
      billingReason: inv.billing_reason,
    },
  };
}

export function buildInvoicePaidPayload(input: BaseInput & {
  order?: { id: string; orderNumber: number | null };
  invoice: Stripe.Invoice;
  subscriptionId: string;
  /** Order-level VAT snapshot for this invoice (net/tax in MAJOR units, matching amountPaid). */
  taxSnapshot?: OrderTaxSnapshot;
}) {
  const inv = input.invoice;
  const period = getPaidInvoicePeriod(inv, input.subscriptionId);
  const snap = input.taxSnapshot;
  const taxLine = snap?.lines[0];
  // Invoice billing snapshot for credit-note/faktura: NIP + address are snapshotted by
  // Stripe ONTO EACH INVOICE (invoice.customer_*) from the Customer captured at subscription
  // purchase — they do NOT follow later Sellf-profile edits, which is exactly what a faktura
  // korygująca needs. Present only when a tax id is on the invoice (B2B).
  const invTaxId = inv.customer_tax_ids?.find((t) => t.value)?.value ?? null;
  const invAddr = inv.customer_address;
  return {
    customer: input.customer,
    product: input.product,
    subscription: {
      stripeSubscriptionId: input.subscriptionId,
      ...(period && {
        currentPeriodStart: toIso(period.start),
        currentPeriodEnd: toIso(period.end),
      }),
    },
    invoice: {
      stripeInvoiceId: inv.id,
      orderId: input.order?.id ?? null,
      orderNumber: input.order?.orderNumber ?? null,
      amountPaid: fromMinor(inv.amount_paid, inv.currency || 'usd'),
      currency: (inv.currency || 'usd').toUpperCase(),
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdfUrl: inv.invoice_pdf ?? null,
      paidAt: toIso(inv.status_transitions?.paid_at ?? null),
      billingReason: inv.billing_reason,
      // VAT (present only when captured). net/tax in MAJOR units (like amountPaid);
      // vatRate is the single applied rate or null; taxSnapshotStatus mirrors the tx row.
      ...(snap && {
        net: fromMinor(snap.netTotal, inv.currency || 'usd'),
        tax: fromMinor(snap.taxTotal, inv.currency || 'usd'),
        vatRate: taxLine?.vatRate ?? null,
        taxBehavior: taxLine?.taxBehavior ?? null,
        taxabilityReason: taxLine?.taxabilityReason ?? null,
        taxSnapshotStatus: snap.status,
      }),
      // Buyer faktura details, snapshotted on the invoice at purchase (B2B only).
      ...(invTaxId && {
        nip: invTaxId,
        companyName: inv.customer_name ?? null,
        address: invAddr?.line1 ?? null,
        city: invAddr?.city ?? null,
        postalCode: invAddr?.postal_code ?? null,
        country: invAddr?.country ?? null,
        taxIdType: describeTaxId(invTaxId, invAddr?.country)?.type ?? null,
        taxIdCountry: invAddr?.country ?? null,
      }),
    },
  };
}

export function buildInvoicePaymentFailedPayload(input: BaseInput & {
  invoice: Stripe.Invoice;
  subscriptionId: string;
  subscriptionStatus: Stripe.Subscription.Status;
}) {
  const inv = input.invoice;
  return {
    customer: input.customer,
    product: input.product,
    subscription: {
      stripeSubscriptionId: input.subscriptionId,
      status: input.subscriptionStatus,
    },
    invoice: {
      stripeInvoiceId: inv.id,
      amountDue: fromMinor(inv.amount_due, inv.currency || 'usd'),
      currency: (inv.currency || 'usd').toUpperCase(),
      attemptCount: inv.attempt_count,
      nextPaymentAttempt: toIso(inv.next_payment_attempt),
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    },
  };
}
