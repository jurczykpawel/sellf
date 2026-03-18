/**
 * Payment Method Configuration Server Actions
 *
 * Server-side actions for managing global payment method configuration.
 * Includes CRUD operations, validation, and Stripe PMC caching.
 *
 * @see /supabase/migrations/20260116000000_payment_method_configuration.sql
 * @see /admin-panel/src/types/payment-config.ts
 */

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isDemoMode, DEMO_MODE_ERROR } from '@/lib/demo-guard';
import { withAdminOrSellerAuth } from '@/lib/actions/admin-auth';
import {
  fetchStripePaymentMethodConfigs,
  fetchStripePaymentMethodConfig,
  isValidStripePMCId as validateStripePMCId,
} from '@/lib/stripe/payment-method-configs';
import type {
  PaymentMethodConfig,
  UpdatePaymentConfigInput,
  PaymentConfigActionResult,
  StripePaymentMethodConfigsResult,
  PaymentMethodMetadata,
} from '@/types/payment-config';
import { RECOMMENDED_CONFIG } from '@/lib/utils/payment-method-helpers';

// =============================================================================
// CONSTANTS
// =============================================================================

const CACHE_TTL_HOURS = 1; // Refresh Stripe PMC cache every hour

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

/**
 * Zod schema for payment method metadata
 */
const PaymentMethodMetadataSchema = z.object({
  type: z.string().min(1, 'Payment method type is required'),
  enabled: z.boolean(),
  display_order: z.number().int().min(0, 'Display order must be non-negative'),
  currency_restrictions: z.array(z.string().length(3)).optional(),
  label: z.string().optional(),
  icon: z.string().optional(),
});

/**
 * Zod schema for updating payment config
 */
const UpdatePaymentConfigSchema = z.object({
  config_mode: z.enum(['automatic', 'stripe_preset', 'custom']),

  // Stripe preset mode
  stripe_pmc_id: z
    .string()
    .nullable()
    .refine(
      (val) => {
        if (!val) return true; // Allow null
        return validateStripePMCId(val);
      },
      { message: 'Invalid Stripe PMC ID format (must start with pmc_)' }
    )
    .optional(),
  stripe_pmc_name: z.string().nullable().optional(),

  // Custom mode
  custom_payment_methods: z.array(PaymentMethodMetadataSchema).optional(),

  // Ordering
  payment_method_order: z.array(z.string()).optional(),
  currency_overrides: z.record(z.string(), z.array(z.string())).optional(),

  // Express checkout
  enable_express_checkout: z.boolean().optional(),
  enable_apple_pay: z.boolean().optional(),
  enable_google_pay: z.boolean().optional(),
  enable_link: z.boolean().optional(),

  // Metadata
  last_modified_by: z.string().optional(),
}).refine(
  (data) => {
    // If stripe_preset mode, stripe_pmc_id must be provided
    if (data.config_mode === 'stripe_preset') {
      return !!data.stripe_pmc_id && validateStripePMCId(data.stripe_pmc_id);
    }
    return true;
  },
  {
    message: 'stripe_pmc_id is required for stripe_preset mode',
    path: ['stripe_pmc_id'],
  }
).refine(
  (data) => {
    // If custom mode, need at least one enabled payment method OR express checkout
    if (data.config_mode === 'custom') {
      const hasCustomMethods = data.custom_payment_methods?.some((pm) => pm.enabled);
      const hasExpressMethod = data.enable_express_checkout && (data.enable_link || data.enable_apple_pay || data.enable_google_pay);
      return hasCustomMethods || hasExpressMethod;
    }
    return true;
  },
  {
    message: 'At least one payment method or express checkout option must be enabled in custom mode',
    path: ['custom_payment_methods'],
  }
);

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * Get the global payment method configuration
 *
 * @returns Payment config or null if not found
 */
export async function getPaymentMethodConfig(): Promise<PaymentMethodConfig | null> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('payment_method_config')
      .select('*')
      .eq('id', 1)
      .single();

    if (error) {
      console.error('[getPaymentMethodConfig] Error:', error);
      return null;
    }

    return data as PaymentMethodConfig;
  } catch (error) {
    console.error('[getPaymentMethodConfig] Exception:', error);
    return null;
  }
}

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * Update the global payment method configuration
 *
 * @param input - Updated config values
 * @returns Action result with success status
 */
export async function updatePaymentMethodConfig(
  input: UpdatePaymentConfigInput
): Promise<PaymentConfigActionResult<PaymentMethodConfig>> {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' }

  return withAdminOrSellerAuth(async ({ dataClient }) => {
    // Validate input
    const validation = UpdatePaymentConfigSchema.safeParse(input);
    if (!validation.success) {
      const errorMessage = validation.error.issues.map(e => e.message).join(', ');
      return {
        success: false,
        error: errorMessage,
        errorCode: 'VALIDATION_ERROR',
      };
    }

    const validatedInput = validation.data;

    // If stripe_preset mode, verify PMC exists via Stripe API
    if (validatedInput.config_mode === 'stripe_preset' && validatedInput.stripe_pmc_id) {
      const pmcResult = await fetchStripePaymentMethodConfig(validatedInput.stripe_pmc_id);
      if (!pmcResult.success) {
        return {
          success: false,
          error: `Failed to verify Stripe PMC: ${pmcResult.error}`,
          errorCode: 'STRIPE_PMC_NOT_FOUND',
        };
      }

      // Update PMC name from Stripe if not provided
      if (!validatedInput.stripe_pmc_name && pmcResult.data) {
        validatedInput.stripe_pmc_name = pmcResult.data.name;
      }
    }

    // Build update object
    const updateData: Record<string, any> = {
      config_mode: validatedInput.config_mode,
    };

    // Stripe preset mode fields
    if (validatedInput.config_mode === 'stripe_preset') {
      updateData.stripe_pmc_id = validatedInput.stripe_pmc_id;
      updateData.stripe_pmc_name = validatedInput.stripe_pmc_name;
      // Clear custom_payment_methods when switching to stripe_preset
      updateData.custom_payment_methods = [];
    } else {
      updateData.stripe_pmc_id = null;
      updateData.stripe_pmc_name = null;
    }

    // Custom mode fields
    if (validatedInput.config_mode === 'custom' && validatedInput.custom_payment_methods) {
      updateData.custom_payment_methods = validatedInput.custom_payment_methods;
    } else if (validatedInput.config_mode !== 'custom') {
      updateData.custom_payment_methods = [];
    }

    // Ordering
    if (validatedInput.payment_method_order !== undefined) {
      updateData.payment_method_order = validatedInput.payment_method_order;
    }

    if (validatedInput.currency_overrides !== undefined) {
      updateData.currency_overrides = validatedInput.currency_overrides;
    }

    // Express checkout
    if (validatedInput.enable_express_checkout !== undefined) {
      updateData.enable_express_checkout = validatedInput.enable_express_checkout;
    }
    if (validatedInput.enable_apple_pay !== undefined) {
      updateData.enable_apple_pay = validatedInput.enable_apple_pay;
    }
    if (validatedInput.enable_google_pay !== undefined) {
      updateData.enable_google_pay = validatedInput.enable_google_pay;
    }
    if (validatedInput.enable_link !== undefined) {
      updateData.enable_link = validatedInput.enable_link;
    }
    // Metadata
    if (validatedInput.last_modified_by) {
      updateData.last_modified_by = validatedInput.last_modified_by;
    }

    // Update database
    const { data, error } = await dataClient
      .from('payment_method_config')
      .update(updateData)
      .eq('id', 1)
      .select()
      .single();

    if (error) {
      console.error('[updatePaymentMethodConfig] Database error:', error);
      return {
        success: false,
        error: 'Failed to update configuration',
        errorCode: 'DATABASE_ERROR',
      };
    }

    // Revalidate settings page
    revalidatePath('/dashboard/settings');

    // Revalidate checkout pages (in case config affects frontend)
    revalidatePath('/checkout/[slug]', 'page');

    return {
      success: true,
      data: data as unknown as PaymentMethodConfig,
    };
  });
}

// =============================================================================
// STRIPE PMC CACHING
// =============================================================================

/**
 * Get Stripe Payment Method Configurations with caching
 * Caches results in payment_method_config.available_payment_methods
 * TTL: 1 hour
 *
 * @param forceRefresh - Force cache invalidation
 * @returns Stripe PMCs with cache status
 */
export async function getStripePaymentMethodConfigsCached(
  forceRefresh = false
): Promise<StripePaymentMethodConfigsResult> {
  try {
    const supabase = await createClient();

    // Get current cache
    const { data: config } = await supabase
      .from('payment_method_config')
      .select('stripe_pmc_last_synced, available_payment_methods')
      .eq('id', 1)
      .single();

    if (!config) {
      return {
        success: false,
        error: 'Payment method config not found',
      };
    }

    const now = new Date();
    const lastSync = config.stripe_pmc_last_synced
      ? new Date(config.stripe_pmc_last_synced)
      : null;

    // Check if cache is fresh (within TTL)
    const cacheAge = lastSync ? now.getTime() - lastSync.getTime() : Infinity;
    const cacheTTL = CACHE_TTL_HOURS * 60 * 60 * 1000; // Convert hours to milliseconds
    const isCacheFresh = !forceRefresh && lastSync && cacheAge < cacheTTL;

    if (isCacheFresh && config.available_payment_methods) {
      return {
        success: true,
        data: config.available_payment_methods,
        cached: true,
      };
    }

    // Fetch fresh data from Stripe
    const result = await fetchStripePaymentMethodConfigs();

    if (result.success && result.data) {
      // Update cache
      await supabase
        .from('payment_method_config')
        .update({
          available_payment_methods: result.data,
          stripe_pmc_last_synced: now.toISOString(),
        })
        .eq('id', 1);

      return {
        success: true,
        data: result.data,
        cached: false,
      };
    }

    // Return stale cache if API fails
    if (config.available_payment_methods) {
      return {
        success: true,
        data: config.available_payment_methods,
        cached: true,
        error: result.error,
      };
    }

    return {
      success: false,
      error: result.error || 'Failed to fetch Stripe PMCs',
    };
  } catch (error) {
    console.error('[getStripePaymentMethodConfigsCached] Exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Force refresh Stripe Payment Method Configurations cache
 *
 * @returns Action result with success status
 */
export async function refreshStripePaymentMethodConfigs(): Promise<
  PaymentConfigActionResult<void>
> {
  return withAdminOrSellerAuth(async () => {
    const result = await getStripePaymentMethodConfigsCached(true);

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Failed to refresh Stripe PMCs',
        errorCode: 'STRIPE_API_ERROR',
      };
    }

    return {
      success: true,
    };
  });
}

// =============================================================================
// RECOMMENDED CONFIGURATION
// =============================================================================

// NOTE: RECOMMENDED_CONFIG constant is defined in @/lib/utils/payment-method-helpers
// It cannot be exported from a 'use server' file as it's not an async function.

/**
 * Reset payment method configuration to recommended defaults
 *
 * @returns Promise with success status
 */
export async function resetToRecommendedConfig(): Promise<PaymentConfigActionResult<PaymentMethodConfig>> {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' }

  return withAdminOrSellerAuth(async ({ dataClient }) => {
    const { data, error } = await dataClient
      .from('payment_method_config')
      .update({
        ...RECOMMENDED_CONFIG,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
      .select()
      .single();

    if (error) {
      console.error('[resetToRecommendedConfig] Database error:', error);
      return {
        success: false,
        error: `Database error: ${error.message}`,
        errorCode: 'DATABASE_ERROR',
      };
    }

    // Revalidate the settings page
    revalidatePath('/dashboard/settings');
    revalidatePath('/[locale]/dashboard/settings');

    return {
      success: true,
      data: data as unknown as PaymentMethodConfig,
    };
  });
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// NOTE: Pure utility functions for payment method configuration are now in:
// @/lib/utils/payment-method-helpers
// Import getEffectivePaymentMethodOrder and getEnabledPaymentMethodsForCurrency from there.
