import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeServer } from '@/lib/stripe/server';
import { ProductValidationService, type ValidatedProduct } from '@/lib/services/product-validation';
import {
  CheckoutError,
  CheckoutErrorType,
  CheckoutSessionOptions,
  CreateCheckoutRequest
} from '@/types/checkout';
import { STRIPE_CONFIG, CHECKOUT_ERRORS, HTTP_STATUS } from '@/lib/stripe/config';
import { getCheckoutConfig } from '@/lib/stripe/checkout-config';
import { getOrCreateStripeTaxRate } from '@/lib/stripe/tax-rate-manager';
import { sanitizeForLog } from '@/lib/logger';

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
      const safeEmail = sanitizeForLog(request.email);
      console.log(`🔍 Validating email: ${safeEmail}`);
      const isValidEmail = await ProductValidationService.validateEmail(request.email);
      console.log(`✅ Email validation result for ${safeEmail}: ${isValidEmail}`);
      if (!isValidEmail) {
        console.log(`❌ Blocking disposable email: ${safeEmail}`);
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
    const adminClient = createAdminClient();
    const { data: rateLimitOk, error } = await adminClient.rpc('check_rate_limit', {
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
      
      throw new CheckoutError(
        CheckoutErrorType.VALIDATION_ERROR,
        message,
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
      throw new CheckoutError(
        CheckoutErrorType.PRODUCT_UNAVAILABLE,
        error instanceof Error ? error.message : 'Product not available for purchase',
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
      const { coupon, customAmount } = options;

      // Calculate base price - use customAmount if provided (Pay What You Want)
      let mainProductPrice = options.product.price;
      if (customAmount !== undefined && customAmount > 0) {
        const minPrice = options.product.custom_price_min ?? 0.50;
        if (customAmount < minPrice) {
          throw new CheckoutError(
            CheckoutErrorType.VALIDATION_ERROR,
            `Amount must be at least ${minPrice} ${options.product.currency}`,
            HTTP_STATUS.BAD_REQUEST
          );
        }
        mainProductPrice = customAmount;
      }

      // Apply coupon discount
      if (coupon) {
        if (coupon.discount_type === 'percentage') {
          mainProductPrice = mainProductPrice * (1 - coupon.discount_value / 100);
        } else if (coupon.discount_type === 'fixed') {
          // Subtract fixed amount from main product, minimum $0.50 (Stripe min)
          mainProductPrice = Math.max(0.5, mainProductPrice - coupon.discount_value);
        }
      }

      // Resolve checkout config: DB > env var > default
      const checkoutConfig = await getCheckoutConfig();

      // --- Tax mode: resolve tax_behavior and tax_rates per line item ---
      const isLocalTax = checkoutConfig.tax_mode === 'local';

      // Resolve tax rates for local mode (per-product vat_rate)
      let mainTaxRates: string[] | undefined;
      let bumpTaxRates: string[] | undefined;

      if (isLocalTax) {
        if (options.product.vat_rate && options.product.vat_rate > 0) {
          const txrId = await getOrCreateStripeTaxRate({
            percentage: options.product.vat_rate,
            inclusive: options.product.price_includes_vat,
          });
          mainTaxRates = [txrId];
        }

        if (options.bumpProduct?.vat_rate && options.bumpProduct.vat_rate > 0) {
          const txrId = await getOrCreateStripeTaxRate({
            percentage: options.bumpProduct.vat_rate,
            inclusive: options.bumpProduct.price_includes_vat,
          });
          bumpTaxRates = [txrId];
        }
      }

      // tax_behavior: tells Stripe how to interpret the price amount
      // In stripe_tax mode: required for automatic tax calculation
      // In local mode with vat_rate: tells Stripe the price is inclusive/exclusive of the attached tax rate
      const mainTaxBehavior = (isLocalTax && mainTaxRates) || !isLocalTax
        ? (options.product.price_includes_vat ? 'inclusive' : 'exclusive')
        : undefined;

      // Build line items array (main product + optional bump)
      const lineItems: Record<string, unknown>[] = [
        {
          price_data: {
            currency: options.product.currency.toLowerCase(),
            product_data: {
              name: options.product.name,
              description: options.product.description || undefined,
            },
            unit_amount: Math.round(mainProductPrice * 100),
            ...(mainTaxBehavior && { tax_behavior: mainTaxBehavior }),
          },
          ...(mainTaxRates && { tax_rates: mainTaxRates }),
          quantity: 1,
        },
      ];

      // Add bump product as second line item if provided
      if (options.bumpProduct) {
        let bumpPrice = options.bumpProduct.price;
        // Percentage discounts apply to bump unless excluded
        if (coupon && coupon.discount_type === 'percentage' && !coupon.exclude_order_bumps) {
          bumpPrice = bumpPrice * (1 - coupon.discount_value / 100);
        }

        const bumpTaxBehavior = (isLocalTax && bumpTaxRates) || !isLocalTax
          ? (options.bumpProduct.price_includes_vat ? 'inclusive' : 'exclusive')
          : undefined;

        lineItems.push({
          price_data: {
            currency: options.bumpProduct.currency.toLowerCase(),
            product_data: {
              name: options.bumpProduct.name,
              description: options.bumpProduct.description || undefined,
            },
            unit_amount: Math.round(bumpPrice * 100),
            ...(bumpTaxBehavior && { tax_behavior: bumpTaxBehavior }),
          },
          ...(bumpTaxRates && { tax_rates: bumpTaxRates }),
          quantity: 1,
        });
      }

      // Prepare session configuration
      const sessionConfig: Record<string, unknown> = {
        ui_mode: 'embedded' as const,
        line_items: lineItems,
        mode: 'payment' as const,
        return_url: options.returnUrl,
        // Set redirect_on_completion to 'always' for proper server-side verification
        redirect_on_completion: 'always',
        metadata: {
          product_id: options.product.id,
          product_slug: options.product.slug,
          user_id: options.userId || null,
          // Add bump product metadata if present
          ...(options.bumpProduct && {
            bump_product_id: options.bumpProduct.id,
            has_bump: 'true',
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
        },
        expires_at: Math.floor(Date.now() / 1000) + (checkoutConfig.expires_hours * 60 * 60),
        automatic_tax: checkoutConfig.automatic_tax,
        tax_id_collection: checkoutConfig.tax_id_collection,
        billing_address_collection: checkoutConfig.billing_address_collection,
      };

      // Apply payment method config based on mode
      if (checkoutConfig.paymentMethodMode === 'automatic') {
        sessionConfig.automatic_payment_methods = { enabled: true };
      } else if (checkoutConfig.paymentMethodMode === 'stripe_preset' && checkoutConfig.stripePresetId) {
        sessionConfig.payment_method_configuration = checkoutConfig.stripePresetId;
      } else {
        sessionConfig.payment_method_types = [...checkoutConfig.payment_method_types];
      }

      // Only add customer_email if it's a valid email
      if (options.email && options.email.trim() !== '') {
        console.log(`📧 Passing customer_email to Stripe: ${sanitizeForLog(options.email)}`);
        sessionConfig.customer_email = options.email;
      } else {
        console.log('📧 No customer_email available for Stripe session');
      }

      // Add terms of service collection if enabled (resolved via DB > env > default)
      if (checkoutConfig.collect_terms_of_service) {
        sessionConfig.consent_collection = {
          terms_of_service: 'required',
        };
      }

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
        `Failed to create checkout session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Complete checkout flow - main orchestration method
   */
  async createCheckoutSession(
    request: CreateCheckoutRequest,
    returnUrl: string,
    userId?: string
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

    // Handle order bump if provided
    let bumpProduct: ProductForCheckout | undefined;
    if (request.bumpProductId) {
      try {
        bumpProduct = await this.getProduct(request.bumpProductId);
        this.validateTemporalAvailability(bumpProduct);

        // Fetch special bump price from order_bumps table
        const { data: bumpData } = await this.supabase
          .from('order_bumps')
          .select('bump_price')
          .eq('main_product_id', request.productId)
          .eq('bump_product_id', request.bumpProductId)
          .eq('is_active', true)
          .single();

        if (bumpData && bumpData.bump_price !== null) {
          // Override the product price with the special bump price
          // Create a new object to avoid mutating cached data if any
          bumpProduct = {
            ...bumpProduct,
            price: bumpData.bump_price
          };
        }
      } catch (error) {
        console.error('Error validating bump product:', error);
        // Continue without bump if validation fails
        bumpProduct = undefined;
      }
    }

    // Handle coupon verification
    let couponInfo: any = undefined;
    if (request.couponCode) {
      console.log(`🎟 Verifying coupon: ${sanitizeForLog(request.couponCode)} for email: ${sanitizeForLog(request.email || '')}`);
      try {
        const { data: vResult } = await this.supabase.rpc('verify_coupon', {
          code_param: request.couponCode.toUpperCase(),
          product_id_param: product.id,
          customer_email_param: request.email || null
        });

        console.log(`🎟 Coupon verification result:`, JSON.stringify(vResult, null, 2));

        if (vResult && vResult.valid) {
          couponInfo = {
            id: vResult.id,
            code: vResult.code,
            discount_type: vResult.discount_type,
            discount_value: vResult.discount_value,
            exclude_order_bumps: vResult.exclude_order_bumps
          };
          console.log(`🎟 Discount applied: ${couponInfo.discount_type} ${couponInfo.discount_value}`);
        }
      } catch (error) {
        console.error('Error verifying coupon during checkout:', error);
      }
    } else {
      console.log('🎟 No coupon code provided in request');
    }

    // Validate custom amount for Pay What You Want
    if (request.customAmount !== undefined && request.customAmount > 0) {
      const minPrice = product.custom_price_min ?? 0.50;
      if (request.customAmount < minPrice) {
        throw new CheckoutError(
          CheckoutErrorType.VALIDATION_ERROR,
          `Amount must be at least ${minPrice} ${product.currency}`,
          HTTP_STATUS.BAD_REQUEST
        );
      }
    }

    // Create Stripe session
    return await this.createStripeSession({
      product,
      bumpProduct,
      email: request.email,
      userId,
      returnUrl,
      coupon: couponInfo,
      customAmount: request.customAmount
    });
  }
}
