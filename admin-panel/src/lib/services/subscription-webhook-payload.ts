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

function fromMinor(amount: number | null | undefined): number {
  return typeof amount === 'number' ? Math.round(amount) / 100 : 0;
}

function toIso(unix: number | null | undefined): string | null {
  if (!unix && unix !== 0) return null;
  return new Date(unix * 1000).toISOString();
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
      recurringPrice: fromMinor(item?.price.unit_amount ?? null),
      trialEnd: toIso(sub.trial_end),
      currentPeriodStart: toIso(sub.items.data[0]?.current_period_start ?? null),
      currentPeriodEnd: toIso(sub.items.data[0]?.current_period_end ?? null),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
  };
}

export function buildSubscriptionUpdatedPayload(input: BaseInput & {
  subscription: Stripe.Subscription;
  previousAttributes?: Partial<Stripe.Subscription>;
}) {
  const sub = input.subscription;
  return {
    customer: input.customer,
    product: input.product,
    subscription: {
      stripeSubscriptionId: sub.id,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: toIso(sub.items.data[0]?.current_period_end ?? null),
      previousAttributes: input.previousAttributes ?? {},
    },
  };
}

export function buildSubscriptionCanceledPayload(input: BaseInput & {
  subscription: Stripe.Subscription;
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
      endsAt: toIso(sub.items.data[0]?.current_period_end ?? null),
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
      amountDue: fromMinor(inv.amount_due),
      currency: (inv.currency || 'usd').toUpperCase(),
      nextPaymentAttempt: toIso(inv.next_payment_attempt),
      billingReason: inv.billing_reason,
    },
  };
}

export function buildInvoicePaidPayload(input: BaseInput & {
  invoice: Stripe.Invoice;
  subscriptionId: string;
  /** Order-level VAT snapshot for this invoice (net/tax in MAJOR units, matching amountPaid). */
  taxSnapshot?: OrderTaxSnapshot;
}) {
  const inv = input.invoice;
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
    subscription: { stripeSubscriptionId: input.subscriptionId },
    invoice: {
      stripeInvoiceId: inv.id,
      amountPaid: fromMinor(inv.amount_paid),
      currency: (inv.currency || 'usd').toUpperCase(),
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdfUrl: inv.invoice_pdf ?? null,
      paidAt: toIso(inv.status_transitions?.paid_at ?? null),
      billingReason: inv.billing_reason,
      // VAT (present only when captured). net/tax in MAJOR units (like amountPaid);
      // vatRate is the single applied rate or null; taxSnapshotStatus mirrors the tx row.
      ...(snap && {
        net: fromMinor(snap.netTotal),
        tax: fromMinor(snap.taxTotal),
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
      amountDue: fromMinor(inv.amount_due),
      currency: (inv.currency || 'usd').toUpperCase(),
      attemptCount: inv.attempt_count,
      nextPaymentAttempt: toIso(inv.next_payment_attempt),
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    },
  };
}
