import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';
import { calculatePricing, toStripeCents } from '@/hooks/usePricing';
import { getEffectiveUnitPrice } from '@/lib/services/omnibus';
import { validateCustomAmount } from '@/lib/payment/custom-amount';
import { getStripeServer } from '@/lib/stripe/server';
import { getEnabledPaymentMethodsForCurrency } from '@/lib/utils/payment-method-helpers';
import { isSafeRedirectUrl } from '@/lib/validations/redirect';
import { normalizeBumpIds, validateUUID } from '@/lib/validations/product';
import {
  validateCustomFieldDefinitions,
  validateCustomFieldValues,
} from '@/lib/validations/custom-checkout-fields';
import {
  ProductValidationService,
  type BillingInterval,
  type ValidatedProduct,
} from '@/lib/services/product-validation';
import type { PaymentMethodConfig } from '@/types/payment-config';
import { getCheckoutConfig } from '@/lib/stripe/checkout-config';
import { getOrCreateStripeCustomer } from '@/lib/stripe/customer';
import { applyBuyerTaxIdentityToCustomer } from '@/lib/stripe/buyer-tax-identity';
import { getOrCreateStripeTaxRate, resolveLocalSubscriptionTaxRateId } from '@/lib/stripe/tax-rate-manager';
import { buildCheckoutLineSpecs, buildStripeLineItems } from '@/lib/services/checkout-line-items';
import { getOrCreateStripePriceForProduct } from '@/lib/stripe/product-price';
import { buildSubscriptionSessionConfig } from '@/lib/stripe/subscription-checkout';
import { createSubscriptionWithDynamicPrice } from '@/lib/stripe/subscription-dynamic-price';
import { ensureStripeProduct } from '@/lib/stripe/ensure-product';
import { getCanonicalOrigin } from '@/lib/utils/canonical-url';
import { signCheckoutBinding, verifyCheckoutBinding } from '@/lib/security/checkout-binding';
import { canRenewExpiredLicenseWithActiveAccess } from '@/lib/license-keys/renewal';
import { findIssuedLicense } from '@/lib/license-keys/lookup';

function extractStripeObjectId(clientSecret: string): string | null {
  return clientSecret.split('_secret_')[0] || null;
}

type CheckoutSessionCreateParams = NonNullable<Parameters<Stripe['checkout']['sessions']['create']>[0]>;
type CheckoutPaymentMethodType = NonNullable<CheckoutSessionCreateParams['payment_method_types']>[number];

function extractCheckoutSessionId(clientSecret: string): string | null {
  const sessionId = clientSecret.split('_secret_')[0];
  return /^cs_(test|live)_[a-zA-Z0-9]+$/.test(sessionId) ? sessionId : null;
}

function stripeMetadataValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
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
      clientSecret,
      bindingToken: previousBindingToken,
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
      customAmount,  // Pay What You Want
      customFieldValues, // Phase 3a: buyer-typed values for product.custom_checkout_fields
      repurchase: rawRepurchase,
    } = body;
    const explicitRepurchase = rawRepurchase === true;

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

    const dataClient = createAdminClient();

    // 1. Fetch product
    const { data: product, error: productError } = await dataClient
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

    // 1a. Validate custom checkout fields against the product's definitions.
    // Defense in depth: client also validates, but server is the source of truth.
    const productCustomFieldDefs = validateCustomFieldDefinitions(
      product.custom_checkout_fields ?? [],
    );
    if (!productCustomFieldDefs.ok) {
      console.error(
        '[create-payment-intent] product %s has invalid custom_checkout_fields shape:',
        productId,
        productCustomFieldDefs.errors,
      );
      return NextResponse.json(
        { error: 'Product checkout configuration is invalid' },
        { status: 500 },
      );
    }
    // Mount-time POST: buyer may not have filled required fields yet — relax
    // the "required" check so the pending payment_transactions row can be
    // created. Final required check happens at /api/update-payment-metadata
    // (submit-time) before checkout.confirm().
    const customFieldValuesResult = validateCustomFieldValues(
      productCustomFieldDefs.value,
      customFieldValues ?? {},
      { requireAll: false },
    );
    if (!customFieldValuesResult.ok) {
      return NextResponse.json(
        { error: 'Invalid custom field values', details: customFieldValuesResult.errors },
        { status: 400 },
      );
    }
    const validatedCustomFieldValues = customFieldValuesResult.values;

    let canRenewLicense = false;
    let canRepurchaseTipJar = false;

    // 2. Check if user already has non-expired access.
    // Expired access is allowed to re-purchase — check access_expires_at.
    if (user) {
      const { data: existingAccess } = await dataClient
        .from('user_product_access')
        .select('access_expires_at')
        .eq('user_id', user.id)
        .eq('product_id', productId)
        .maybeSingle();

      if (existingAccess) {
        const expiresAt = existingAccess.access_expires_at
          ? new Date(existingAccess.access_expires_at)
          : null;
        const isExpired = expiresAt !== null && expiresAt < new Date();
        if (!isExpired) {
          const latestLicense = await findIssuedLicense(dataClient, productId, user, 'expires_at');
          canRenewLicense = canRenewExpiredLicenseWithActiveAccess({
            renewLicense: explicitRepurchase,
            productIssuesLicense: product.issue_license_on_purchase === true && product.product_type !== 'subscription',
            licenseExpiresAt: latestLicense?.expires_at,
          });
          canRepurchaseTipJar = explicitRepurchase && product.checkout_template === 'tip-jar';

          if (!canRenewLicense && !canRepurchaseTipJar) {
            return NextResponse.json(
              { error: 'You already have access to this product' },
              { status: 400 }
            );
          }
        }
      }
    }

    if (product.product_type === 'subscription') {
      const subscriptionProduct: ValidatedProduct = {
        id: product.id,
        slug: product.slug,
        name: product.name,
        description: product.description,
        price: product.price,
        currency: product.currency,
        is_active: product.is_active,
        available_from: product.available_from,
        available_until: product.available_until,
        auto_grant_duration_days: product.auto_grant_duration_days,
        allow_custom_price: product.allow_custom_price,
        custom_price_min: product.custom_price_min ?? undefined,
        vat_rate: product.vat_rate,
        price_includes_vat: product.price_includes_vat,
        vat_exempt: product.vat_exempt,
        vat_exempt_note: product.vat_exempt_note,
        product_type: 'subscription',
        billing_interval: product.billing_interval as BillingInterval | null,
        billing_interval_count: product.billing_interval_count,
        recurring_price: product.recurring_price,
        trial_days: product.trial_days,
        stripe_price_id: product.stripe_price_id,
      };

      // PWYW subscriptions (subscription product + allow_custom_price=true)
      // skip the fixed Checkout Session path and use stripe.subscriptions.create
      // with dynamic price_data, so the buyer can pick their monthly amount
      // and we don't accumulate one Stripe Price per donation level. Coupons
      // + bumps + custom amount remain incompatible with the fixed flow.
      const isPwywSubscription =
        subscriptionProduct.allow_custom_price === true && customAmount !== undefined;

      if (!isPwywSubscription && (requestedBumpIds.length > 0 || couponCode || customAmount !== undefined)) {
        return NextResponse.json(
          { error: 'Coupons, custom amounts, and order bumps are not supported for subscription checkout' },
          { status: 400 }
        );
      }

      const stripe = await getStripeServer();
      if (!stripe) {
        return NextResponse.json(
          { error: 'Payment system not configured. Please configure Stripe in admin settings.' },
          { status: 503 }
        );
      }

      const checkoutConfig = await getCheckoutConfig();
      const customerId = finalEmail
        ? await getOrCreateStripeCustomer({
            email: finalEmail,
            userId: user?.id,
          })
        : undefined;

      // Manual VAT rate for local mode only; skipped for stripe_tax and VAT-exempt products.
      const taxRateId = await resolveLocalSubscriptionTaxRateId({
        taxMode: checkoutConfig.tax_mode,
        vatRate: subscriptionProduct.vat_rate,
        priceIncludesVat: subscriptionProduct.price_includes_vat,
        vatExempt: subscriptionProduct.vat_exempt,
      });

      if (isPwywSubscription) {
        const v = validateCustomAmount(customAmount, product);
        if (!v.ok) {
          return NextResponse.json({ error: v.error }, { status: 400 });
        }
        if (!customerId) {
          return NextResponse.json(
            { error: 'Email is required for recurring support' },
            { status: 400 },
          );
        }
        // stripe_tax: PWYW subscriptions go straight to subscriptions.create with no Stripe
        // tax-id collection, so push the buyer's country + EU VAT-ID onto the Customer here so
        // automatic_tax gets the right jurisdiction + B2B reverse charge. Gated on stripe_tax;
        // local is untouched. Fail-safe (never blocks the purchase). NEEDS sandbox verification.
        if (checkoutConfig.tax_mode === 'stripe_tax') {
          await applyBuyerTaxIdentityToCustomer({
            stripe, customerId,
            identity: { country, taxId: nip, address, city, postalCode },
          });
        }
        const stripeProductId = await ensureStripeProduct({
          stripe,
          dataClient,
          product: {
            id: product.id,
            name: product.name,
            stripe_product_id: (product as { stripe_product_id?: string | null }).stripe_product_id ?? null,
          },
        });
        const { clientSecret, subscriptionId } = await createSubscriptionWithDynamicPrice({
          stripe,
          amount: customAmount as number,
          currency: subscriptionProduct.currency,
          customer: customerId,
          stripeProductId,
          productId: subscriptionProduct.id,
          productSlug: subscriptionProduct.slug,
          interval: (subscriptionProduct.billing_interval ?? 'month') as 'day' | 'week' | 'month' | 'year',
          intervalCount: subscriptionProduct.billing_interval_count ?? 1,
          taxRateId,
          automaticTax: checkoutConfig.automatic_tax,
          priceIncludesVat: subscriptionProduct.price_includes_vat,
        });
        const stripeObjectId = extractStripeObjectId(clientSecret);
        const bindingToken = stripeObjectId
          ? signCheckoutBinding({
              stripeObjectId,
              userId: user?.id ?? null,
              productId: subscriptionProduct.id,
            })
          : null;
        return NextResponse.json({ clientSecret, subscriptionId, bindingToken });
      }

      const stripePriceId = await getOrCreateStripePriceForProduct(stripe, subscriptionProduct);
      const returnUrl = `${getCanonicalOrigin(request)}/payment/success?session_id={CHECKOUT_SESSION_ID}&product_id=${encodeURIComponent(subscriptionProduct.id)}&product=${encodeURIComponent(subscriptionProduct.slug)}`;
      const subscriptionSessionParams = buildSubscriptionSessionConfig({
        product: subscriptionProduct,
        customerId,
        stripePriceId,
        returnUrl,
        email: finalEmail,
        userId: user?.id,
        checkoutConfig,
        taxRateId,
        uiMode: 'elements',
      }) as CheckoutSessionCreateParams;

      const checkoutSession = await stripe.checkout.sessions.create(subscriptionSessionParams);
      if (!checkoutSession.client_secret) {
        console.error('[create-payment-intent] Subscription Checkout Session missing client_secret', checkoutSession.id);
        return NextResponse.json(
          { error: 'Failed to initialize checkout session' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        clientSecret: checkoutSession.client_secret,
        checkoutSessionId: checkoutSession.id,
        bindingToken: signCheckoutBinding({
          stripeObjectId: checkoutSession.id,
          userId: user?.id ?? null,
          productId: subscriptionProduct.id,
        }),
      });
    }

    // 3. Validate PWYW (Pay What You Want) custom pricing
    if (customAmount !== undefined) {
      const v = validateCustomAmount(customAmount, product);
      if (!v.ok) {
        return NextResponse.json({ error: v.error }, { status: 400 });
      }
    }

    // 4. Fetch and validate bump products (supports multiple)
    // SECURITY: Must validate that each bumpProductId is a valid order bump for this product
    type ProductRow = typeof product;
    interface ValidatedBump { product: ProductRow; bumpPrice: number }
    const validatedBumps: ValidatedBump[] = [];

    if (requestedBumpIds.length > 0) {
      // Use the same RPC function that frontend uses to get valid bumps
      const { data: validBumps } = await dataClient.rpc('get_product_order_bumps', {
        product_id_param: productId,
      });

      // Build map of valid bump IDs → prices (batch-friendly, avoids N+1 SELECTs)
      const validBumpMap = new Map<string, number>();
      for (const reqBumpId of requestedBumpIds) {
        const validBump = validBumps?.find((b: { bump_product_id: string; bump_currency: string; bump_price: number }) => b.bump_product_id === reqBumpId);
        if (validBump && validBump.bump_currency === product.currency) {
          // SECURITY: Use the bump_price from order_bumps, not the product's regular price
          validBumpMap.set(reqBumpId, validBump.bump_price);
        }
        // Invalid bump IDs are silently ignored
      }

      if (validBumpMap.size > 0) {
        const validBumpIds = Array.from(validBumpMap.keys());
        const { data: bumpProducts } = await dataClient
          .from('products')
          .select('*')
          .in('id', validBumpIds);

        if (bumpProducts) {
          for (const bump of bumpProducts) {
            const price = validBumpMap.get(bump.id)!;
            validatedBumps.push({ product: bump, bumpPrice: price });
          }
        }
      }
    }

    // Backward compat: expose first bump as bumpProduct for downstream code
    const bumpProduct = validatedBumps.length > 0 ? validatedBumps[0].product : null;

    // 5. Fetch and validate coupon using secure DB function
    // SECURITY: Must use verify_coupon RPC which checks all constraints:
    // - usage_limit_global, usage_limit_per_user
    // - expires_at, starts_at
    // - allowed_emails, allowed_product_ids
    // - Race condition prevention with reservations
    let appliedCoupon = null;
    if (couponCode) {
      const { data: couponRaw, error: couponError } = await dataClient.rpc('verify_coupon', {
        code_param: couponCode.toUpperCase(),
        product_id_param: productId,
        customer_email_param: finalEmail || null,
        currency_param: product.currency,
      });
      const couponResult = couponRaw as {
        valid: boolean;
        id: string;
        code: string;
        discount_type: 'percentage' | 'fixed';
        discount_value: number;
        exclude_order_bumps: boolean;
        allowed_product_ids?: string[];
        error?: string;
      } | null;

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
          allowed_product_ids: couponResult.allowed_product_ids || [],
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
      baseProductId: product.id,
      // Charge the active sale price (Omnibus) when running; coupon stacks on top.
      productPrice: getEffectiveUnitPrice(product),
      productCurrency: product.currency,
      customAmount,
      bumps: validatedBumps.map(vb => ({ id: vb.product.id, price: vb.bumpPrice, selected: true })),
      coupon: appliedCoupon ? {
        discount_type: appliedCoupon.discount_type,
        discount_value: appliedCoupon.discount_value,
        code: appliedCoupon.code,
        exclude_order_bumps: appliedCoupon.exclude_order_bumps,
        allowed_product_ids: appliedCoupon.allowed_product_ids,
      } : null,
    });

    const totalAmount = toStripeCents(pricing.totalGross);

    // 7a. Handle 100% coupon — skip Stripe, grant access directly
    if (pricing.isFreeWithCoupon && user) {
      // Grant access for main product
      const { error: grantError } = await dataClient.rpc('grant_free_product_access', {
        product_slug_param: product.slug,
      });

      if (grantError) {
        console.error('[create-payment-intent] Free coupon grant error:', grantError);
        return NextResponse.json(
          { error: 'Failed to grant access' },
          { status: 500 }
        );
      }

      // Grant access for bump products (parallel — independent operations)
      if (validatedBumps.length > 0) {
        const bumpGrantResults = await Promise.all(
          validatedBumps.map(vb =>
            dataClient.rpc('grant_free_product_access', {
              product_slug_param: vb.product.slug,
            })
          )
        );
        for (let i = 0; i < bumpGrantResults.length; i++) {
          if (bumpGrantResults[i].error) {
            console.error(`[create-payment-intent] Free coupon bump grant error for ${validatedBumps[i].product.slug}:`, bumpGrantResults[i].error);
          }
        }
      }

      // Record coupon usage (normally done by webhook, but no Stripe payment here).
      // Best-effort — access is already granted, failures are logged not fatal.
      if (appliedCoupon && finalEmail) {
        const adminClient = createAdminClient();

        try {
          // Record redemption (per-user usage tracking + prevents re-use)
          await adminClient
            .from('coupon_redemptions')
            .insert({
              coupon_id: appliedCoupon.id,
              customer_email: finalEmail,
              user_id: user.id,
              discount_amount: pricing.discountAmount,
              transaction_id: null,
            });

          // Atomic increment of global usage counter (prevents race condition
          // where two concurrent 100% coupon redemptions both read the same count)
          await adminClient.rpc('increment_coupon_usage', {
            coupon_id_param: appliedCoupon.id,
          });

          // Cleanup reservation
          await adminClient
            .from('coupon_reservations')
            .delete()
            .eq('coupon_id', appliedCoupon.id)
            .eq('customer_email', finalEmail);
        } catch (couponErr) {
          console.error('[create-payment-intent] Coupon usage recording error:', couponErr);
        }
      }

      return NextResponse.json({ freeAccess: true });
    }

    // 7a. Handle 100% coupon for guests — require login first
    if (pricing.isFreeWithCoupon && !user) {
      return NextResponse.json(
        { error: 'Please log in to use this coupon for free access' },
        { status: 401 }
      );
    }

    // 7b. Create Checkout Session for Elements
    const bumpIds = validatedBumps.map(vb => vb.product.id);
    const truncatedBumpIds = (() => {
      const ids = bumpIds.join(',');
      if (ids.length > 500) {
        const truncated = ids.slice(0, 500);
        return truncated.slice(0, truncated.lastIndexOf(','));
      }
      return ids;
    })();
    const checkoutMetadata: Record<string, string> = {
      product_id: productId,
      product_name: product.name,
      user_id: user?.id || '',
      email: finalEmail || '',
      first_name: stripeMetadataValue(firstName),
      last_name: stripeMetadataValue(lastName),
      terms_accepted: termsAccepted ? 'true' : '',
      // Multi-bump: comma-separated IDs (truncated to stay within Stripe 500-char metadata limit)
      bump_product_ids: truncatedBumpIds,
      bump_product_id: bumpProduct?.id || '',  // Legacy: first bump for backward compat
      bump_product_name: bumpProduct?.name || '',
      has_bump: validatedBumps.length > 0 ? 'true' : '',
      bump_count: validatedBumps.length.toString(),
      coupon_code: appliedCoupon?.code || '',
      coupon_id: appliedCoupon?.id || '',
      has_coupon: appliedCoupon ? 'true' : 'false',
      coupon_discount: appliedCoupon ? `${appliedCoupon.discount_value}${appliedCoupon.discount_type === 'percentage' ? '%' : product.currency}` : '',
      discount_amount: pricing.discountAmount.toString(),
      needs_invoice: needsInvoice ? 'true' : 'false',
      nip: stripeMetadataValue(nip),
      company_name: stripeMetadataValue(companyName),
      address: stripeMetadataValue(address),
      city: stripeMetadataValue(city),
      postal_code: stripeMetadataValue(postalCode),
      country: stripeMetadataValue(country),
      success_url: successUrl || '',
      custom_amount: pricing.isPwyw ? pricing.basePrice.toString() : '',
      is_pwyw: pricing.isPwyw ? 'true' : 'false',
      repurchase: explicitRepurchase ? 'true' : 'false',
    };

    const returnUrl = `${getCanonicalOrigin(request)}/payment/success?session_id={CHECKOUT_SESSION_ID}&product_id=${encodeURIComponent(product.id)}&product=${encodeURIComponent(product.slug)}${successUrl ? `&success_url=${encodeURIComponent(successUrl)}` : ''}`;
    // Build one Stripe line item per product (main + each bump) via the shared builder
    // — identical to the embedded flow (DRY) — so per-line tax can be captured. The
    // guard below asserts the split preserves the exact total that was charged before.
    const checkoutConfig = await getCheckoutConfig();
    const { specs } = buildCheckoutLineSpecs({
      main: {
        id: product.id,
        name: product.name,
        description: product.description,
        currency: product.currency,
        vatRate: product.vat_rate,
        priceIncludesVat: product.price_includes_vat,
        vatExempt: product.vat_exempt,
      },
      mainPrice: pricing.basePrice,
      bumps: validatedBumps.map((vb) => ({
        product: {
          id: vb.product.id,
          name: vb.product.name,
          description: vb.product.description,
          currency: vb.product.currency,
          vatRate: vb.product.vat_rate,
          priceIncludesVat: vb.product.price_includes_vat,
          vatExempt: vb.product.vat_exempt,
        },
        price: vb.bumpPrice,
      })),
      coupon: appliedCoupon
        ? {
            discount_type: appliedCoupon.discount_type,
            discount_value: appliedCoupon.discount_value,
            code: appliedCoupon.code,
            exclude_order_bumps: appliedCoupon.exclude_order_bumps,
            allowed_product_ids: appliedCoupon.allowed_product_ids,
          }
        : null,
      taxMode: checkoutConfig.tax_mode,
    });

    // SAFETY: per-line split must never change the charged total. Both totalAmount and
    // these specs derive from the same allocateCouponDiscount, so equality holds by
    // construction — log loudly if it ever diverges (would signal a pricing-logic drift).
    const lineItemsTotalMinor = specs.reduce((sum, s) => sum + s.unitAmountMinor, 0);
    if (lineItemsTotalMinor !== totalAmount) {
      console.error(
        `[create-payment-intent] Tax-split total mismatch: lines=${lineItemsTotalMinor} expected=${totalAmount} product=${product.id}`
      );
    }

    const lineItems = await buildStripeLineItems(specs, {
      resolveTaxRate: getOrCreateStripeTaxRate,
    });

    const checkoutSessionParams: CheckoutSessionCreateParams = {
      mode: 'payment',
      ui_mode: 'elements',
      line_items: lineItems as CheckoutSessionCreateParams['line_items'],
      return_url: returnUrl,
      customer_email: finalEmail || undefined,
      client_reference_id: user?.id || finalEmail || undefined,
      metadata: checkoutMetadata,
      // Tax: mirror embedded so on-site captures VAT consistently. In local mode (default)
      // automatic_tax is disabled and per-line tax_rates carry the tax; in stripe_tax mode
      // Stripe computes it. (tax_id_collection/billing_address parity deferred — UX change.)
      automatic_tax: checkoutConfig.automatic_tax,
      payment_intent_data: {
        metadata: checkoutMetadata,
        receipt_email: finalEmail || undefined,
      },
    };

    // Fetch payment method configuration
    const { data: paymentConfig } = await dataClient
      .from('payment_method_config')
      .select('*')
      .eq('id', 1)
      .single() as { data: PaymentMethodConfig | null };

    // Apply payment method configuration based on mode
    // SECURITY: Payment method configuration is applied server-side only.
    // Client cannot override which payment methods are available.
    // FALLBACK STRATEGY: If config is missing/invalid, we fallback to Stripe's
    // Dynamic payment methods to ensure checkout always works. This is logged
    // for monitoring but doesn't expose any sensitive information.
    if (paymentConfig) {
      switch (paymentConfig.config_mode) {
        case 'automatic':
          // Checkout Sessions use Stripe automatic payment methods by default.
          break;

        case 'stripe_preset':
          // Use specific Stripe Payment Method Configuration
          if (paymentConfig.stripe_pmc_id) {
            checkoutSessionParams.payment_method_configuration = paymentConfig.stripe_pmc_id;
          } else {
            // Fallback to automatic if PMC ID is missing
            console.warn('[create-payment-intent] stripe_preset mode but no PMC ID, falling back to automatic');
          }
          break;

        case 'custom':
          // Use explicit payment method types with currency filtering
          const enabledMethods = getEnabledPaymentMethodsForCurrency(
            paymentConfig,
            product.currency
          );

          // Apple Pay & Google Pay are card wallets — they require 'card' in
          // payment_method_types to appear in ExpressCheckoutElement.
          if (paymentConfig.enable_express_checkout &&
              (paymentConfig.enable_apple_pay || paymentConfig.enable_google_pay) &&
              !enabledMethods.includes('card')) {
            enabledMethods.push('card');
          }

          const checkoutPaymentMethods = enabledMethods.filter(method => method !== 'link');
          if (checkoutPaymentMethods.length > 0) {
            checkoutSessionParams.payment_method_types =
              checkoutPaymentMethods as CheckoutPaymentMethodType[];
          } else {
            // Fallback if no methods match currency and no express checkout
            console.warn('[create-payment-intent] No payment methods match currency, falling back to automatic');
          }
          break;
      }
    } else {
      // Fallback if config is missing (shouldn't happen due to migration seed)
      // This ensures checkout always works even if config table is empty/corrupted
      console.warn('[create-payment-intent] Payment config not found, using automatic mode');
    }

    const stripe = await getStripeServer();
    if (!stripe) {
      return NextResponse.json(
        { error: 'Payment system not configured. Please configure Stripe in admin settings.' },
        { status: 503 }
      );
    }

    const existingCheckoutSessionId =
      typeof clientSecret === 'string' ? extractCheckoutSessionId(clientSecret) : null;

    if (clientSecret && !existingCheckoutSessionId) {
      return NextResponse.json(
        { error: 'Invalid checkout session format' },
        { status: 400 }
      );
    }

    if (existingCheckoutSessionId) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(existingCheckoutSessionId);
        const sessionOwnerId =
          typeof existingSession.metadata?.user_id === 'string' && existingSession.metadata.user_id.length > 0
            ? existingSession.metadata.user_id
            : null;
        const sessionProductId =
          typeof existingSession.metadata?.product_id === 'string' && existingSession.metadata.product_id.length > 0
            ? existingSession.metadata.product_id
            : null;
        const bindingOk =
          typeof previousBindingToken === 'string' &&
          sessionProductId !== null &&
          verifyCheckoutBinding(previousBindingToken, {
            stripeObjectId: existingCheckoutSessionId,
            userId: sessionOwnerId,
            productId: sessionProductId,
          });
        if (bindingOk && existingSession.status === 'open') {
          await stripe.checkout.sessions.expire(existingCheckoutSessionId);
        } else if (!bindingOk) {
          console.warn('[create-payment-intent] Skipping expire of previous session: missing or invalid binding token');
        }
      } catch (expireError) {
        console.warn('[create-payment-intent] Failed to expire previous Checkout Session:', expireError);
      }
    }

    // stripe_tax + on-site (Elements): the session is otherwise a guest-by-email checkout with
    // no Customer, so automatic_tax has no buyer address/VAT-ID to work from (B2B reverse charge
    // never applies, jurisdiction is guessed). Attach a Customer carrying the buyer's country +
    // EU VAT-ID so Stripe Tax computes correctly. Gated on stripe_tax → the local guest path is
    // byte-identical. Fail-safe. NEEDS Stripe Tax sandbox verification (see priv/tasks/…).
    if (checkoutConfig.tax_mode === 'stripe_tax' && finalEmail) {
      const taxCustomerId = await getOrCreateStripeCustomer({ email: finalEmail, userId: user?.id });
      await applyBuyerTaxIdentityToCustomer({
        stripe, customerId: taxCustomerId,
        identity: { country, taxId: nip, address, city, postalCode },
      });
      checkoutSessionParams.customer = taxCustomerId;
      delete checkoutSessionParams.customer_email; // Stripe rejects customer + customer_email together
    }

    const checkoutSession = await stripe.checkout.sessions.create(checkoutSessionParams);

    if (!checkoutSession.client_secret) {
      console.error('[create-payment-intent] Checkout Session missing client_secret', checkoutSession.id);
      return NextResponse.json(
        { error: 'Failed to initialize checkout session' },
        { status: 500 }
      );
    }

    // Save pending payment transaction for abandoned cart recovery
    try {
      const { error: insertError } = await dataClient
        .from('payment_transactions')
        .insert({
          session_id: checkoutSession.id,
          user_id: user?.id || null,
          product_id: productId,
          customer_email: finalEmail || 'pending@sellf.app', // Fallback for guests without email
          amount: totalAmount,
          currency: product.currency,
          stripe_payment_intent_id: null,
          status: 'pending',
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
          metadata: {
            ...checkoutMetadata,
            // Full bump list (not subject to Stripe's 500-char metadata limit)
            bump_product_ids_full: bumpIds,
          },
          custom_field_values: validatedCustomFieldValues,
        });

      if (insertError) {
        // Log error but don't fail the Checkout Session creation
        console.error('Failed to save pending transaction:', insertError);
      }
    } catch (dbError) {
      // Don't fail Checkout Session creation if DB insert fails
      console.error('Error saving pending transaction:', dbError);
    }

    return NextResponse.json({
      clientSecret: checkoutSession.client_secret,
      checkoutSessionId: checkoutSession.id,
      paymentIntentId: null,
      bindingToken: signCheckoutBinding({
        stripeObjectId: checkoutSession.id,
        userId: user?.id ?? null,
        productId,
      }),
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}
