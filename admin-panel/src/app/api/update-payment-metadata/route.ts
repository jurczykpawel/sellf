import { NextRequest, NextResponse } from 'next/server';
import { getStripeServer } from '@/lib/stripe/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  validateCustomFieldDefinitions,
  validateCustomFieldValues,
} from '@/lib/validations/custom-checkout-fields';

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
      process.env.SITE_URL,
    ].filter(Boolean);

    // Reject if no allowed origins configured — empty SITE_URL means origin check is meaningless
    if (allowedOrigins.length === 0) {
      console.error('[update-payment-metadata] SITE_URL not configured — rejecting request');
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const isValidOrigin = origin && allowedOrigins.some(allowed =>
      origin === allowed || (allowed ? origin.startsWith(allowed) : false)
    );

    const isValidReferer = referer && allowedOrigins.some(allowed =>
      allowed ? referer.startsWith(allowed) : false
    );

    if (!isValidOrigin && !isValidReferer) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden - Invalid origin'
        },
        { status: 403 }
      );
    }

    // 2. Rate Limiting - Database-backed for production reliability
    const rateLimitOk = await checkRateLimit('update_payment_metadata', 10, 1); // 10 requests per 1 minute

    if (!rateLimitOk) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many requests. Please try again later.'
        },
        {
          status: 429,
          headers: {
            'Retry-After': '60', // 1 minute
          }
        }
      );
    }

    // 3. Parse and validate request
    const {
      clientSecret,
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
    } = await request.json();

    if (!clientSecret) {
      return NextResponse.json(
        { success: false, error: 'Client secret is required' },
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

    // Handle fullName - split into firstName and lastName
    let finalFirstName = firstName || '';
    let finalLastName = lastName || '';

    if (fullName && !firstName && !lastName) {
      // Split fullName into first and last name
      const nameParts = fullName.trim().split(/\s+/);
      if (nameParts.length === 1) {
        finalFirstName = nameParts[0];
      } else {
        finalFirstName = nameParts[0];
        finalLastName = nameParts.slice(1).join(' ');
      }
    }

    const stripe = await getStripeServer();
    const metadata = {
      first_name: finalFirstName,
      last_name: finalLastName,
      full_name: fullName || `${finalFirstName} ${finalLastName}`.trim(), // Store full name too for reference
      terms_accepted: termsAccepted ? 'true' : '',
      needs_invoice: needsInvoice ? 'true' : 'false',
      nip: nip || '',
      company_name: companyName || '',
      address: address || '',
      city: city || '',
      postal_code: postalCode || '',
      country: country || '',
    };

    let productIdFromStripe: string | null = null;

    if (isCheckoutSession) {
      const session = await stripe.checkout.sessions.retrieve(stripeObjectId);
      if (!session || session.status !== 'open') {
        return NextResponse.json(
          { success: false, error: 'Checkout session is not in a modifiable state' },
          { status: 400 }
        );
      }
      productIdFromStripe = (session.metadata?.product_id as string) || null;
      await stripe.checkout.sessions.update(stripeObjectId, { metadata });
    } else {
      // Verify the PaymentIntent exists and is still in a modifiable state
      // This prevents metadata updates on already-completed or cancelled payments
      const pi = await stripe.paymentIntents.retrieve(stripeObjectId);
      if (!pi || !['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(pi.status)) {
        return NextResponse.json(
          { success: false, error: 'Payment intent is not in a modifiable state' },
          { status: 400 }
        );
      }
      productIdFromStripe = (pi.metadata?.product_id as string) || null;
      await stripe.paymentIntents.update(stripeObjectId, { metadata });
    }

    // Phase 3a: validate + persist custom_field_values on the pending row.
    // Definitions come from DB (not the client) so the buyer cannot spoof
    // their own field shape; values from the request body are validated
    // against those definitions with requireAll=true (submit-time gate).
    if (customFieldValues !== undefined) {
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

      const valuesResult = validateCustomFieldValues(defs.value, customFieldValues, {
        requireAll: true,
      });
      if (!valuesResult.ok) {
        return NextResponse.json(
          { success: false, error: 'Invalid custom field values', details: valuesResult.errors },
          { status: 400 },
        );
      }

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
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
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
