import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateCheckoutModules } from '@/lib/checkout-modules/validate';
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';
import { getStripeServer } from '@/lib/stripe/server';
import { checkRateLimit, checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/origin-match';
import { assertStripeObjectOwnership } from '@/lib/api/ownership';
import { verifyCheckoutBinding } from '@/lib/security/checkout-binding';
import { getCheckoutConfig } from '@/lib/stripe/checkout-config';
import { applyBuyerTaxIdentityToCustomer } from '@/lib/stripe/buyer-tax-identity';
import { shouldShowTosCheckbox } from '@/lib/checkout/tos-display';
import { shouldForwardTaxIdentityToStripe } from '@/lib/checkout/invoice-form-logic';
import {
  validateCustomFieldDefinitions,
  validateCustomFieldValues,
} from '@/lib/validations/custom-checkout-fields';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';
import { buildBuyerDetails } from '@/lib/payment/buyer-details';

/**
 * POST /api/update-payment-metadata
 *
 * Updates Payment Intent or Checkout Session metadata with invoice/company data
 * before the payment is confirmed.
 *
 * SECURITY:
 * - CORS protection: only same-origin requests allowed
 * - Rate limiting: 10 requests per minute per IP (higher than GUS because this is critical for payment flow)
 *
 * This is necessary because the payment object is created before
 * the user fills in invoice details.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. CORS Protection - Only allow same-origin requests
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');

    // Use SITE_URL (server-side runtime env) — NEXT_PUBLIC_SITE_URL is baked at build time
    const allowedOrigins = [
      getCanonicalOriginOrNull(),
    ].filter(Boolean);

    // Reject if no allowed origins configured — empty SITE_URL means origin check is meaningless
    if (allowedOrigins.length === 0) {
      console.error('[update-payment-metadata] SITE_URL not configured — rejecting request');
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const isValidOrigin = isAllowedOrigin(origin, allowedOrigins as string[]);
    const isValidReferer = isAllowedOrigin(referer, allowedOrigins as string[]);

    if (!isValidOrigin && !isValidReferer) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden - Invalid origin'
        },
        { status: 403 }
      );
    }

    const sourceOk = await checkRateLimit('update_payment_metadata', 5, 1);
    if (!sourceOk) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }

    // 3. Parse and validate request
    const {
      moduleValues,
      email,
      locale,
      clientSecret,
      bindingToken,
      productId,
      firstName,
      lastName,
      fullName, // New field - if provided, split into first/last name
      termsAccepted,
      needsInvoice,
      nip,
      companyName,
      address,
      city,
      postalCode,
      country,
      // Phase 3a: submit-time values for products.custom_checkout_fields.
      // Validated with requireAll=true so required fields must be filled
      // before checkout.confirm() is allowed to proceed.
      customFieldValues,
    } = await readJsonBody<any>(request);

    if (!clientSecret) {
      return NextResponse.json(
        { success: false, error: 'Client secret is required' },
        { status: 400 }
      );
    }

    if (typeof bindingToken !== 'string' || !bindingToken) {
      return NextResponse.json(
        { success: false, error: 'Missing binding token' },
        { status: 403 }
      );
    }

    if (typeof productId !== 'string' || !productId) {
      return NextResponse.json(
        { success: false, error: 'Missing productId' },
        { status: 400 }
      );
    }

    const stripeObjectId = clientSecret.split('_secret_')[0];
    const isPaymentIntent = /^pi_[a-zA-Z0-9]+$/.test(stripeObjectId);
    const isCheckoutSession = /^cs_(test|live)_[a-zA-Z0-9]+$/.test(stripeObjectId);

    if (!isPaymentIntent && !isCheckoutSession) {
      return NextResponse.json(
        { success: false, error: 'Invalid payment object format' },
        { status: 400 }
      );
    }

    const userClient = await createClient();
    const { data: { user: sessionUser } } = await userClient.auth.getUser();
    const sessionUserId = sessionUser?.id ?? null;

    // Verify HMAC binding. The token is computed at session-creation time
    // over (stripe_object_id, user_id, product_id) with a server secret;
    // a leaked clientSecret alone is no longer enough to mutate metadata.
    const bindingOk = verifyCheckoutBinding(bindingToken, {
      stripeObjectId,
      userId: sessionUserId,
      productId,
    });
    if (!bindingOk) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 },
      );
    }

    const checkoutConfig = await getCheckoutConfig();
    if (shouldShowTosCheckbox(checkoutConfig.collect_terms_of_service, !sessionUser) && termsAccepted !== true) {
      return NextResponse.json({ success: false, error: 'Terms acceptance required' }, { status: 400 });
    }
    const stripe = await getStripeServer();
    const buyer = buildBuyerDetails(
      { firstName, lastName, fullName, termsAccepted, needsInvoice, nip, companyName, address, city, postalCode, country },
      'checkout',
    );
    const metadata = {
      first_name: buyer.first_name,
      last_name: buyer.last_name,
      full_name: buyer.full_name,
      terms_accepted: buyer.terms_accepted ? 'true' : '',
      needs_invoice: buyer.needs_invoice ? 'true' : 'false',
      nip: buyer.nip,
      company_name: buyer.company_name,
      address: buyer.address,
      city: buyer.city,
      postal_code: buyer.postal_code,
      country: buyer.country,
    };

    let stripeMetadata: Record<string, string> = {};
    let productIdFromStripe: string | null = null;
    let isSubscription = false;
    let stripeTaxCustomerId: string | null = null;

    const tooManyRequests = () =>
      NextResponse.json(
        { success: false, error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': '60' } },
      );

    const enforcePerOwnerLimit = async (
      ownerId: string | null,
    ): Promise<Response | null> => {
      if (!ownerId) return null;
      const ok = await checkRateLimitForIdentifier(
        'update_payment_metadata_user',
        10,
        5,
        `user:${ownerId}`,
      );
      return ok ? null : tooManyRequests();
    };

    if (isCheckoutSession) {
      const session = await stripe.checkout.sessions.retrieve(stripeObjectId);
      if (!session || session.status !== 'open') {
        return NextResponse.json(
          { success: false, error: 'Checkout session is not in a modifiable state' },
          { status: 400 }
        );
      }
      const ownership = assertStripeObjectOwnership(session.metadata ?? null, sessionUserId);
      if (ownership) return ownership;

      isSubscription = session.mode === 'subscription';
      productIdFromStripe = (session.metadata?.product_id as string) || null;
      const sessionOwnerId = (session.metadata?.user_id as string | undefined) || null;
      const limited = await enforcePerOwnerLimit(sessionOwnerId);
      if (limited) return limited;

      stripeMetadata = session.metadata ?? {};
      stripeTaxCustomerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
    } else {
      const pi = await stripe.paymentIntents.retrieve(stripeObjectId);
      if (!pi || !['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(pi.status)) {
        return NextResponse.json(
          { success: false, error: 'Payment intent is not in a modifiable state' },
          { status: 400 }
        );
      }
      const ownership = assertStripeObjectOwnership(pi.metadata ?? null, sessionUserId);
      if (ownership) return ownership;

      isSubscription = pi.metadata?.product_type === 'subscription' && !!pi.metadata.subscription_id;
      productIdFromStripe = (pi.metadata?.product_id as string) || null;
      const piOwnerId = (pi.metadata?.user_id as string | undefined) || null;
      const limited = await enforcePerOwnerLimit(piOwnerId);
      if (limited) return limited;

      stripeMetadata = pi.metadata ?? {};
      stripeTaxCustomerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id ?? null;
    }

    if (productIdFromStripe !== productId) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    let profileProduct: { checkout_profile: unknown; currency: string } | null = null;
    if (!isSubscription) {
      const { data, error } = await createAdminClient().from('products')
        .select('checkout_profile, currency').eq('id', productId).single();
      if (error || !data) return NextResponse.json({ success: false, error: 'Product not found' }, { status: 404 });
      profileProduct = data;
    }
    if (!isSubscription && stripeMetadata.coupon_id) {
      const buyerEmail = z.email().max(254).safeParse(
        typeof (sessionUser?.email ?? email ?? stripeMetadata.email) === 'string'
          ? (sessionUser?.email ?? email ?? stripeMetadata.email).trim().toLowerCase() : '',
      );
      if (!buyerEmail.success) return NextResponse.json({ success: false, error: 'Valid email is required' }, { status: 400 });
      const { data: reservation, error } = await createAdminClient().rpc('verify_coupon', {
        code_param: stripeMetadata.coupon_code,
        product_id_param: productId,
        customer_email_param: buyerEmail.data,
        currency_param: profileProduct!.currency,
      });
      if (error || !reservation || typeof reservation !== 'object' || Array.isArray(reservation)
        || reservation.valid !== true || reservation.id !== stripeMetadata.coupon_id) {
        return NextResponse.json({ success: false, error: 'Discount code is no longer available' }, { status: 409 });
      }
    }
    let persistCustomFields: () => Promise<Response | null> = async () => null;
    // Phase 3a: validate + persist custom_field_values on the pending row.
    // Definitions come from DB (not the client) so the buyer cannot spoof
    // their own field shape; values from the request body are validated
    // against those definitions with requireAll=true (submit-time gate).
    if (customFieldValues !== undefined || profileProduct?.checkout_profile != null) {
      if (!productIdFromStripe) {
        return NextResponse.json(
          { success: false, error: 'Cannot persist custom field values: payment has no product binding' },
          { status: 400 },
        );
      }

      const admin = createAdminClient();
      const { data: product, error: productError } = await admin
        .from('products')
        .select('custom_checkout_fields')
        .eq('id', productIdFromStripe)
        .single();
      if (productError || !product) {
        return NextResponse.json(
          { success: false, error: 'Product not found' },
          { status: 404 },
        );
      }

      const defs = validateCustomFieldDefinitions(product.custom_checkout_fields ?? []);
      if (!defs.ok) {
        console.error(
          '[update-payment-metadata] product %s has invalid custom_checkout_fields shape:',
          productIdFromStripe,
          defs.errors,
        );
        return NextResponse.json(
          { success: false, error: 'Product checkout configuration is invalid' },
          { status: 500 },
        );
      }

      const valuesResult = validateCustomFieldValues(defs.value, customFieldValues ?? {}, {
        requireAll: true,
      });
      if (!valuesResult.ok) {
        return NextResponse.json(
          { success: false, error: 'Invalid custom field values', details: valuesResult.errors },
          { status: 400 },
        );
      }

      persistCustomFields = async () => {
        const sessionId = isCheckoutSession ? stripeObjectId : null;
        const piId = isCheckoutSession ? null : stripeObjectId;
        const matcher = sessionId
          ? { session_id: sessionId }
          : { stripe_payment_intent_id: piId as string };
        const { error: updateError } = await admin
          .from('payment_transactions')
          .update({ custom_field_values: valuesResult.values })
          .match(matcher);
        if (updateError) {
          console.error('[update-payment-metadata] failed to persist custom_field_values:', updateError);
          return NextResponse.json(
            { success: false, error: 'Failed to save custom field values' },
            { status: 500 },
          );
        }
        return null;
      };
    }

    if (!isSubscription) {
      const admin = createAdminClient();
      const product = profileProduct!;
      if (product.checkout_profile != null) {
        const result = validateCheckoutModules(product.checkout_profile, moduleValues, {
          locale, currency: product.currency, termsAccepted,
        });
        if (!result.success) return NextResponse.json({ success: false, errors: result.errors }, { status: result.status });
        const rawQuantity = result.quantity;
        const customError = await persistCustomFields();
        if (customError) return customError;
        const { data: saved, error: saveError } = await admin.rpc('set_payment_order_details', {
          p_details: result.details,
          p_product_id: productId,
          p_quantity: rawQuantity,
          ...(isCheckoutSession ? { p_session_id: stripeObjectId } : { p_payment_intent_id: stripeObjectId }),
        });
        if (saveError && ['22023', '23514'].includes(saveError.code)) {
          return NextResponse.json({
            success: false, errors: [{ field: 'moduleValues', code: 'details_too_large' }],
          }, { status: 422 });
        }
        if (saveError) return NextResponse.json({ success: false, error: 'Failed to save order details' }, { status: 500 });
        if (saved !== 1) return NextResponse.json({ success: false, code: 'quantity_snapshot_mismatch' }, { status: 409 });
        const personalFields = new Set([
          'first_name', 'last_name', 'full_name', 'email', 'nip', 'tax_id', 'company_name',
          'address', 'city', 'postal_code', 'country', 'phone', 'buyer', 'recipient',
          'participants', 'participant_emails',
        ]);
        const profileMetadata = Object.fromEntries(
          Object.entries(stripeMetadata).map(([key, value]) => [key, personalFields.has(key) ? '' : value]),
        );
        if (isCheckoutSession) await stripe.checkout.sessions.update(stripeObjectId, { metadata: profileMetadata });
        else await stripe.paymentIntents.update(stripeObjectId, { metadata: profileMetadata });
        const party = result.details.buyer;
        if (stripeTaxCustomerId && party && typeof party === 'object' && !Array.isArray(party)) {
          if (shouldForwardTaxIdentityToStripe(checkoutConfig.tax_mode)) {
            const text = (key: string) => typeof party[key] === 'string' ? party[key] : undefined;
            await applyBuyerTaxIdentityToCustomer({
              stripe, customerId: stripeTaxCustomerId,
              identity: {
                country: text('country'), taxId: text('nip'), address: text('address'),
                city: text('city'), postalCode: text('postal_code'),
              },
            });
          }
        }
        return NextResponse.json({ success: true });
      }
    }
    const customError = await persistCustomFields();
    if (customError) return customError;
    if (isCheckoutSession) await stripe.checkout.sessions.update(stripeObjectId, { metadata });
    else await stripe.paymentIntents.update(stripeObjectId, { metadata });

    // stripe_tax: set the buyer's country + EU VAT-ID on the Stripe Customer so automatic_tax
    // computes the right jurisdiction and applies EU B2B reverse charge. This runs HERE — not at
    // session creation — because this is where the buyer's NIP/country actually arrive (on submit).
    // The Customer was attached at create-payment-intent (a session's customer can't be set later).
    // Gated on stripe_tax; fail-safe (never blocks the metadata update or the payment).
    if (stripeTaxCustomerId) {
      if (shouldForwardTaxIdentityToStripe(checkoutConfig.tax_mode)) {
        await applyBuyerTaxIdentityToCustomer({
          stripe,
          customerId: stripeTaxCustomerId,
          identity: { country, taxId: nip, address, city, postalCode },
        });
      }
    }

    // The buyer details must be stored with the order before the payment can be confirmed;
    // the checkout form stops on any failure here.
    const detailsNotSaved = (status: number) =>
      NextResponse.json(
        { success: false, error: 'Failed to save buyer details', code: 'details_not_saved' },
        { status },
      );
    try {
      const { data: savedRows, error: saveError } = await createAdminClient().rpc('set_payment_order_buyer', {
        p_buyer: buyer,
        ...(isCheckoutSession ? { p_session_id: stripeObjectId } : { p_payment_intent_id: stripeObjectId }),
        p_only_if_missing: false,
      });
      if (saveError) {
        console.error('[update-payment-metadata] failed to persist buyer details:', saveError);
        return detailsNotSaved(500);
      }
      if (!savedRows && !isSubscription) {
        console.error('[update-payment-metadata] no pending payment row for', stripeObjectId);
        return detailsNotSaved(409);
      }
    } catch (saveError) {
      console.error('[update-payment-metadata] failed to persist buyer details:', saveError instanceof Error ? saveError.message : 'Unknown error');
      return detailsNotSaved(500);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof ApiPayloadTooLargeError) {
      return NextResponse.json({ success: false, error: 'Request body too large' }, { status: 413 });
    }
    console.error('Error updating payment metadata:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update payment metadata',
      },
      { status: 500 }
    );
  }
}
