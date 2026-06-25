/**
 * One-time payment webhook handlers, extracted from route.ts (Option A).
 *
 * handleCheckoutSessionCompleted + handlePaymentIntentSucceeded (and the shared
 * revalidatePurchaseTags helper) live here so they are independently importable and
 * testable. route.ts imports them and dispatches from POST. Behavior is unchanged —
 * this is a 1:1 move; the behavioral suite tests/unit/webhooks/onetime-payment-handlers.behavioral
 * is the regression net for it.
 *
 * @see src/app/api/webhooks/stripe/route.ts
 */

import { revalidateTag } from 'next/cache';
import type Stripe from 'stripe';
import { getStripeServer } from '@/lib/stripe/server';
import { WebhookService } from '@/lib/services/webhook-service';
import { buildPurchaseWebhookPayload } from '@/lib/services/webhook-payload';
import { captureAndPersistOrderTax } from '@/lib/services/tax-snapshot';
import { issueLicense } from '@/lib/license-keys/issue';
import { resolveComponentProductIds, issueLicensesForOrder } from '@/lib/services/bundle-order';
import { trackServerSideConversion, generatePurchaseEventId } from '@/lib/tracking';
import { createAdminClient } from '@/lib/supabase/admin';
import { redactEmail } from '@/lib/logger';

function revalidatePurchaseTags(productSlug: unknown): void {
  if (typeof productSlug !== 'string' || productSlug.length === 0) return;
  revalidateTag('recent-supporters', { expire: 0 });
  revalidateTag(`product:${productSlug}`, { expire: 0 });
}

/**
 * Process successful payment from checkout session.
 */
export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ processed: boolean; message: string }> {
  // Subscription checkouts are handled end-to-end by the
  // customer.subscription.created + invoice.paid handlers in
  // subscription-handlers.ts. This handler stays scoped to the
  // one-time-payment surface.
  if (session.mode === 'subscription') {
    return { processed: true, message: 'Skipped: subscription mode (handled by invoice.paid)' };
  }

  const sessionId = session.id;
  const productId = session.metadata?.product_id;
  const customerEmail = session.customer_details?.email || session.customer_email;

  if (!productId || !customerEmail) {
    return { processed: false, message: 'Missing product_id or customer_email in session' };
  }

  const userId = session.metadata?.user_id || null;

  // Idempotency check: Skip only if already completed (not pending).
  // Checkout Sessions Elements creates a pending row before payment; the webhook
  // must still process it and attach the eventual PaymentIntent ID.
  const { data: existingTransaction } = await supabase
    .from('payment_transactions')
    .select('id, status, stripe_payment_intent_id, custom_field_values')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (existingTransaction?.status === 'completed') {
    // Still try to issue license — covers purchases made before license feature was deployed.
    // issueLicense is idempotent by (order_id, product_id), so this is safe to call on replay.
    const replayPaymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent as { id?: string } | null)?.id ?? null;
    await issueLicense(supabase, {
      productId,
      email: customerEmail,
      userId,
      orderId: replayPaymentIntentId || sessionId,
      customFieldValues: (existingTransaction.custom_field_values as Record<string, string> | null) ?? undefined,
    });
    return { processed: true, message: `Already processed: ${existingTransaction.id}` };
  }

  // Extract metadata
  const bumpProductIdsStr = session.metadata?.bump_product_ids || '';
  const bumpProductId = session.metadata?.bump_product_id || null;
  const hasBump = session.metadata?.has_bump === 'true';
  const couponId = session.metadata?.coupon_id || null;
  const hasCoupon = session.metadata?.has_coupon === 'true';

  // Parse bump IDs: prefer comma-separated bump_product_ids, fallback to single bump_product_id
  let bumpProductIds: string[] = bumpProductIdsStr
    ? bumpProductIdsStr.split(',').filter((id: string) => id.length > 0)
    : (hasBump && bumpProductId ? [bumpProductId] : []);

  // Get payment intent ID
  const stripePaymentIntentId = typeof session.payment_intent === 'object'
    ? session.payment_intent?.id
    : session.payment_intent;

  if (existingTransaction?.status === 'pending' && stripePaymentIntentId) {
    const { error: updatePendingError } = await supabase
      .from('payment_transactions')
      .update({ stripe_payment_intent_id: stripePaymentIntentId })
      .eq('id', existingTransaction.id)
      .eq('status', 'pending');

    if (updatePendingError) {
      console.error('[stripe-webhook] Failed to attach PaymentIntent ID to pending Checkout Session row:', updatePendingError);
    }
  }

  // Detect metadata truncation: bump_count tells us how many bumps were selected
  const expectedBumpCount = parseInt(session.metadata?.bump_count || '0', 10);
  if (expectedBumpCount > 0 && bumpProductIds.length < expectedBumpCount) {
    console.warn(
      '[stripe-webhook] BUMP_METADATA_TRUNCATED | session=%s | expected=%d | got=%d — fetching line items from Stripe',
      sessionId, expectedBumpCount, bumpProductIds.length
    );
    try {
      const stripe = await getStripeServer();
      const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
        limit: 100,
        expand: ['data.price.product'],
      });
      const recoveredIds: string[] = [];
      for (const li of lineItems.data) {
        const product = li.price?.product;
        if (typeof product === 'object' && product && 'metadata' in product) {
          const meta = (product as Stripe.Product).metadata;
          if (meta?.is_bump === 'true' && meta?.product_id) {
            recoveredIds.push(meta.product_id);
          }
        }
      }
      if (recoveredIds.length >= expectedBumpCount) {
        bumpProductIds = recoveredIds;
        console.info('[stripe-webhook] Recovered %d bump IDs from Stripe line items', recoveredIds.length);
      }
    } catch (lineItemErr) {
      console.error('[stripe-webhook] Failed to recover bump IDs from Stripe line items:', lineItemErr);
    }

    if (bumpProductIds.length < expectedBumpCount && existingTransaction) {
      const { data: pendingTx } = await supabase
        .from('payment_transactions')
        .select('metadata')
        .eq('id', existingTransaction.id)
        .single();
      const fullBumpIds = (pendingTx?.metadata as Record<string, unknown>)?.bump_product_ids_full;
      if (Array.isArray(fullBumpIds) && fullBumpIds.length >= expectedBumpCount) {
        bumpProductIds = fullBumpIds as string[];
        console.info('[stripe-webhook] Recovered %d bump IDs from pending Checkout Session metadata', fullBumpIds.length);
      }
    }
  }

  // Process payment using database function (multi-bump aware)
  const { data: rawResult, error } = await supabase.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: sessionId,
    product_id_param: productId,
    customer_email_param: customerEmail,
    amount_total: session.amount_total || 0,
    currency_param: session.currency || 'usd',
    stripe_payment_intent_id: stripePaymentIntentId || undefined,
    user_id_param: userId && userId !== '' ? userId : undefined,
    bump_product_ids_param: bumpProductIds.length > 0 ? bumpProductIds : undefined,
    coupon_id_param: hasCoupon && couponId ? couponId : undefined,
    // Net subtotal: net-priced products validate the NET amount, not the gross.
    amount_subtotal_param: session.amount_subtotal ?? undefined,
  });
  const result = rawResult as Record<string, unknown> | null;

  if (error) {
    console.error(
      '[stripe-webhook] PAYMENT_DB_FAILURE | session=%s | product=%s | email=%s | coupon_id=%s | amount=%d cents | error=%s (code=%s)',
      sessionId, productId, redactEmail(customerEmail), couponId ?? 'none',
      session.amount_total, error.message, error.code
    );
    return { processed: false, message: 'Payment processing failed' };
  }

  if (!result?.success) {
    console.error(
      '[stripe-webhook] PAYMENT_DB_REJECTED | session=%s | product=%s | email=%s | coupon_id=%s | amount=%d cents | reason=%s',
      sessionId, productId, redactEmail(customerEmail), couponId ?? 'none',
      session.amount_total, result?.error ?? 'unknown'
    );
    return { processed: false, message: (result?.error as string) || 'Payment processing failed' };
  }

  // Resolve bundle components (ordered) — [] for a non-bundle product. A bundle grants
  // the bundle + every component (DB), and we issue a license per licensable product below.
  const componentProductIds = await resolveComponentProductIds(supabase, productId);

  // Issue licenses — always, regardless of already_had_access. One per licensable product in
  // [productId, ...componentProductIds]. issueLicense is idempotent by (order_id, product_id);
  // replays return the existing token. Prefer payment-intent id: both webhook paths use it so the
  // unique constraint backs idempotency.
  const { data: txCustomFields } = await supabase
    .from('payment_transactions')
    .select('id, custom_field_values')
    .eq('session_id', sessionId)
    .maybeSingle();
  const customFieldValues = (txCustomFields?.custom_field_values as Record<string, string> | null) ?? undefined;

  const licenses = await issueLicensesForOrder(supabase, {
    productIds: [productId, ...componentProductIds],
    email: customerEmail,
    userId,
    orderId: stripePaymentIntentId || sessionId,
    customFieldValues,
  });

  const isExplicitRepurchase = session.metadata?.repurchase === 'true';

  // Trigger internal webhook for purchase.completed
  if (!result.already_had_access || isExplicitRepurchase) {
    // VAT tax snapshot — capture Stripe's computed tax per line. Fail-safe.
    const stripe = await getStripeServer();
    const taxSnapshot = await captureAndPersistOrderTax({
      stripe,
      supabase,
      transactionId: txCustomFields?.id,
      sessionId,
    });

    // Pull buyer's custom-field answers so the webhook payload + admin UI can
    // surface them. They were written by the checkout PaymentIntent flow on
    // the same payment_transactions row keyed by session_id.
    const webhookData = await buildPurchaseWebhookPayload({
      supabaseClient: supabase,
      customerEmail,
      userId,
      productId,
      bumpProductIds,
      componentProductIds,
      metadata: session.metadata as Record<string, string | undefined> | null,
      // Embed collects NIP/address via Stripe → carry them to the invoice section.
      stripeCustomerDetails: session.customer_details,
      amount: session.amount_total,
      currency: session.currency,
      sessionId,
      taxSnapshot,
      paymentIntentId: stripePaymentIntentId,
      couponId: hasCoupon && couponId ? couponId : null,
      isGuest: result.is_guest_purchase as boolean,
      source: 'stripe_webhook',
      customFieldValues: customFieldValues ?? null,
    });

    if (licenses.length) webhookData.licenses = licenses;

    // Server-side Purchase tracking via Facebook CAPI
    // Uses deterministic event_id for dedup with client-side (PaymentStatusView)
    const baseUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
    const productSlug = 'slug' in webhookData.product ? webhookData.product.slug : null;
    revalidatePurchaseTags(productSlug);
    const productName = 'name' in webhookData.product ? webhookData.product.name : 'Unknown Product';
    trackServerSideConversion({
      eventName: 'Purchase',
      eventId: generatePurchaseEventId(sessionId),
      eventSourceUrl: productSlug ? `${baseUrl}/p/${productSlug}` : baseUrl,
      value: (session.amount_total || 0) / 100,
      currency: (session.currency || 'usd').toUpperCase(),
      items: [{
        item_id: productId,
        item_name: productName,
        price: (session.amount_total || 0) / 100,
        quantity: 1,
      }],
      orderId: sessionId,
      userEmail: customerEmail,
    }).catch(err => console.error('[Stripe Webhook] FB CAPI Purchase tracking error:', err));

    WebhookService.trigger('purchase.completed', webhookData, supabase, [productId, ...componentProductIds, ...bumpProductIds])
      .catch(err => console.error('[Stripe Webhook] Internal webhook error:', err));
  }

  return { processed: true, message: `Payment processed: ${result.scenario}` };
}

/**
 * Process successful payment from payment intent (direct payment flow).
 */
export async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ processed: boolean; message: string }> {
  const productId = paymentIntent.metadata?.product_id;
  const customerEmail = paymentIntent.receipt_email || paymentIntent.metadata?.email;

  if (!productId || !customerEmail) {
    return { processed: false, message: 'Missing product_id or email in payment intent' };
  }

  const userId = paymentIntent.metadata?.user_id || null;

  // Fast idempotency check by PI ID (UNIQUE column — no multi-row risk from concurrent handlers).
  const { data: byPI } = await supabase
    .from('payment_transactions')
    .select('id, status, custom_field_values')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .maybeSingle();

  if (byPI?.status === 'completed') {
    await issueLicense(supabase, {
      productId,
      email: customerEmail,
      userId,
      orderId: paymentIntent.id,
      customFieldValues: (byPI.custom_field_values as Record<string, string> | null) ?? undefined,
    });
    return { processed: true, message: `Already processed: ${byPI.id}` };
  }

  // Fallback: direct payment flow where PI id is also used as session_id.
  const { data: existingTransaction } = await supabase
    .from('payment_transactions')
    .select('id, status, custom_field_values')
    .eq('session_id', paymentIntent.id)
    .maybeSingle();

  if (existingTransaction?.status === 'completed') {
    await issueLicense(supabase, {
      productId,
      email: customerEmail,
      userId,
      orderId: paymentIntent.id,
      customFieldValues: (existingTransaction.custom_field_values as Record<string, string> | null) ?? undefined,
    });
    return { processed: true, message: `Already processed: ${existingTransaction.id}` };
  }

  // Extract metadata (multi-bump aware)
  const bumpProductIdsStr = paymentIntent.metadata?.bump_product_ids || '';
  const bumpProductId = paymentIntent.metadata?.bump_product_id || null;
  const hasBump = paymentIntent.metadata?.has_bump === 'true';
  const couponId = paymentIntent.metadata?.coupon_id || null;

  // Parse bump IDs: prefer comma-separated bump_product_ids, fallback to single bump_product_id
  let bumpProductIds: string[] = bumpProductIdsStr
    ? bumpProductIdsStr.split(',').filter((id: string) => id.length > 0)
    : (hasBump && bumpProductId ? [bumpProductId] : []);

  // Detect metadata truncation: bump_count tells us how many bumps were selected
  const expectedBumpCount = parseInt(paymentIntent.metadata?.bump_count || '0', 10);
  if (expectedBumpCount > 0 && bumpProductIds.length < expectedBumpCount) {
    console.warn(
      '[stripe-webhook] BUMP_METADATA_TRUNCATED | pi=%s | expected=%d | got=%d — checking pending transaction',
      paymentIntent.id, expectedBumpCount, bumpProductIds.length
    );
    // byPI covers checkout-session flow (row keyed by cs_xxx, linked via stripe_payment_intent_id);
    // existingTransaction covers direct-payment flow (row keyed by pi_xxx as session_id).
    const pendingTxRef = byPI ?? existingTransaction;
    if (pendingTxRef) {
      const { data: pendingTx } = await supabase
        .from('payment_transactions')
        .select('metadata')
        .eq('id', pendingTxRef.id)
        .single();
      const fullBumpIds = (pendingTx?.metadata as Record<string, unknown>)?.bump_product_ids_full;
      if (Array.isArray(fullBumpIds) && fullBumpIds.length >= expectedBumpCount) {
        bumpProductIds = fullBumpIds as string[];
        console.info('[stripe-webhook] Recovered %d bump IDs from pending transaction metadata', fullBumpIds.length);
      }
    }
  }

  // Net subtotal for the completion validator: net-priced products validate the NET amount,
  // not the gross (Stripe adds VAT on top of exclusive prices, and the gross varies by
  // jurisdiction under Stripe Tax). Resolve the owning Checkout Session for amount_subtotal;
  // fail-safe → null falls back to the legacy gross check. (stripe is reused by capture below.)
  const stripe = await getStripeServer();
  let piAmountSubtotal: number | undefined;
  try {
    const ownerSessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntent.id, limit: 1 });
    piAmountSubtotal = ownerSessions.data[0]?.amount_subtotal ?? undefined;
  } catch {
    /* leave undefined — validator falls back to gross */
  }

  // Process payment using database function (multi-bump aware)
  const { data: rawResult2, error } = await supabase.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: paymentIntent.id,
    product_id_param: productId,
    customer_email_param: customerEmail,
    amount_total: paymentIntent.amount,
    currency_param: paymentIntent.currency,
    stripe_payment_intent_id: paymentIntent.id,
    user_id_param: userId && userId !== '' ? userId : undefined,
    bump_product_ids_param: bumpProductIds.length > 0 ? bumpProductIds : undefined,
    coupon_id_param: couponId || undefined,
    amount_subtotal_param: piAmountSubtotal,
  });
  const result = rawResult2 as Record<string, unknown> | null;

  if (error) {
    console.error(
      '[stripe-webhook] PAYMENT_DB_FAILURE | pi=%s | product=%s | email=%s | coupon_id=%s | amount=%d cents | error=%s (code=%s)',
      paymentIntent.id, productId, redactEmail(customerEmail), couponId ?? 'none',
      paymentIntent.amount, error.message, error.code
    );
    return { processed: false, message: 'Payment processing failed' };
  }

  if (!result?.success) {
    console.error(
      '[stripe-webhook] PAYMENT_DB_REJECTED | pi=%s | product=%s | email=%s | coupon_id=%s | amount=%d cents | reason=%s',
      paymentIntent.id, productId, redactEmail(customerEmail), couponId ?? 'none',
      paymentIntent.amount, result?.error ?? 'unknown'
    );
    return { processed: false, message: (result?.error as string) || 'Payment processing failed' };
  }

  // Resolve bundle components (ordered) — [] for a non-bundle product.
  const componentProductIds = await resolveComponentProductIds(supabase, productId);

  // Issue licenses — always, regardless of already_had_access. One per licensable product in
  // [productId, ...componentProductIds]. issueLicense is idempotent by (order_id, product_id);
  // replays return the existing token.
  const { data: txCustomFields } = await supabase
    .from('payment_transactions')
    .select('id, session_id, custom_field_values')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .maybeSingle();
  const customFieldValues = (txCustomFields?.custom_field_values as Record<string, string> | null) ?? undefined;

  const licenses = await issueLicensesForOrder(supabase, {
    productIds: [productId, ...componentProductIds],
    email: customerEmail,
    userId,
    orderId: paymentIntent.id,
    customFieldValues,
  });

  const isExplicitRepurchase = paymentIntent.metadata?.repurchase === 'true';

  // Trigger internal webhook for purchase.completed
  if (!result.already_had_access || isExplicitRepurchase) {
    // VAT tax snapshot — the stored session_id may be this PI's id (if this handler won
    // the race over checkout.session.completed), so also pass the PI id: capture resolves
    // the real Checkout Session from it and stays independent of Stripe event ordering.
    // (stripe was created above for the subtotal lookup; reuse it.)
    const taxSnapshot = await captureAndPersistOrderTax({
      stripe,
      supabase,
      transactionId: txCustomFields?.id,
      sessionId: txCustomFields?.session_id,
      paymentIntentId: paymentIntent.id,
    });

    const webhookData = await buildPurchaseWebhookPayload({
      supabaseClient: supabase,
      customerEmail,
      userId,
      productId,
      bumpProductIds,
      componentProductIds,
      metadata: paymentIntent.metadata as Record<string, string | undefined> | null,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      paymentIntentId: paymentIntent.id,
      taxSnapshot,
      couponId: couponId || null,
      isGuest: result.is_guest_purchase as boolean,
      source: 'stripe_webhook',
      customFieldValues: customFieldValues ?? null,
    });

    if (licenses.length) webhookData.licenses = licenses;

    // Server-side Purchase tracking via Facebook CAPI
    const baseUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
    const productSlug = 'slug' in webhookData.product ? webhookData.product.slug : null;
    revalidatePurchaseTags(productSlug);
    const productName = 'name' in webhookData.product ? webhookData.product.name : 'Unknown Product';
    trackServerSideConversion({
      eventName: 'Purchase',
      eventId: generatePurchaseEventId(paymentIntent.id),
      eventSourceUrl: productSlug ? `${baseUrl}/p/${productSlug}` : baseUrl,
      value: (paymentIntent.amount || 0) / 100,
      currency: (paymentIntent.currency || 'usd').toUpperCase(),
      items: [{
        item_id: productId,
        item_name: productName,
        price: (paymentIntent.amount || 0) / 100,
        quantity: 1,
      }],
      orderId: paymentIntent.id,
      userEmail: customerEmail,
    }).catch(err => console.error('[Stripe Webhook] FB CAPI Purchase tracking error:', err));

    WebhookService.trigger('purchase.completed', webhookData, supabase, [productId, ...componentProductIds, ...bumpProductIds])
      .catch(err => console.error('[Stripe Webhook] Internal webhook error:', err));
  }

  return { processed: true, message: `Payment processed: ${result.scenario}` };
}
