import { getShopConfig, getMyShopConfig } from '@/lib/actions/shop-config'
import { getPaymentMethodConfig } from '@/lib/actions/payment-config'
import { STRIPE_CONFIG } from '@/lib/stripe/config'
import type { TaxMode } from '@/lib/actions/shop-config'
import type { PaymentConfigMode } from '@/types/payment-config'

export type ConfigSource = 'db' | 'env' | 'default'

/** @deprecated Use ConfigSource instead */
export type TaxConfigSource = ConfigSource

export interface CheckoutConfig {
  tax_mode: TaxMode
  automatic_tax: { enabled: boolean }
  tax_id_collection: { enabled: boolean }
  billing_address_collection: 'auto' | 'required'
  expires_hours: number
  collect_terms_of_service: boolean
  paymentMethodMode: PaymentConfigMode
  payment_method_types: string[]
  stripePresetId?: string | null
  sources: {
    automatic_tax: ConfigSource
    tax_id_collection: ConfigSource
    billing_address_collection: ConfigSource
    expires_hours: ConfigSource
    collect_terms: ConfigSource
    payment_methods: ConfigSource
  }
  envExists: {
    automatic_tax: boolean
    tax_id_collection: boolean
    billing_address_collection: boolean
    expires_hours: boolean
    collect_terms: boolean
    payment_methods: boolean
  }
}

/** Backwards-compatible alias */
export type CheckoutTaxConfig = Pick<CheckoutConfig, 'automatic_tax' | 'tax_id_collection'> & {
  sources: Pick<CheckoutConfig['sources'], 'automatic_tax' | 'tax_id_collection'>
}

function resolveNullable<T>(
  dbValue: T | null | undefined,
  envVar: string | undefined,
  envParsed: T,
  defaultValue: T,
): { value: T; source: ConfigSource; envExists: boolean } {
  const envExists = !!envVar
  if (dbValue !== null && dbValue !== undefined) {
    return { value: dbValue, source: 'db', envExists }
  }
  if (envVar) {
    return { value: envParsed, source: 'env', envExists }
  }
  return { value: defaultValue, source: 'default', envExists }
}

/**
 * Resolve all checkout config with priority: DB > env var > default.
 * NULL in DB means "not configured" → fall through to env var.
 *
 * @param freshShopConfig when true, bypass the public cached shop-config and
 *   read the admin's own row directly. Required from admin Settings UI so
 *   admins see the row they just wrote, not a stale 5-minute cache hit.
 */
export async function getCheckoutConfig(
  { freshShopConfig = false }: { freshShopConfig?: boolean } = {},
): Promise<CheckoutConfig> {
  const [shopConfig, pmConfig] = await Promise.all([
    freshShopConfig ? getMyShopConfig() : getShopConfig(),
    getPaymentMethodConfig(),
  ])

  // --- Tax Mode ---
  const taxModeEnv = process.env.STRIPE_TAX_MODE as TaxMode | undefined
  const taxMode = resolveNullable<TaxMode>(
    shopConfig?.tax_mode as TaxMode | null | undefined,
    taxModeEnv,
    taxModeEnv || 'local',
    'local',
  )

  // automatic_tax is derived from tax_mode (local = false, stripe_tax = true)
  // Legacy automatic_tax_enabled is ignored when tax_mode is set
  const automaticTaxEnabled = taxMode.value === 'stripe_tax'
  const taxId = resolveNullable(
    shopConfig?.tax_id_collection_enabled,
    process.env.STRIPE_SESSION_TAX_ID_COLLECTION_ENABLED,
    STRIPE_CONFIG.session.tax_id_collection.enabled,
    true,
  )

  // --- Billing address ---
  const billing = resolveNullable(
    shopConfig?.checkout_billing_address,
    process.env.STRIPE_SESSION_BILLING_ADDRESS_COLLECTION,
    STRIPE_CONFIG.session.billing_address_collection,
    'auto' as const,
  )

  // --- Expires hours ---
  const expires = resolveNullable(
    shopConfig?.checkout_expires_hours,
    process.env.STRIPE_SESSION_EXPIRES_HOURS,
    STRIPE_CONFIG.session.expires_hours,
    24,
  )

  // --- Terms of service collection ---
  const envTerms = process.env.STRIPE_COLLECT_TERMS_OF_SERVICE
  const collectTerms = resolveNullable(
    shopConfig?.checkout_collect_terms,
    envTerms,
    envTerms === 'true' || envTerms === '1',
    false,
  )

  // --- Payment methods ---
  let paymentMethodMode: PaymentConfigMode = 'automatic'
  let paymentMethodTypes: string[] = []
  let stripePresetId: string | null | undefined = undefined
  const pmEnvExists = !!process.env.STRIPE_PAYMENT_METHODS
  let pmSource: ConfigSource = pmEnvExists ? 'env' : 'default'

  if (pmEnvExists) {
    paymentMethodMode = 'custom'
    paymentMethodTypes = [...STRIPE_CONFIG.payment_method_types]
  }

  if (pmConfig) {
    paymentMethodMode = pmConfig.config_mode
    pmSource = 'db'

    if (pmConfig.config_mode === 'custom') {
      const enabledMethods = pmConfig.custom_payment_methods
        .filter((m) => m.enabled)
        .sort((a, b) => a.display_order - b.display_order)
        .map((m) => m.type)
      if (enabledMethods.length > 0) {
        paymentMethodTypes = enabledMethods
      }
    } else if (pmConfig.config_mode === 'stripe_preset') {
      stripePresetId = pmConfig.stripe_pmc_id
    }
    // 'automatic' mode — no payment_method_types needed
  }

  return {
    tax_mode: taxMode.value,
    automatic_tax: { enabled: automaticTaxEnabled },
    tax_id_collection: { enabled: taxId.value },
    billing_address_collection: billing.value as 'auto' | 'required',
    expires_hours: expires.value as number,
    collect_terms_of_service: collectTerms.value as boolean,
    paymentMethodMode,
    payment_method_types: paymentMethodTypes,
    stripePresetId,
    sources: {
      automatic_tax: taxMode.source,
      tax_id_collection: taxId.source,
      billing_address_collection: billing.source,
      expires_hours: expires.source,
      collect_terms: collectTerms.source,
      payment_methods: pmSource,
    },
    envExists: {
      automatic_tax: taxMode.envExists,
      tax_id_collection: taxId.envExists,
      billing_address_collection: billing.envExists,
      expires_hours: expires.envExists,
      collect_terms: collectTerms.envExists,
      payment_methods: pmEnvExists,
    },
  }
}

/**
 * Backwards-compatible wrapper — returns only tax config.
 * @deprecated Use getCheckoutConfig() instead.
 */
export async function getCheckoutTaxConfig(): Promise<CheckoutTaxConfig> {
  const config = await getCheckoutConfig()
  return {
    automatic_tax: config.automatic_tax,
    tax_id_collection: config.tax_id_collection,
    sources: {
      automatic_tax: config.sources.automatic_tax,
      tax_id_collection: config.sources.tax_id_collection,
    },
  }
}
