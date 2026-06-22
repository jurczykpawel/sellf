import { createClient } from '@/lib/supabase/server';
import { createAdminClient, createPlatformClient } from '@/lib/supabase/admin';
import { getStripeServer } from '@/lib/stripe/server';
import { ProductValidationService, type ValidatedProduct } from '@/lib/services/product-validation';
import {
  CheckoutError,
  CheckoutErrorType,
  CheckoutSessionOptions,
  CreateCheckoutRequest,
} from '@/types/checkout';
import { STRIPE_MINIMUM_AMOUNT } from '@/lib/constants';
import { validateCustomAmount } from '@/lib/payment/custom-amount';
import { STRIPE_CONFIG, CHECKOUT_ERRORS, HTTP_STATUS } from '@/lib/stripe/config';
import { getCheckoutConfig } from '@/lib/stripe/checkout-config';
import { getOrCreateStripeTaxRate } from '@/lib/stripe/tax-rate-manager';
import { buildCheckoutLineSpecs, buildStripeLineItems } from '@/lib/services/checkout-line-items';
import { getEffectiveUnitPrice } from '@/lib/services/omnibus';
import { normalizeBumpIds } from '@/lib/validations/product';
import { getOrCreateStripeCustomer } from '@/lib/stripe/customer';
import { buildSubscriptionSessionConfig } from '@/lib/stripe/subscription-checkout';
import { getOrCreateStripePriceForProduct } from '@/lib/stripe/product-price';
import { applyTosConsent } from '@/lib/stripe/tos-consent';


// Remove the local ProductForCheckout interface since we now use ValidatedProduct
type ProductForCheckout = ValidatedProduct;

/**
 * Professional checkout service with proper error handling and validation
 */
export class CheckoutService {
  private supabase!: Awaited<ReturnType<typeof createClient>>;
  private stripe!: Awaited<ReturnType<typeof getStripeServer>>;
  private validationService!: ProductValidationService;

  /**
   * Initialize the service (must be called before using other methods)
   */
  async initialize(): Promise<void> {
    this.supabase = await createClient();
    this.stripe = await getStripeServer();
    this.validationService = new ProductValidationService(this.supabase);
  }

  /**
   * Validate checkout request data
   */
  async validateRequest(request: CreateCheckoutRequest): Promise<void> {
    if (!request.productId) {
      throw new CheckoutError(
        CheckoutErrorType.VALIDATION_ERROR,
        CHECKOUT_ERRORS.PRODUCT_ID_REQUIRED,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // Enhanced email validation with disposable domain checking
    if (request.email) {
      const isValidEmail = await ProductValidationService.validateEmail(request.email);
      if (!isValidEmail) {
        throw new CheckoutError(
          CheckoutErrorType.VALIDATION_ERROR,
          'Invalid or disposable email address not allowed',
          HTTP_STATUS.BAD_REQUEST
        );
      }
    }
  }

  /**
   * Check rate limiting for checkout creation
   */
  async checkRateLimit(): Promise<void> {
    const platformClient = createPlatformClient();
    const { data: rateLimitOk, error } = await platformClient.rpc('check_rate_limit', {
      function_name_param: STRIPE_CONFIG.rate_limit.action_type,
      max_calls: STRIPE_CONFIG.rate_limit.max_requests,
      time_window_seconds: STRIPE_CONFIG.rate_limit.window_minutes * 60,
    });

    if (error || !rateLimitOk) {
      throw new CheckoutError(
        CheckoutErrorType.RATE_LIMIT_ERROR,
        CHECKOUT_ERRORS.RATE_LIMIT_EXCEEDED,
        HTTP_STATUS.TOO_MANY_REQUESTS
      );
    }
  }

  /**
   * Get and validate product for checkout (now uses ProductValidationService)
   */
  async getProduct(productId: string): Promise<ProductForCheckout> {
    try {
      return await this.validationService.validateProduct(productId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Product validation failed';
      
      if (message.includes('not found') || message.includes('inactive')) {
        throw new CheckoutError(
          CheckoutErrorType.PRODUCT_NOT_FOUND,
          CHECKOUT_ERRORS.PRODUCT_NOT_FOUND,
          HTTP_STATUS.NOT_FOUND
        );
      }
      
      if (message.includes('price')) {
        throw new CheckoutError(
          CheckoutErrorType.VALIDATION_ERROR,
          CHECKOUT_ERRORS.INVALID_PRICE,
          HTTP_STATUS.BAD_REQUEST
        );
      }
      
      console.error('[CheckoutService.getProduct] Error:', error)
      throw new CheckoutError(
        CheckoutErrorType.VALIDATION_ERROR,
        'Product validation failed',
        HTTP_STATUS.BAD_REQUEST
      );
    }
  }

  /**
   * Validate temporal availability of product (now uses ProductValidationService)
   */
  validateTemporalAvailability(product: ProductForCheckout): void {
    try {
      ProductValidationService.validateTemporalAvailability(product);
    } catch (error) {
      console.error('[CheckoutService.validateTemporalAvailability] Error:', error)
      throw new CheckoutError(
        CheckoutErrorType.PRODUCT_UNAVAILABLE,
        'Product is not currently available for purchase',
        HTTP_STATUS.BAD_REQUEST
      );
    }
  }

    /**
   * Check if user already has access to prevent duplicate purchases (now uses ProductValidationService)
   */
  async checkExistingAccess(userId: string, productId: string): Promise<void> {
    const userAccess = await this.validationService.checkUserAccess(userId, productId);
    
    if (userAccess.hasAccess) {
      throw new CheckoutError(
        CheckoutErrorType.DUPLICATE_ACCESS,
        CHECKOUT_ERRORS.DUPLICATE_ACCESS,
        HTTP_STATUS.BAD_REQUEST
      );
    }
  }

  /**
   * Create Stripe checkout session
   */
  async createStripeSession(options: CheckoutSessionOptions): Promise<{ clientSecret: string; sessionId: string }> {
    try {
      // Subscription products bypass bumps / coupons / PWYW (MVP scope).
      if (options.product.product_type === 'subscription') {
        return await this.createSubscriptionStripeSession(options);
      }

      const { coupon, customAmount } = options;
      const bumpList = options.bumpProducts && options.bumpProducts.length > 0
        ? options.bumpProducts
        : options.bumpProduct ? [options.bumpProduct] : [];

      // Calculate base price - use customAmount if provided (Pay What You Want),
      // otherwise the active sale price (Omnibus) when running, else regular price.
      // The coupon allocation below then applies on top of whichever base wins.
      let pricedMainProduct = options.product;
      if (customAmount !== undefined && customAmount > 0) {
        const minPrice = pricedMainProduct.custom_price_min ?? STRIPE_MINIMUM_AMOUNT;
        if (customAmount < minPrice) {
          throw new CheckoutError(
            CheckoutErrorType.VALIDATION_ERROR,
            `Amount must be at least ${minPrice} ${pricedMainProduct.currency}`,
            HTTP_STATUS.BAD_REQUEST
          );
        }
        pricedMainProduct = { ...pricedMainProduct, price: customAmount };
      } else {
        pricedMainProduct = { ...pricedMainProduct, price: getEffectiveUnitPrice(pricedMainProduct) };
      }

      // Resolve checkout config: DB > env var > default
      const checkoutConfig = await getCheckoutConfig();

      // --- Build line items (main + bumps) via the shared builder (identical to Elements) ---
      // Same allocateCouponDiscount math as before, now centralized so embedded and
      // Elements emit identical per-line items (DRY). Main line now carries
      // metadata.product_id so the tax snapshot can match it back to its row.
      const { specs, isFree } = buildCheckoutLineSpecs({
        main: {
          id: options.product.id,
          name: pricedMainProduct.name,
          description: pricedMainProduct.description,
          currency: pricedMainProduct.currency,
          vatRate: options.product.vat_rate,
          priceIncludesVat: options.product.price_includes_vat,
          vatExempt: options.product.vat_exempt,
        },
        mainPrice: pricedMainProduct.price,
        bumps: bumpList.map((bp) => ({
          product: {
            id: bp.id,
            name: bp.name,
            description: bp.description,
            currency: bp.currency,
            vatRate: bp.vat_rate,
            priceIncludesVat: bp.price_includes_vat,
            vatExempt: bp.vat_exempt,
          },
          price: bp.price,
        })),
        coupon: coupon
          ? {
              discount_type: coupon.discount_type,
              discount_value: coupon.discount_value,
              code: coupon.code,
              exclude_order_bumps: coupon.exclude_order_bumps,
              allowed_product_ids: coupon.allowed_product_ids,
            }
          : null,
        taxMode: checkoutConfig.tax_mode,
      });

      if (coupon && isFree) {
        throw new CheckoutError(
          CheckoutErrorType.VALIDATION_ERROR,
          'This coupon covers the full price. Please use the standard checkout for free access.',
          HTTP_STATUS.BAD_REQUEST
        );
      }

      const lineItems = await buildStripeLineItems(specs, {
        resolveTaxRate: getOrCreateStripeTaxRate,
      });

      // Prepare session configuration
      const sessionConfig: Record<string, unknown> = {
        ui_mode: 'embedded_page' as const,
        line_items: lineItems,
        mode: 'payment' as const,
        return_url: options.returnUrl,
        // Set redirect_on_completion to 'always' for proper server-side verification
        redirect_on_completion: 'always',
        metadata: {
          product_id: options.product.id,
          product_slug: options.product.slug,
          user_id: options.userId || null,
          // Add bump product metadata (multi-bump support)
          ...(bumpList.length > 0 && {
            bump_product_ids: (() => {
              const ids = bumpList.map(bp => bp.id).join(',');
              if (ids.length > 500) {
                const truncated = ids.slice(0, 500);
                return truncated.slice(0, truncated.lastIndexOf(','));
              }
              return ids;
            })(),
            bump_product_id: bumpList[0].id, // Legacy compat
            has_bump: 'true',
            bump_count: bumpList.length.toString(),
          }),
          // Add coupon metadata if present
          ...(coupon && {
            coupon_id: coupon.id,
            coupon_code: coupon.code,
            has_coupon: 'true'
          }),
          // Pay What You Want metadata
          ...((customAmount !== undefined && customAmount > 0) && {
            custom_amount: customAmount.toString(),
            is_pwyw: 'true'
          }),
          ...(options.embedSessionId && {
            embed_session_id: options.embedSessionId,
          }),
        },
        expires_at: Math.floor(Date.now() / 1000) + (checkoutConfig.expires_hours * 60 * 60),
        automatic_tax: checkoutConfig.automatic_tax,
        tax_id_collection: checkoutConfig.tax_id_collection,
        billing_address_collection: checkoutConfig.billing_address_collection,
      };

      // Apply payment method config based on mode
      if (checkoutConfig.paymentMethodMode === 'automatic') {
        // Checkout Sessions use Stripe Dynamic Payment Methods by default.
        // Do not pass automatic_payment_methods: Stripe rejects that parameter
        // for Checkout Sessions on the current API version.
      } else if (checkoutConfig.paymentMethodMode === 'stripe_preset' && checkoutConfig.stripePresetId) {
        sessionConfig.payment_method_configuration = checkoutConfig.stripePresetId;
      } else {
        sessionConfig.payment_method_types = [...checkoutConfig.payment_method_types];
      }

      // Only add customer_email if it's a valid email
      if (options.email && options.email.trim() !== '') {
        sessionConfig.customer_email = options.email;
      }

      // ToS consent: single rule in applyTosConsent (set only for Stripe-rendered
      // sessions; Elements collects consent via Sellf's own TermsCheckbox).
      applyTosConsent(sessionConfig, checkoutConfig);

      const session = await this.stripe.checkout.sessions.create(sessionConfig);

      if (!session.client_secret) {
        throw new CheckoutError(
          CheckoutErrorType.STRIPE_ERROR,
          CHECKOUT_ERRORS.STRIPE_SESSION_FAILED,
          HTTP_STATUS.INTERNAL_SERVER_ERROR
        );
      }
      return {
        clientSecret: session.client_secret,
        sessionId: session.id,
      };
    } catch (error) {
      if (error instanceof CheckoutError) {
        throw error;
      }
      
      // Log the actual Stripe error for debugging
      console.error('Stripe session creation error:', error);

      throw new CheckoutError(
        CheckoutErrorType.STRIPE_ERROR,
        'Failed to create checkout session. Please try again or contact support.',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Subscription-mode checkout session. MVP scope: no bumps / coupons / PWYW.
   * @see buildSubscriptionSessionConfig
   */
  private async createSubscriptionStripeSession(
    options: CheckoutSessionOptions
  ): Promise<{ clientSecret: string; sessionId: string }> {
    const { product, returnUrl, email, userId } = options;
    const customerEmail = email?.trim();
    if (!customerEmail) {
      throw new CheckoutError(
        CheckoutErrorType.VALIDATION_ERROR,
        'Email is required for subscription checkout',
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const checkoutConfig = await getCheckoutConfig();

    const customerId = await getOrCreateStripeCustomer({ email: customerEmail, userId });

    let taxRateId: string | undefined;
    if (checkoutConfig.tax_mode === 'local' && product.vat_rate && product.vat_rate > 0) {
      taxRateId = await getOrCreateStripeTaxRate({
        percentage: product.vat_rate,
        inclusive: product.price_includes_vat,
      });
    }

    // durable Stripe Price binding (created lazily, persisted on
    // products.stripe_price_id). Webhook handlers verify sub.items.data[0].price.id
    // against this id to prove product identity.
    const stripePriceId = await getOrCreateStripePriceForProduct(this.stripe, product);

    const sessionConfig = buildSubscriptionSessionConfig({
      product,
      customerId,
      stripePriceId,
      returnUrl,
      email: customerEmail,
      userId,
      checkoutConfig,
      taxRateId,
    });

    const session = await this.stripe.checkout.sessions.create(sessionConfig);

    if (!session.client_secret) {
      throw new CheckoutError(
        CheckoutErrorType.STRIPE_ERROR,
        CHECKOUT_ERRORS.STRIPE_SESSION_FAILED,
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }
    return {
      clientSecret: session.client_secret,
      sessionId: session.id,
    };
  }

  /**
   * Complete checkout flow - main orchestration method
   */
  async createCheckoutSession(
    request: CreateCheckoutRequest,
    returnUrl: string,
    userId?: string,
    options?: { embedSessionId?: string }
  ): Promise<{ clientSecret: string; sessionId: string }> {
    // Initialize service
    await this.initialize();

    // Validate request
    await this.validateRequest(request);

    // Rate limiting check
    await this.checkRateLimit();

    // Get and validate product
    const product = await this.getProduct(request.productId);
    this.validateTemporalAvailability(product);

    // Check existing access for logged-in users
    if (userId) {
      await this.checkExistingAccess(userId, product.id);
    }

    // Handle order bumps (supports multiple)
    // Normalize + validate bump IDs (supports legacy single bumpProductId)
    const { validIds: validBumpIds } = normalizeBumpIds({
      bumpProductId: request.bumpProductId,
      bumpProductIds: request.bumpProductIds,
    });

    // SECURITY: Cap bump IDs count at application level to prevent DoS via hundreds of
    // validation queries. DB function also limits to 20, but this avoids the round-trips.
    const MAX_BUMP_IDS = 20;
    if (validBumpIds.length > MAX_BUMP_IDS) {
      throw new CheckoutError(
        CheckoutErrorType.VALIDATION_ERROR,
        `Too many bump products (maximum ${MAX_BUMP_IDS})`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const bumpProducts: ProductForCheckout[] = [];
    if (validBumpIds.length > 0) {
      // Batch-fetch all bump price overrides in a single query (avoids N+1)
      const { data: allBumpData } = await this.supabase
        .from('order_bumps')
        .select('bump_product_id, bump_price')
        .eq('main_product_id', request.productId)
        .in('bump_product_id', validBumpIds)
        .eq('is_active', true);

      const bumpPriceMap = new Map(
        (allBumpData || []).map(b => [b.bump_product_id, b.bump_price])
      );

      // Fetch + validate all bump products in parallel (avoids N+1 sequential SELECTs)
      const bumpResults = await Promise.all(
        validBumpIds.map(async (bumpId) => {
          try {
            let bp = await this.getProduct(bumpId);
            this.validateTemporalAvailability(bp);

            const overridePrice = bumpPriceMap.get(bumpId);
            if (overridePrice !== undefined && overridePrice !== null) {
              bp = { ...bp, price: overridePrice };
            }
            return bp;
          } catch (error) {
            // Log but don't silently skip — if user selected a bump and it fails validation,
            // better to warn than charge without the expected bump
            console.error(`[checkout] Bump product ${bumpId} validation failed:`, error);
            // Skip bumps that are not found or temporally unavailable (expected cases)
            // but log clearly so issues can be investigated
            return null;
          }
        })
      );
      for (const bp of bumpResults) {
        if (bp) bumpProducts.push(bp);
      }
    }

    // Backward compat: first bump available as bumpProduct
    const bumpProduct: ProductForCheckout | undefined = bumpProducts[0];

    // Handle coupon verification
    let couponInfo: {
      id: string;
      code: string;
      discount_type: 'percentage' | 'fixed';
      discount_value: number;
      exclude_order_bumps?: boolean;
      allowed_product_ids?: string[];
    } | undefined = undefined;
    if (request.couponCode) {
      try {
        const { data: vResult, error: couponError } = await this.supabase.rpc('verify_coupon', {
          code_param: request.couponCode.toUpperCase(),
          product_id_param: product.id,
          customer_email_param: request.email || null,
          currency_param: product.currency,
        });

        if (couponError) {
          console.error('Coupon verification error:', couponError);
          throw new CheckoutError(
            CheckoutErrorType.VALIDATION_ERROR,
            'Failed to verify coupon. Please try again.',
            HTTP_STATUS.INTERNAL_SERVER_ERROR
          );
        }

        if (vResult && vResult.valid) {
          couponInfo = {
            id: vResult.id,
            code: vResult.code,
            discount_type: vResult.discount_type,
            discount_value: vResult.discount_value,
            exclude_order_bumps: vResult.exclude_order_bumps,
            allowed_product_ids: vResult.allowed_product_ids || [],
          };
        } else {
          // Don't silently ignore invalid coupon — user expects a discount
          throw new CheckoutError(
            CheckoutErrorType.VALIDATION_ERROR,
            vResult?.error || 'Coupon code is no longer valid. Please remove it and try again.',
            HTTP_STATUS.BAD_REQUEST
          );
        }
      } catch (error) {
        // Re-throw CheckoutErrors; wrap unexpected errors
        if (error instanceof CheckoutError) throw error;
        console.error('Error verifying coupon during checkout:', error);
        throw new CheckoutError(
          CheckoutErrorType.VALIDATION_ERROR,
          'Failed to verify coupon. Please try again.',
          HTTP_STATUS.INTERNAL_SERVER_ERROR
        );
      }
    }

    // Validate custom amount for Pay What You Want
    if (request.customAmount !== undefined) {
      const v = validateCustomAmount(request.customAmount, product);
      if (!v.ok) {
        throw new CheckoutError(
          CheckoutErrorType.VALIDATION_ERROR,
          v.error,
          HTTP_STATUS.BAD_REQUEST
        );
      }
    }

    // Create Stripe session
    return await this.createStripeSession({
      product,
      bumpProduct,
      bumpProducts: bumpProducts.length > 0 ? bumpProducts : undefined,
      email: request.email,
      userId,
      returnUrl,
      embedSessionId: options?.embedSessionId,
      coupon: couponInfo,
      customAmount: request.customAmount,
    });
  }
}
