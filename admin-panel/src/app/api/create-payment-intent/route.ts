import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';
import { calculatePricing, toStripeCents, STRIPE_MINIMUM_AMOUNT } from '@/hooks/usePricing';
import { getStripeServer } from '@/lib/stripe/server';
import { getEnabledPaymentMethodsForCurrency } from '@/lib/utils/payment-method-helpers';
import { isSafeRedirectUrl } from '@/lib/validations/redirect';
import { normalizeBumpIds, validateUUID } from '@/lib/validations/product';
import { ProductValidationService } from '@/lib/services/product-validation';
import type { PaymentMethodConfig } from '@/types/payment-config';

/**
 * Apply automatic payment methods configuration to PaymentIntent params.
 * Used as fallback when no custom config is set or config is invalid.
 *
 * IMPORTANT: Cleans up mutually exclusive fields to prevent Stripe errors.
 * Stripe rejects requests that combine automatic_payment_methods with
 * payment_method_types or payment_method_configuration.
 */
function applyAutomaticPaymentMethods(params: Stripe.PaymentIntentCreateParams): void {
  params.automatic_payment_methods = {
    enabled: true,
    allow_redirects: 'always',
  };
  delete params.payment_method_types;
  delete params.payment_method_configuration;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Rate limiting: 60 requests per 5 minutes (allows PWYW price changes + form retries)
    const rateLimitOk = await checkRateLimit('create_payment_intent', 60, 5, user?.id);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many payment attempts. Please try again later.' },
        { status: 429 }
      );
    }

    // Reject non-JSON Content-Type to prevent blind CSRF via text/plain simple requests
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 415 }
      );
    }

    const body = await request.json();
    const {
      productId,
      email,
      firstName,
      lastName,
      termsAccepted,
      bumpProductId,     // Legacy: single bump ID
      bumpProductIds,    // New: array of bump IDs
      couponCode,
      needsInvoice,
      nip,
      companyName,
      address,
      city,
      postalCode,
      country,
      successUrl,
      customAmount  // Pay What You Want
    } = body;

    // Normalize + validate bump IDs (supports legacy single bumpProductId)
    const { validIds: requestedBumpIds, invalidIds } = normalizeBumpIds({ bumpProductId, bumpProductIds });

    if (!productId) {
      return NextResponse.json(
        { error: 'Product ID is required' },
        { status: 400 }
      );
    }

    // Validate productId is a valid UUID
    if (!validateUUID(productId).isValid) {
      return NextResponse.json(
        { error: 'Invalid product ID format' },
        { status: 400 }
      );
    }

    // Validate successUrl to prevent open redirects
    if (successUrl && !isSafeRedirectUrl(successUrl)) {
      return NextResponse.json(
        { error: 'Invalid success URL' },
        { status: 400 }
      );
    }

    // Reject request if any bump IDs have invalid UUID format
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: 'Invalid bump product ID format' },
        { status: 400 }
      );
    }

    // SECURITY: Cap bump IDs count at application level to prevent DoS via hundreds of
    // validation queries. DB function also limits to 20, but this avoids the round-trips.
    const MAX_BUMP_IDS = 20;
    if (requestedBumpIds.length > MAX_BUMP_IDS) {
      return NextResponse.json(
        { error: `Too many bump products (maximum ${MAX_BUMP_IDS})` },
        { status: 400 }
      );
    }

    // Use email from request if provided, otherwise from user session
    // For guests without email, we'll let Stripe collect it via billing details
    const finalEmail = email || user?.email || null;

    // Validate email format + disposable domain check (consistent with checkout.ts)
    if (finalEmail) {
      const isValidEmail = await ProductValidationService.validateEmail(finalEmail);
      if (!isValidEmail) {
        return NextResponse.json(
          { error: 'Invalid or disposable email address not allowed' },
          { status: 400 }
        );
      }
    }

    // 1. Fetch product
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .eq('is_active', true)
      .single();

    if (productError || !product) {
      return NextResponse.json(
        { error: 'Product not found or inactive' },
        { status: 404 }
      );
    }

    // 2. Check if user already has access
    if (user) {
      const { data: existingAccess } = await supabase
        .from('user_product_access')
        .select('id')
        .eq('user_id', user.id)
        .eq('product_id', productId)
        .single();

      if (existingAccess) {
        return NextResponse.json(
          { error: 'You already have access to this product' },
          { status: 400 }
        );
      }
    }

    // 3. Validate PWYW (Pay What You Want) custom pricing
    const STRIPE_MAX_AMOUNT = 999999.99; // Stripe's maximum amount limit
    if (customAmount !== undefined) {
      // SECURITY: Reject non-numeric, NaN, or Infinity values (consistent with checkout.ts)
      if (typeof customAmount !== 'number' || !Number.isFinite(customAmount)) {
        return NextResponse.json(
          { error: 'Custom amount must be a valid number' },
          { status: 400 }
        );
      }

      // SECURITY: Explicitly reject zero or negative amounts
      if (customAmount <= 0) {
        return NextResponse.json(
          { error: 'Custom amount must be greater than zero' },
          { status: 400 }
        );
      }

      // Security: Reject customAmount if product doesn't allow custom pricing
      if (!product.allow_custom_price) {
        return NextResponse.json(
          { error: 'This product does not allow custom pricing' },
          { status: 400 }
        );
      }

      // Validate minimum price
      const minPrice = product.custom_price_min ?? STRIPE_MINIMUM_AMOUNT;
      if (customAmount < minPrice) {
        return NextResponse.json(
          { error: `Amount must be at least ${minPrice} ${product.currency}` },
          { status: 400 }
        );
      }

      // Validate maximum price (Stripe limit)
      if (customAmount > STRIPE_MAX_AMOUNT) {
        return NextResponse.json(
          { error: `Amount must be no more than ${STRIPE_MAX_AMOUNT} ${product.currency}` },
          { status: 400 }
        );
      }
    }

    // 4. Fetch and validate bump products (supports multiple)
    // SECURITY: Must validate that each bumpProductId is a valid order bump for this product
    type ProductRow = typeof product;
    interface ValidatedBump { product: ProductRow; bumpPrice: number }
    const validatedBumps: ValidatedBump[] = [];
    let totalBumpPrice = 0;

    if (requestedBumpIds.length > 0) {
      // Use the same RPC function that frontend uses to get valid bumps
      const { data: validBumps } = await supabase.rpc('get_product_order_bumps', {
        product_id_param: productId,
      });

      for (const reqBumpId of requestedBumpIds) {
        const validBump = validBumps?.find((b: { bump_product_id: string; bump_currency: string; bump_price: number }) => b.bump_product_id === reqBumpId);

        if (validBump && validBump.bump_currency === product.currency) {
          const { data: bump } = await supabase
            .from('products')
            .select('*')
            .eq('id', reqBumpId)
            .single();

          if (bump) {
            // SECURITY: Use the bump_price from order_bumps, not the product's regular price
            const price = validBump.bump_price;
            validatedBumps.push({ product: bump, bumpPrice: price });
            totalBumpPrice += price;
          }
        }
        // Invalid bump IDs are silently ignored
      }
    }

    // Backward compat: expose first bump as bumpProduct for downstream code
    const bumpProduct = validatedBumps.length > 0 ? validatedBumps[0].product : null;
    const bumpPrice = validatedBumps.length > 0 ? validatedBumps[0].bumpPrice : 0;

    // 5. Fetch and validate coupon using secure DB function
    // SECURITY: Must use verify_coupon RPC which checks all constraints:
    // - usage_limit_global, usage_limit_per_user
    // - expires_at, starts_at
    // - allowed_emails, allowed_product_ids
    // - Race condition prevention with reservations
    let appliedCoupon = null;
    if (couponCode) {
      const { data: couponResult, error: couponError } = await supabase.rpc('verify_coupon', {
        code_param: couponCode.toUpperCase(),
        product_id_param: productId,
        customer_email_param: finalEmail || null,
        currency_param: product.currency,
      });

      if (couponError) {
        console.error('Coupon verification error:', couponError);
        return NextResponse.json(
          { error: 'Failed to verify coupon. Please try again.' },
          { status: 500 }
        );
      } else if (couponResult?.valid) {
        appliedCoupon = {
          id: couponResult.id,
          code: couponResult.code,
          discount_type: couponResult.discount_type,
          discount_value: couponResult.discount_value,
          exclude_order_bumps: couponResult.exclude_order_bumps,
        };
      } else {
        // SECURITY: Don't silently ignore invalid coupon - user expects discount!
        // This prevents charging full price when user thought they had a discount
        return NextResponse.json(
          { error: couponResult?.error || 'Coupon code is no longer valid. Please remove it and try again.' },
          { status: 400 }
        );
      }
    }

    // 6. Calculate pricing using centralized function (multi-bump aware)
    const pricing = calculatePricing({
      productPrice: product.price,
      productCurrency: product.currency,
      customAmount,
      bumps: validatedBumps.map(vb => ({ price: vb.bumpPrice, selected: true })),
      coupon: appliedCoupon ? {
        discount_type: appliedCoupon.discount_type,
        discount_value: appliedCoupon.discount_value,
        code: appliedCoupon.code,
        exclude_order_bumps: appliedCoupon.exclude_order_bumps,
      } : null,
    });

    const totalAmount = toStripeCents(pricing.totalGross);

    // 7. Create PaymentIntent
    const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
      amount: totalAmount,
      currency: product.currency.toLowerCase(),
      // NOTE: automatic_payment_methods is set by the config switch below.
      // Do NOT set it here - it's mutually exclusive with payment_method_types
      // and payment_method_configuration.
      metadata: {
        product_id: productId,
        product_name: product.name,
        user_id: user?.id || '',
        email: finalEmail || '',
        first_name: firstName || '',
        last_name: lastName || '',
        terms_accepted: termsAccepted ? 'true' : '',
        // Multi-bump: comma-separated IDs for all validated bumps
        bump_product_ids: validatedBumps.map(vb => vb.product.id).join(','),
        bump_product_id: bumpProduct?.id || '',  // Legacy: first bump for backward compat
        bump_product_name: bumpProduct?.name || '',
        has_bump: validatedBumps.length > 0 ? 'true' : '',
        bump_count: validatedBumps.length.toString(),
        coupon_code: appliedCoupon?.code || '',
        coupon_id: appliedCoupon?.id || '',
        coupon_discount: appliedCoupon ? `${appliedCoupon.discount_value}${appliedCoupon.discount_type === 'percentage' ? '%' : product.currency}` : '',
        needs_invoice: needsInvoice ? 'true' : 'false',
        nip: nip || '',
        company_name: companyName || '',
        address: address || '',
        city: city || '',
        postal_code: postalCode || '',
        country: country || '',
        success_url: successUrl || '',
        custom_amount: pricing.isPwyw ? pricing.basePrice.toString() : '',
        is_pwyw: pricing.isPwyw ? 'true' : 'false',
      },
    };

    // Fetch payment method configuration using admin client (service_role)
    // because RLS only allows admin users to SELECT from payment_method_config,
    // but checkout users can be anonymous or non-admin authenticated users.
    const adminSupabase = createAdminClient();
    const { data: paymentConfig } = await adminSupabase
      .from('payment_method_config')
      .select('*')
      .eq('id', 1)
      .single() as { data: PaymentMethodConfig | null };

    // Apply payment method configuration based on mode
    // SECURITY: Payment method configuration is applied server-side only.
    // Client cannot override which payment methods are available.
    // FALLBACK STRATEGY: If config is missing/invalid, we fallback to Stripe's
    // automatic_payment_methods to ensure checkout always works. This is logged
    // for monitoring but doesn't expose any sensitive information.
    if (paymentConfig) {
      switch (paymentConfig.config_mode) {
        case 'automatic':
          // Use Stripe's automatic payment methods (default behavior)
          applyAutomaticPaymentMethods(paymentIntentParams);
          // Enable Link saved payment methods for one-click checkout
          paymentIntentParams.payment_method_options = {
            link: { setup_future_usage: 'off_session' },
          };
          break;

        case 'stripe_preset':
          // Use specific Stripe Payment Method Configuration
          if (paymentConfig.stripe_pmc_id) {
            paymentIntentParams.payment_method_configuration = paymentConfig.stripe_pmc_id;
            delete paymentIntentParams.automatic_payment_methods;
            delete paymentIntentParams.payment_method_types;
            // Enable Link saved payment methods for one-click checkout
            paymentIntentParams.payment_method_options = {
              link: { setup_future_usage: 'off_session' },
            };
          } else {
            // Fallback to automatic if PMC ID is missing
            console.warn('[create-payment-intent] stripe_preset mode but no PMC ID, falling back to automatic');
            applyAutomaticPaymentMethods(paymentIntentParams);
          }
          break;

        case 'custom':
          // Use explicit payment method types with currency filtering
          const enabledMethods = getEnabledPaymentMethodsForCurrency(
            paymentConfig,
            product.currency
          );

          // Add express checkout types to payment_method_types.
          // Placed before the length check so express-checkout-only configs work
          // (e.g. only Link enabled, no custom payment methods selected).
          //
          // Link: needed for LinkAuthenticationElement inline autofill
          if (paymentConfig.enable_link && !enabledMethods.includes('link')) {
            enabledMethods.push('link');
          }
          // Apple Pay & Google Pay are card wallets — they require 'card' in
          // payment_method_types to appear in ExpressCheckoutElement.
          if (paymentConfig.enable_express_checkout &&
              (paymentConfig.enable_apple_pay || paymentConfig.enable_google_pay) &&
              !enabledMethods.includes('card')) {
            enabledMethods.push('card');
          }

          if (enabledMethods.length > 0) {
            paymentIntentParams.payment_method_types = enabledMethods;
            delete paymentIntentParams.automatic_payment_methods;
            delete paymentIntentParams.payment_method_configuration;
            // Enable Link saved payment methods (same as automatic/stripe_preset modes)
            if (paymentConfig.enable_link) {
              paymentIntentParams.payment_method_options = {
                ...paymentIntentParams.payment_method_options,
                link: { setup_future_usage: 'off_session' },
              };
            }
          } else {
            // Fallback if no methods match currency and no express checkout
            console.warn('[create-payment-intent] No payment methods match currency, falling back to automatic');
            applyAutomaticPaymentMethods(paymentIntentParams);
          }
          break;
      }
    } else {
      // Fallback if config is missing (shouldn't happen due to migration seed)
      // This ensures checkout always works even if config table is empty/corrupted
      console.warn('[create-payment-intent] Payment config not found, using automatic mode');
      applyAutomaticPaymentMethods(paymentIntentParams);
    }

    // Only set receipt_email if we have an email
    if (finalEmail) {
      paymentIntentParams.receipt_email = finalEmail;
    }

    const stripe = await getStripeServer();
    if (!stripe) {
      return NextResponse.json(
        { error: 'Payment system not configured. Please configure Stripe in admin settings.' },
        { status: 503 }
      );
    }
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    // Save pending payment transaction for abandoned cart recovery
    // Uses admin client because payment_transactions INSERT requires service_role
    try {
      const { error: insertError } = await adminSupabase
        .from('payment_transactions')
        .insert({
          session_id: paymentIntent.id, // Use Payment Intent ID as session_id
          user_id: user?.id || null,
          product_id: productId,
          customer_email: finalEmail || 'pending@sellf.app', // Fallback for guests without email
          amount: totalAmount,
          currency: product.currency,
          stripe_payment_intent_id: paymentIntent.id,
          status: 'pending',
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
          metadata: paymentIntentParams.metadata
        });

      if (insertError) {
        // Log error but don't fail the payment intent creation
        console.error('Failed to save pending transaction:', insertError);
      }
    } catch (dbError) {
      // Don't fail payment intent creation if DB insert fails
      console.error('Error saving pending transaction:', dbError);
    }

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}
