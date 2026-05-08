/**
 * Stripe subscription + invoice webhook handlers.
 *
 * Each handler is idempotent and dispatches a matching outgoing webhook so sellers
 * can hook their own email/CRM/notification flow.
 *
 * Idempotency contracts:
 *   - subscriptions.stripe_subscription_id is UNIQUE -> upsert is safe.
 *   - payment_transactions.stripe_invoice_id is UNIQUE -> insert collisions = already processed.
 *
 * @see /supabase/migrations/20260430142135_subscriptions_mvp.sql
 */

import type Stripe from 'stripe';
import type { createAdminClient, createPlatformClient } from '@/lib/supabase/admin';
import { WebhookService } from '@/lib/services/webhook-service';
import {
  buildSubscriptionCreatedPayload,
  buildSubscriptionUpdatedPayload,
  buildSubscriptionCanceledPayload,
  buildSubscriptionTrialEndingPayload,
  buildInvoicePaidPayload,
  buildInvoicePaymentFailedPayload,
  type SubProductSummary,
  type SubCustomerSummary,
} from '@/lib/services/subscription-webhook-payload';

type AdminClient = ReturnType<typeof createAdminClient>;
type PlatformClient = ReturnType<typeof createPlatformClient>;

interface HandlerResult {
  processed: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function periodStart(sub: Stripe.Subscription): string | null {
  const ts = sub.items.data[0]?.current_period_start;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

function periodEnd(sub: Stripe.Subscription): string | null {
  const ts = sub.items.data[0]?.current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

function isoOrNull(unix: number | null | undefined): string | null {
  return unix || unix === 0 ? new Date(unix * 1000).toISOString() : null;
}

async function fetchProductForSummary(
  supabase: AdminClient,
  productId: string
): Promise<(SubProductSummary & { stripe_price_id: string | null }) | null> {
  const { data } = await supabase
    .from('products')
    .select('id, name, slug, currency, recurring_price, billing_interval, billing_interval_count, stripe_price_id')
    .eq('id', productId)
    .single();
  if (!data) return null;
  return data as SubProductSummary & { stripe_price_id: string | null };
}

/**
 * Resolve product UUID from Stripe subscription metadata. We persist this on
 * `subscription_data.metadata.product_id` at checkout time (Phase 2).
 */
function productIdFromSubscription(sub: Stripe.Subscription): string | null {
  return (sub.metadata?.product_id as string) || null;
}

async function findOrCreatePasswordlessUser(
  platformClient: PlatformClient,
  email: string
): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();

  const { data: existing, error: rpcErr } = await platformClient.rpc(
    'find_user_id_by_email',
    { p_email: normalizedEmail }
  );
  if (!rpcErr && typeof existing === 'string' && existing.length > 0) {
    return existing;
  }

  const { data: created, error: createErr } = await platformClient.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    // Race: another webhook created the user between RPC + create. Retry RPC once.
    const { data: again } = await platformClient.rpc('find_user_id_by_email', {
      p_email: normalizedEmail,
    });
    if (typeof again === 'string' && again.length > 0) return again;
    throw new Error(
      `findOrCreatePasswordlessUser failed: ${createErr?.message ?? 'no user returned'}`
    );
  }
  return created.user.id;
}

async function ensureStripeCustomerMapping(
  supabase: AdminClient,
  userId: string,
  stripeCustomerId: string
): Promise<void> {
  const { error } = await supabase.from('stripe_customers').upsert(
    {
      user_id: userId,
      stripe_customer_id: stripeCustomerId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  if (error) console.error('[ensureStripeCustomerMapping] upsert error:', error);
}

interface SubscriptionContext {
  userId: string;
  productId: string;
  product: SubProductSummary;
  email: string;
  stripeCustomerId: string;
  /**
   * Status of the existing seller_main.subscriptions row at the moment
   * we resolved context, BEFORE this webhook's upsertSubscriptionRow
   * runs. Lets the caller decide based on the DB-known state instead of
   * the Stripe-API-side state which may be stale (cached / out-of-order
   * delivery). `null` for first webhook events.
   */
  priorStatus: string | null;
}

type SubscriptionContextResult =
  | { ok: true; ctx: SubscriptionContext }
  | { ok: false; reason: string };

/**
 * ensure the Stripe subscription item actually matches the Sellf
 * product the metadata points at. `subscription.metadata.product_id` is a
 * mutable hint — anyone with a Stripe write key can change it. Cross-check the
 * Stripe-managed price (currency, recurring, unit amount) against our stored
 * product before we grant access.
 */
function validateStripePriceMatchesProduct(
  sub: Stripe.Subscription,
  product: SubProductSummary
): { ok: true } | { ok: false; reason: string } {
  const item = sub.items.data[0];
  const price = (item as unknown as {
    price?: {
      unit_amount?: number | null;
      currency?: string;
      recurring?: { interval?: string; interval_count?: number };
    };
  })?.price;
  if (!price) return { ok: false, reason: 'Stripe subscription has no price item' };

  const expectedAmount =
    product.recurring_price != null ? Math.round(product.recurring_price * 100) : null;
  if (expectedAmount == null) {
    return { ok: false, reason: 'Sellf product is missing recurring_price' };
  }
  if (price.unit_amount !== expectedAmount) {
    return {
      ok: false,
      reason: `Price mismatch: Stripe=${price.unit_amount} vs product=${expectedAmount}`,
    };
  }

  if (price.currency && product.currency && price.currency.toLowerCase() !== product.currency.toLowerCase()) {
    return {
      ok: false,
      reason: `Currency mismatch: Stripe=${price.currency} vs product=${product.currency}`,
    };
  }

  const interval = price.recurring?.interval;
  if (product.billing_interval && interval !== product.billing_interval) {
    return {
      ok: false,
      reason: `Interval mismatch: Stripe=${interval} vs product=${product.billing_interval}`,
    };
  }
  const intervalCount = price.recurring?.interval_count ?? 1;
  if (product.billing_interval_count && intervalCount !== product.billing_interval_count) {
    return {
      ok: false,
      reason: `Interval count mismatch: Stripe=${intervalCount} vs product=${product.billing_interval_count}`,
    };
  }
  return { ok: true };
}

async function resolveSubscriptionContext(
  supabase: AdminClient,
  platformClient: PlatformClient,
  sub: Stripe.Subscription,
  email: string
): Promise<SubscriptionContextResult> {
  // The first webhook for a given stripe_subscription_id stores the
  // product_id mapping in seller_main.subscriptions. Subsequent events read
  // back the stored binding instead of trusting subscription.metadata, and
  // also load the per-sub stripe_price_id captured at first webhook so the
  // binding survives admin product-price rollover.
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('product_id, stripe_price_id, user_id, status')
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle();

  const metaProductId = productIdFromSubscription(sub);
  const subPriceId = (sub.items.data[0] as unknown as { price?: { id?: string } })?.price?.id;
  if (!subPriceId) {
    console.error('[resolveSubscriptionContext] subscription has no item price id', sub.id);
    return { ok: false, reason: 'Subscription item is missing a Stripe price id' };
  }

  let productId: string;
  if (existingSub?.product_id) {
    // Binding exists. Trust it; metadata is informational only.
    productId = existingSub.product_id;
    if (metaProductId && metaProductId !== productId) {
      console.error(
        '[resolveSubscriptionContext] metadata_product_mismatch | sub=%s | bound_product=%s | metadata_product=%s',
        sub.id,
        productId,
        metaProductId
      );
      return {
        ok: false,
        reason: 'Subscription metadata mismatch with stored product binding',
      };
    }

    // If the bound stripe_price_id has changed, the new price must still
    // belong to the same Sellf product (admin rolled the product price).
    if (existingSub.stripe_price_id && existingSub.stripe_price_id !== subPriceId) {
      const { data: priceOwner } = await supabase
        .from('products')
        .select('id')
        .eq('stripe_price_id', subPriceId)
        .maybeSingle();
      if (!priceOwner || priceOwner.id !== productId) {
        console.error(
          '[resolveSubscriptionContext] price_owner_mismatch | sub=%s | bound_product=%s | new_price=%s | new_price_product=%s',
          sub.id,
          productId,
          subPriceId,
          priceOwner?.id ?? 'unknown'
        );
        return {
          ok: false,
          reason: 'Subscription price id changed to a price owned by a different product',
        };
      }
      // Same product, new price — accept and let upsert refresh the binding.
    }
  } else {
    // First event for this subscription. Establish binding from metadata.
    if (!metaProductId) {
      console.error('[resolveSubscriptionContext] missing metadata.product_id on sub', sub.id);
      return { ok: false, reason: 'Subscription missing metadata.product_id' };
    }
    productId = metaProductId;
  }

  const product = await fetchProductForSummary(supabase, productId);
  if (!product) {
    console.error('[resolveSubscriptionContext] product not found:', productId);
    return { ok: false, reason: 'Product not found' };
  }

  // First-event price-id check. Subsequent events use the per-sub binding
  // above, which is immune to product-level rollover.
  if (!existingSub) {
    if (product.stripe_price_id && product.stripe_price_id !== subPriceId) {
      console.error(
        '[resolveSubscriptionContext] price_id_mismatch | sub=%s | sub_price=%s | product=%s | product_price=%s',
        sub.id,
        subPriceId,
        productId,
        product.stripe_price_id
      );
      return {
        ok: false,
        reason: 'Stripe price id does not match the bound product',
      };
    }
  }

  // Shape check ONLY for first events. After the per-sub binding is in
  // place, the historical pricing terms are immutable — comparing them
  // against the current (mutable) product would reject legitimate
  // subsequent webhooks for subscriptions whose product has since been edited.
  if (!existingSub) {
    const priceCheck = validateStripePriceMatchesProduct(sub, product);
    if (!priceCheck.ok) {
      console.error(
        '[resolveSubscriptionContext] STRIPE_PRICE_MISMATCH | sub=%s | product=%s | reason=%s',
        sub.id,
        productId,
        priceCheck.reason
      );
      return { ok: false, reason: priceCheck.reason };
    }
  }

  // Pin user_id to the first-event binding. A later invoice whose email
  // points at a different mailbox (Stripe-side email edit) must not move
  // the subscription to a freshly-materialized user — same rationale as
  // product_id and stripe_price_id pinning above.
  const userId = existingSub?.user_id
    ? existingSub.user_id
    : await findOrCreatePasswordlessUser(platformClient, email);
  const stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  await ensureStripeCustomerMapping(supabase, userId, stripeCustomerId);
  const priorStatus = existingSub?.status ?? null;
  return {
    ok: true,
    ctx: { userId, productId, product, email, stripeCustomerId, priorStatus },
  };
}

async function upsertSubscriptionRow(
  supabase: AdminClient,
  ctx: SubscriptionContext,
  sub: Stripe.Subscription
): Promise<string | null> {
  const subPriceId = (sub.items.data[0] as unknown as { price?: { id?: string } })?.price?.id ?? null;
  const { data, error } = await supabase
    .from('subscriptions')
    .upsert(
      {
        user_id: ctx.userId,
        product_id: ctx.productId,
        stripe_customer_id: ctx.stripeCustomerId,
        stripe_subscription_id: sub.id,
        // per-sub binding survives product-level price rollover.
        stripe_price_id: subPriceId,
        status: sub.status,
        current_period_start: periodStart(sub),
        current_period_end: periodEnd(sub),
        cancel_at_period_end: sub.cancel_at_period_end,
        canceled_at: isoOrNull(sub.canceled_at),
        trial_end: isoOrNull(sub.trial_end),
        latest_invoice_id:
          typeof sub.latest_invoice === 'string'
            ? sub.latest_invoice
            : sub.latest_invoice?.id ?? null,
        metadata: sub.metadata ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'stripe_subscription_id' }
    )
    .select('id')
    .single();
  if (error) {
    console.error('[upsertSubscriptionRow] error:', error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Subscription statuses for which the customer should hold
 * `user_product_access`. Other statuses (incomplete, past_due, paused,
 * canceled, incomplete_expired, unpaid) leave access unchanged here —
 * they are handled by handleSubscriptionDeleted / handleInvoicePaymentFailed
 * or remain pending until the next state change.
 */
const STATUSES_GRANTING_ACCESS: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'trialing',
  'active',
]);

/**
 * Subscription statuses past the access lifecycle. A late invoice.paid
 * (Stripe out-of-order delivery, or a retry under RETRIABLE_EVENTS) for
 * a subscription in one of these states must book the revenue row but
 * not re-grant access — the customer is no longer entitled.
 */
const TERMINAL_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'canceled',
  'incomplete_expired',
  'unpaid',
]);

interface AccessMutationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Revoke or relink `user_product_access` when a specific subscription
 * leaves the access lifecycle. If the access row is currently linked
 * to that subscription:
 *   - relink to a sibling subscription on the same (user, product) that
 *     is still trialing/active (most-recently-paid first), or
 *   - delete the access row when no sibling is available.
 * If the access row points at a different subscription, it is left
 * untouched.
 *
 * Returns `{ ok: false }` on any DB error so callers can decide whether
 * to escalate (force a Stripe retry) or log and continue.
 */
export async function revokeUserProductAccessForSubscription(
  supabase: AdminClient,
  userId: string,
  productId: string,
  subscriptionRowId: string
): Promise<AccessMutationResult> {
  const { data: accessRow, error: accessErr } = await supabase
    .from('user_product_access')
    .select('id, subscription_id')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .maybeSingle();
  if (accessErr) {
    console.error('[revokeUserProductAccess] access lookup error:', accessErr);
    return { ok: false, reason: 'access lookup failed' };
  }

  if (!accessRow || accessRow.subscription_id !== subscriptionRowId) {
    return { ok: true };
  }

  const { data: siblings, error: siblingErr } = await supabase
    .from('subscriptions')
    .select('id, status, current_period_end')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .neq('id', subscriptionRowId)
    .in('status', ['active', 'trialing'])
    .order('current_period_end', { ascending: false })
    .limit(1);
  if (siblingErr) {
    console.error('[revokeUserProductAccess] sibling lookup error:', siblingErr);
    return { ok: false, reason: 'sibling lookup failed' };
  }
  const sibling = siblings?.[0];

  if (sibling) {
    const { error: relinkErr } = await supabase
      .from('user_product_access')
      .update({ subscription_id: sibling.id })
      .eq('id', accessRow.id);
    if (relinkErr) {
      console.error('[revokeUserProductAccess] relink error:', relinkErr);
      return { ok: false, reason: 'relink failed' };
    }
    return { ok: true };
  }

  const { error: deleteErr } = await supabase
    .from('user_product_access')
    .delete()
    .eq('id', accessRow.id);
  if (deleteErr) {
    console.error('[revokeUserProductAccess] delete error:', deleteErr);
    return { ok: false, reason: 'delete failed' };
  }
  return { ok: true };
}

/**
 * Insert or refresh the `user_product_access` row for (user_id, product_id),
 * pointing it at the supplied subscription row. Idempotent: at most one row
 * per (user_id, product_id) by UNIQUE constraint.
 *
 * Returns `{ ok: false }` on any DB error so callers can decide whether
 * to escalate (force a Stripe retry on retriable events) or log and
 * continue (best-effort on subscription.created/updated).
 */
export async function upsertUserProductAccess(
  supabase: AdminClient,
  userId: string,
  productId: string,
  subscriptionRowId: string
): Promise<AccessMutationResult> {
  const { data: existingAccess, error: lookupErr } = await supabase
    .from('user_product_access')
    .select('id')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .maybeSingle();
  if (lookupErr) {
    console.error('[upsertUserProductAccess] lookup error:', lookupErr);
    return { ok: false, reason: 'access lookup failed' };
  }
  if (existingAccess) {
    const { error: updateErr } = await supabase
      .from('user_product_access')
      .update({
        subscription_id: subscriptionRowId,
        access_granted_at: new Date().toISOString(),
      })
      .eq('id', existingAccess.id);
    if (updateErr) {
      console.error('[upsertUserProductAccess] update error:', updateErr);
      return { ok: false, reason: 'access update failed' };
    }
    return { ok: true };
  }
  const { error: insertErr } = await supabase.from('user_product_access').insert({
    user_id: userId,
    product_id: productId,
    subscription_id: subscriptionRowId,
    access_granted_at: new Date().toISOString(),
  });
  if (insertErr) {
    console.error('[upsertUserProductAccess] insert error:', insertErr);
    return { ok: false, reason: 'access insert failed' };
  }
  return { ok: true };
}

function customerSummary(userId: string, email: string): SubCustomerSummary {
  return { email, userId };
}

function customerEmailFromInvoiceOrSub(
  invoice?: Stripe.Invoice,
  sub?: Stripe.Subscription
): string | null {
  if (invoice?.customer_email) return invoice.customer_email;
  if (typeof invoice?.customer === 'object' && invoice?.customer && !invoice.customer.deleted) {
    return invoice.customer.email ?? null;
  }
  if (sub && typeof sub.customer === 'object' && !sub.customer.deleted) {
    return sub.customer.email ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// customer.subscription.created
// ---------------------------------------------------------------------------

export async function handleSubscriptionCreated(
  sub: Stripe.Subscription,
  supabase: AdminClient,
  platformClient: PlatformClient,
  stripe: Stripe
): Promise<HandlerResult> {
  let email = customerEmailFromInvoiceOrSub(undefined, sub);
  if (!email) {
    const customer = await stripe.customers.retrieve(
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    );
    if (customer.deleted) return { processed: false, message: 'Customer is deleted' };
    email = customer.email ?? null;
  }
  if (!email) return { processed: false, message: 'No email on customer' };

  const ctxResult = await resolveSubscriptionContext(supabase, platformClient, sub, email);
  if (!ctxResult.ok) return { processed: false, message: ctxResult.reason };
  const ctx = ctxResult.ctx;

  const subscriptionRowId = await upsertSubscriptionRow(supabase, ctx, sub);

  // Stripe doesn't issue an invoice during a default-behavior trial, so
  // invoice.paid won't grant access until the trial ends. Grant on the
  // create event for trialing/active so the customer gets access immediately.
  // Best-effort: a transient failure here is recoverable by the next
  // invoice.paid (retriable) or by a subsequent customer.subscription.updated.
  if (subscriptionRowId && STATUSES_GRANTING_ACCESS.has(sub.status)) {
    const r = await upsertUserProductAccess(supabase, ctx.userId, ctx.productId, subscriptionRowId);
    if (!r.ok) {
      console.warn('[handleSubscriptionCreated] access grant failed (best-effort):', r.reason);
    }
  }

  const payload = buildSubscriptionCreatedPayload({
    customer: customerSummary(ctx.userId, ctx.email),
    product: ctx.product,
    subscription: sub,
  });
  await WebhookService.trigger('subscription.created', payload, supabase);

  return { processed: true, message: `Subscription created: ${sub.id}` };
}

// ---------------------------------------------------------------------------
// customer.subscription.updated
// ---------------------------------------------------------------------------

export async function handleSubscriptionUpdated(
  sub: Stripe.Subscription,
  supabase: AdminClient,
  platformClient: PlatformClient,
  stripe: Stripe,
  previousAttributes?: Partial<Stripe.Subscription>
): Promise<HandlerResult> {
  let email = customerEmailFromInvoiceOrSub(undefined, sub);
  if (!email) {
    const customer = await stripe.customers.retrieve(
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    );
    if (customer.deleted) return { processed: false, message: 'Customer is deleted' };
    email = customer.email ?? null;
  }
  if (!email) return { processed: false, message: 'No email on customer' };

  const ctxResult = await resolveSubscriptionContext(supabase, platformClient, sub, email);
  if (!ctxResult.ok) return { processed: false, message: ctxResult.reason };
  const ctx = ctxResult.ctx;

  const subscriptionRowId = await upsertSubscriptionRow(supabase, ctx, sub);

  // Mirror the create-event grant for transitions like incomplete -> active,
  // past_due -> active, or trialing -> active. Without this, the customer
  // is paywalled until the next invoice.paid lands. customer.subscription.updated
  // is in RETRIABLE_EVENTS so a transient failure forces a Stripe redelivery;
  // upsertUserProductAccess is idempotent, so the redelivery either lands
  // the grant or no-ops on the existing row.
  if (subscriptionRowId && STATUSES_GRANTING_ACCESS.has(sub.status)) {
    const r = await upsertUserProductAccess(supabase, ctx.userId, ctx.productId, subscriptionRowId);
    if (!r.ok) {
      console.error('[handleSubscriptionUpdated] access grant failed:', r.reason);
      return { processed: false, message: `Access grant failed: ${r.reason}` };
    }
  }

  // Mirror handleSubscriptionDeleted on the revocation axis. Stripe's
  // default dunning (mark-as-unpaid) leaves a sub at 'unpaid' indefinitely
  // without firing customer.subscription.deleted, so the update event is
  // the only signal we get for that transition. incomplete_expired follows
  // the same rule. Escalate on failure so the Stripe retry actually
  // revokes access — there is no fall-back event to recover from.
  if (subscriptionRowId && TERMINAL_STATUSES.has(sub.status)) {
    const r = await revokeUserProductAccessForSubscription(
      supabase,
      ctx.userId,
      ctx.productId,
      subscriptionRowId,
    );
    if (!r.ok) {
      console.error('[handleSubscriptionUpdated] access revoke failed:', r.reason);
      return { processed: false, message: `Access revoke failed: ${r.reason}` };
    }
  }

  const payload = buildSubscriptionUpdatedPayload({
    customer: customerSummary(ctx.userId, ctx.email),
    product: ctx.product,
    subscription: sub,
    previousAttributes,
  });
  await WebhookService.trigger('subscription.updated', payload, supabase);

  return { processed: true, message: `Subscription updated: ${sub.id}` };
}

// ---------------------------------------------------------------------------
// customer.subscription.deleted (final cancel)
// ---------------------------------------------------------------------------

export async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
  supabase: AdminClient,
  platformClient: PlatformClient,
  stripe: Stripe
): Promise<HandlerResult> {
  let email = customerEmailFromInvoiceOrSub(undefined, sub);
  if (!email) {
    const customer = await stripe.customers.retrieve(
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    );
    if (customer.deleted) return { processed: false, message: 'Customer is deleted' };
    email = customer.email ?? null;
  }
  if (!email) return { processed: false, message: 'No email on customer' };

  const ctxResult = await resolveSubscriptionContext(supabase, platformClient, sub, email);
  if (!ctxResult.ok) return { processed: false, message: ctxResult.reason };
  const ctx = ctxResult.ctx;

  const subscriptionRowId = await upsertSubscriptionRow(supabase, ctx, sub);

  if (subscriptionRowId) {
    const r = await revokeUserProductAccessForSubscription(
      supabase,
      ctx.userId,
      ctx.productId,
      subscriptionRowId,
    );
    // customer.subscription.deleted is in RETRIABLE_EVENTS; surface the
    // failure so Stripe redelivers and the revocation eventually lands.
    if (!r.ok) {
      console.error('[handleSubscriptionDeleted] access revoke failed:', r.reason);
      return { processed: false, message: `Access revoke failed: ${r.reason}` };
    }
  }

  const payload = buildSubscriptionCanceledPayload({
    customer: customerSummary(ctx.userId, ctx.email),
    product: ctx.product,
    subscription: sub,
  });
  await WebhookService.trigger('subscription.canceled', payload, supabase);

  return { processed: true, message: `Subscription canceled: ${sub.id}` };
}

// ---------------------------------------------------------------------------
// customer.subscription.trial_will_end
// ---------------------------------------------------------------------------

export async function handleSubscriptionTrialWillEnd(
  sub: Stripe.Subscription,
  supabase: AdminClient,
  platformClient: PlatformClient,
  stripe: Stripe
): Promise<HandlerResult> {
  let email = customerEmailFromInvoiceOrSub(undefined, sub);
  if (!email) {
    const customer = await stripe.customers.retrieve(
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    );
    if (customer.deleted) return { processed: false, message: 'Customer is deleted' };
    email = customer.email ?? null;
  }
  if (!email) return { processed: false, message: 'No email on customer' };

  const ctxResult = await resolveSubscriptionContext(supabase, platformClient, sub, email);
  if (!ctxResult.ok) return { processed: false, message: ctxResult.reason };
  const ctx = ctxResult.ctx;

  const payload = buildSubscriptionTrialEndingPayload({
    customer: customerSummary(ctx.userId, ctx.email),
    product: ctx.product,
    subscription: sub,
  });
  await WebhookService.trigger('subscription.trial_ending', payload, supabase);

  return { processed: true, message: `Trial ending soon: ${sub.id}` };
}

// ---------------------------------------------------------------------------
// invoice.paid (source of truth for user_product_access)
// ---------------------------------------------------------------------------

export async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  supabase: AdminClient,
  platformClient: PlatformClient,
  stripe: Stripe
): Promise<HandlerResult> {
  const subscriptionId = extractSubscriptionId(invoice);
  if (!subscriptionId) {
    return { processed: true, message: 'Skipped: invoice not tied to a subscription' };
  }

  // Idempotency: if we already booked this invoice, exit fast.
  const { data: existingTx } = await supabase
    .from('payment_transactions')
    .select('id')
    .eq('stripe_invoice_id', invoice.id!)
    .maybeSingle();
  if (existingTx) {
    return { processed: true, message: `Invoice already booked: ${invoice.id}` };
  }

  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  let email = customerEmailFromInvoiceOrSub(invoice, sub);
  if (!email) {
    const customer = await stripe.customers.retrieve(
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer!.id
    );
    if (customer.deleted) return { processed: false, message: 'Customer is deleted' };
    email = customer.email ?? null;
  }
  if (!email) return { processed: false, message: 'No email on invoice or customer' };

  const ctxResult = await resolveSubscriptionContext(supabase, platformClient, sub, email);
  if (!ctxResult.ok) return { processed: false, message: ctxResult.reason };
  const ctx = ctxResult.ctx;

  const subscriptionRowId = await upsertSubscriptionRow(supabase, ctx, sub);
  if (!subscriptionRowId) {
    return { processed: false, message: 'Could not upsert subscription row' };
  }

  // Insert payment_transactions row (idempotent via UNIQUE on stripe_invoice_id).
  const paymentIntentId =
    typeof (invoice as unknown as { payment_intent?: string | { id: string } }).payment_intent ===
    'string'
      ? ((invoice as unknown as { payment_intent: string }).payment_intent)
      : ((invoice as unknown as { payment_intent?: { id: string } }).payment_intent?.id ?? null);

  const { error: txError } = await supabase.from('payment_transactions').insert({
    user_id: ctx.userId,
    product_id: ctx.productId,
    subscription_id: subscriptionRowId,
    stripe_invoice_id: invoice.id,
    // Subscription renewals don't have a Checkout Session; use the invoice id
    // directly (allowed by the extended session_id regex in subscriptions_mvp migration).
    session_id: invoice.id!,
    stripe_payment_intent_id: paymentIntentId,
    // payment_transactions.amount is stored in minor units to match one-time
    // payment rows. Stripe invoice.amount_paid is already in minor units.
    amount: invoice.amount_paid ?? 0,
    currency: (invoice.currency ?? 'usd').toUpperCase(),
    status: 'completed',
    customer_email: ctx.email,
  });
  // payment_transactions.stripe_invoice_id has a partial UNIQUE index.
  // If we lost the race to the primary processor, exit BEFORE access mutation
  // and BEFORE outbound dispatch — the winner has already done both.
  // Any other insert error is a hard failure: do not partially apply changes.
  if (txError) {
    if (txError.code === '23505') {
      return { processed: true, message: `Invoice already booked (race): ${invoice.id}` };
    }
    console.error('[handleInvoicePaid] payment_transactions insert error:', txError);
    return { processed: false, message: 'payment_transactions insert failed' };
  }

  // Grant or refresh access. user_product_access has UNIQUE (user_id, product_id)
  // (see core_schema.sql:164), so there is exactly one row per pair.
  // Skip for terminal-status subscriptions — a late invoice.paid arriving
  // after the subscription was canceled / expired must not restore access.
  // Two-source gate: sub.status from stripe.subscriptions.retrieve can lag
  // the live state (cache / out-of-order delivery). ctx.priorStatus is
  // the DB-side row read BEFORE upsertSubscriptionRow ran, so even if
  // Stripe API hands us stale 'active', the DB-known terminal state
  // still blocks the grant.
  // invoice.paid is in RETRIABLE_EVENTS; surface helper failures so a
  // transient DB error forces a Stripe redelivery instead of silent loss.
  const stripeSideTerminal = TERMINAL_STATUSES.has(sub.status);
  const dbSideTerminal =
    ctx.priorStatus !== null &&
    TERMINAL_STATUSES.has(ctx.priorStatus as Stripe.Subscription.Status);
  if (!stripeSideTerminal && !dbSideTerminal) {
    const r = await upsertUserProductAccess(supabase, ctx.userId, ctx.productId, subscriptionRowId);
    if (!r.ok) {
      console.error('[handleInvoicePaid] access grant failed:', r.reason);
      return { processed: false, message: `Access grant failed: ${r.reason}` };
    }
  }

  const payload = buildInvoicePaidPayload({
    customer: customerSummary(ctx.userId, ctx.email),
    product: ctx.product,
    subscriptionId: sub.id,
    invoice,
  });
  await WebhookService.trigger('invoice.paid', payload, supabase);

  return {
    processed: true,
    message: `Invoice paid: ${invoice.id}`,
  };
}

// ---------------------------------------------------------------------------
// invoice.payment_failed + invoice.payment_action_required
// ---------------------------------------------------------------------------

export async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  supabase: AdminClient,
  platformClient: PlatformClient,
  stripe: Stripe
): Promise<HandlerResult> {
  const subscriptionId = extractSubscriptionId(invoice);
  if (!subscriptionId) {
    return { processed: true, message: 'Skipped: invoice not tied to a subscription' };
  }

  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  let email = customerEmailFromInvoiceOrSub(invoice, sub);
  if (!email) {
    const customer = await stripe.customers.retrieve(
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer!.id
    );
    if (customer.deleted) return { processed: false, message: 'Customer is deleted' };
    email = customer.email ?? null;
  }
  if (!email) return { processed: false, message: 'No email on invoice' };

  const ctxResult = await resolveSubscriptionContext(supabase, platformClient, sub, email);
  if (!ctxResult.ok) return { processed: false, message: ctxResult.reason };
  const ctx = ctxResult.ctx;

  await upsertSubscriptionRow(supabase, ctx, sub);

  const payload = buildInvoicePaymentFailedPayload({
    customer: customerSummary(ctx.userId, ctx.email),
    product: ctx.product,
    subscriptionId: sub.id,
    subscriptionStatus: sub.status,
    invoice,
  });
  await WebhookService.trigger('invoice.payment_failed', payload, supabase);

  return { processed: true, message: `Invoice payment failed: ${invoice.id}` };
}

// ---------------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------------

function extractSubscriptionId(invoice: Stripe.Invoice): string | null {
  const fromTopLevel = (invoice as unknown as { subscription?: string | { id: string } | null })
    .subscription;
  if (typeof fromTopLevel === 'string') return fromTopLevel;
  if (fromTopLevel && typeof fromTopLevel === 'object') return fromTopLevel.id;

  const lineSub = invoice.lines?.data?.find((line) => {
    const candidate = (line as unknown as { subscription?: string | { id: string } | null })
      .subscription;
    return typeof candidate === 'string' || (candidate && typeof candidate === 'object');
  });
  if (lineSub) {
    const candidate = (lineSub as unknown as { subscription?: string | { id: string } })
      .subscription;
    if (typeof candidate === 'string') return candidate;
    if (candidate && typeof candidate === 'object') return candidate.id;
  }
  return null;
}
