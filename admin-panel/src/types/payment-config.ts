/**
 * Payment Method Configuration Types
 *
 * Type definitions for global payment method configuration system.
 * Supports three modes: automatic, stripe_preset, custom
 *
 * @see /supabase/migrations/20260116000000_payment_method_configuration.sql
 */

// =============================================================================
// PAYMENT CONFIG MODES
// =============================================================================

/**
 * Payment configuration mode
 * - automatic: Use Stripe Dynamic Payment Methods for Checkout Sessions
 * - stripe_preset: Use a specific Stripe Payment Method Configuration (pmc_xxx)
 * - custom: Explicit payment_method_types with manual ordering
 */
export type PaymentConfigMode = 'automatic' | 'stripe_preset' | 'custom';

// =============================================================================
// PAYMENT METHOD METADATA
// =============================================================================

/**
 * Payment method metadata for custom configuration
 */
export interface PaymentMethodMetadata {
  /** Payment method type (e.g., 'card', 'blik', 'p24') */
  type: string;

  /** Whether this payment method is enabled */
  enabled: boolean;

  /** Display order (0 = first, 1 = second, etc.) */
  display_order: number;

  /** Currency restrictions (empty array = all currencies) */
  currency_restrictions?: string[];

  /** Optional custom label for admin UI */
  label?: string;

  /** Optional icon identifier or emoji */
  icon?: string;
}

/**
 * Payment method with static metadata (for UI display)
 */
export interface PaymentMethodInfo {
  /** Payment method type */
  type: string;

  /** Display name */
  name: string;

  /** Icon (emoji or identifier) */
  icon: string;

  /** Supported currencies (* = all currencies) */
  currencies: string[];

  /** Whether this method is available in the current Stripe account */
  available?: boolean;
}

// =============================================================================
// MAIN PAYMENT CONFIG
// =============================================================================

/**
 * Global payment method configuration (singleton, id=1)
 */
export interface PaymentMethodConfig {
  /** Singleton ID (always 1) */
  id: number;

  /** Configuration mode */
  config_mode: PaymentConfigMode;

  // Stripe preset mode fields
  /** Stripe Payment Method Configuration ID (e.g., 'pmc_xxx') */
  stripe_pmc_id?: string | null;

  /** Cached Stripe PMC name (e.g., 'Default Config', 'EU Only') */
  stripe_pmc_name?: string | null;

  /** Last sync timestamp for cache invalidation */
  stripe_pmc_last_synced?: string | null;

  // Custom mode fields
  /** Custom payment methods with metadata */
  custom_payment_methods: PaymentMethodMetadata[];

  // Ordering (applies to all modes)
  /** Preferred payment method order (e.g., ['blik', 'p24', 'card']) */
  payment_method_order: string[];

  /** Currency-specific ordering overrides */
  currency_overrides: Record<string, string[]>;

  // Express checkout toggles
  /** Master toggle for Express Checkout Element */
  enable_express_checkout: boolean;

  /** Enable Apple Pay */
  enable_apple_pay: boolean;

  /** Enable Google Pay */
  enable_google_pay: boolean;

  /** Enable Stripe Link */
  enable_link: boolean;

  // Cache
  /** Cached list of Stripe PMCs (refreshed every 1 hour) */
  available_payment_methods: StripePaymentMethodConfig[];

  // Metadata
  created_at: string;
  updated_at: string;
  last_modified_by?: string | null;
}

// =============================================================================
// STRIPE API TYPES
// =============================================================================

/**
 * Stripe Payment Method Configuration from API
 * @see https://docs.stripe.com/api/payment_method_configurations
 */
export interface StripePaymentMethodConfig {
  /** PMC ID (e.g., 'pmc_xxx') */
  id: string;

  /** Display name */
  name: string;

  /** Whether this config is active */
  active: boolean;

  /** Live mode vs test mode */
  livemode: boolean;

  /** Creation timestamp */
  created: number;

  /** Parent configuration (if this is a child config) */
  parent?: string | null;

  // Payment method enablement status
  // Each payment method has an object with { enabled: boolean }
  card?: { enabled: boolean };
  blik?: { enabled: boolean };
  p24?: { enabled: boolean };
  sepa_debit?: { enabled: boolean };
  ideal?: { enabled: boolean };
  klarna?: { enabled: boolean };
  affirm?: { enabled: boolean };
  cashapp?: { enabled: boolean };
  giropay?: { enabled: boolean };
  bancontact?: { enabled: boolean };
  eps?: { enabled: boolean };
  sofort?: { enabled: boolean };
  alipay?: { enabled: boolean };
  wechat_pay?: { enabled: boolean };

  // Add more payment methods as Stripe adds them
  [key: string]: any;
}

/**
 * Result of fetching Stripe PMCs with caching
 */
export interface StripePaymentMethodConfigsResult {
  success: boolean;
  data?: StripePaymentMethodConfig[];
  cached?: boolean;
  error?: string;
}

// =============================================================================
// UPDATE INPUT TYPES
// =============================================================================

/**
 * Input for updating payment method configuration
 * Used in server actions and API routes
 */
export interface UpdatePaymentConfigInput {
  /** Configuration mode */
  config_mode: PaymentConfigMode;

  // Stripe preset mode
  stripe_pmc_id?: string | null;
  stripe_pmc_name?: string | null;

  // Custom mode
  custom_payment_methods?: PaymentMethodMetadata[];

  // Ordering
  payment_method_order?: string[];
  currency_overrides?: Record<string, string[]>;

  // Express checkout
  enable_express_checkout?: boolean;
  enable_apple_pay?: boolean;
  enable_google_pay?: boolean;
  enable_link?: boolean;

  // Metadata
  last_modified_by?: string;
}

/**
 * Partial update (for PATCH operations)
 */
export type PartialPaymentConfigUpdate = Partial<UpdatePaymentConfigInput>;

// =============================================================================
// SERVER ACTION RETURN TYPES
// =============================================================================

/**
 * Standard server action result
 */
export interface PaymentConfigActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

// =============================================================================
// EXPRESS CHECKOUT CONFIG (for frontend)
// =============================================================================

/**
 * Express Checkout configuration passed to frontend components
 * Controls visibility of Link, Apple Pay, and Google Pay buttons
 */
export interface ExpressCheckoutConfig {
  /** Master toggle for Express Checkout Element */
  enabled: boolean;

  /** Enable Apple Pay */
  applePay: boolean;

  /** Enable Google Pay */
  googlePay: boolean;

  /** Enable Stripe Link */
  link: boolean;

}

/**
 * Extract Express Checkout config from PaymentMethodConfig
 */
export function extractExpressCheckoutConfig(
  config:
    | Pick<
        PaymentMethodConfig,
        'enable_express_checkout' | 'enable_apple_pay' | 'enable_google_pay' | 'enable_link'
      >
    | null
    | undefined,
): ExpressCheckoutConfig {
  if (!config) {
    // Default: all enabled
    return {
      enabled: true,
      applePay: true,
      googlePay: true,
      link: true,
    };
  }

  return {
    enabled: config.enable_express_checkout,
    applePay: config.enable_apple_pay,
    googlePay: config.enable_google_pay,
    link: config.enable_link,
  };
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Check if a payment method is valid for a given currency
 */
export function isPaymentMethodValidForCurrency(
  method: PaymentMethodMetadata,
  currency: string
): boolean {
  if (!method.currency_restrictions || method.currency_restrictions.length === 0) {
    return true; // No restrictions = all currencies
  }
  return method.currency_restrictions.includes(currency.toUpperCase());
}

/**
 * Filter payment methods by currency
 */
export function filterPaymentMethodsByCurrency(
  methods: PaymentMethodMetadata[],
  currency: string
): PaymentMethodMetadata[] {
  return methods.filter((method) => isPaymentMethodValidForCurrency(method, currency));
}

/**
 * Get payment methods in display order
 */
export function getOrderedPaymentMethods(
  methods: PaymentMethodMetadata[]
): PaymentMethodMetadata[] {
  return [...methods].sort((a, b) => a.display_order - b.display_order);
}

/**
 * Check if Stripe PMC ID has valid format
 * Format: pmc_ + at least 5 additional characters (e.g., 'pmc_12345')
 * Real Stripe PMC IDs are typically ~30 chars but we use minimum for validation
 */
export function isValidStripePMCId(id: string | null | undefined): boolean {
  if (!id) return false;
  return id.startsWith('pmc_') && id.length >= 9; // pmc_ (4) + min 5 chars = 9
}

// =============================================================================
// FUTURE: PER-PRODUCT OVERRIDE TYPES (PHASE 2)
// =============================================================================

/**
 * Per-product payment configuration override
 * Matches global config structure but at product level
 */
export interface ProductPaymentConfigOverride {
  /** Whether override is enabled */
  override_enabled: boolean;

  /** Configuration mode (same as global) */
  config_mode: PaymentConfigMode;

  // Same fields as PaymentMethodConfig
  stripe_pmc_id?: string | null;
  stripe_pmc_name?: string | null;
  custom_payment_methods?: PaymentMethodMetadata[];
  payment_method_order?: string[];
  currency_overrides?: Record<string, string[]>;
  enable_express_checkout?: boolean;
  enable_apple_pay?: boolean;
  enable_google_pay?: boolean;
  enable_link?: boolean;
}

/**
 * Get effective payment config (product override → global → automatic)
 */
export function getEffectivePaymentConfig(
  globalConfig: PaymentMethodConfig,
  productOverride?: ProductPaymentConfigOverride | null
): PaymentMethodConfig {
  if (productOverride?.override_enabled) {
    // Use product override
    return {
      ...globalConfig,
      ...productOverride,
    };
  }

  // Use global config
  return globalConfig;
}
