import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing
vi.mock('@/lib/actions/shop-config', () => ({
  getShopConfig: vi.fn(),
}))

vi.mock('@/lib/actions/payment-config', () => ({
  getPaymentMethodConfig: vi.fn(),
}))

vi.mock('@/lib/stripe/config', () => ({
  STRIPE_CONFIG: {
    session: {
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: 'auto',
      expires_hours: 24,
    },
    payment_method_types: ['blik', 'p24', 'card'],
  },
}))

import { getCheckoutConfig, getCheckoutTaxConfig } from '@/lib/stripe/checkout-config'
import { getShopConfig } from '@/lib/actions/shop-config'
import { getPaymentMethodConfig } from '@/lib/actions/payment-config'
import type { ConfigSource } from '@/lib/stripe/checkout-config'

const mockedGetShopConfig = vi.mocked(getShopConfig)
const mockedGetPaymentMethodConfig = vi.mocked(getPaymentMethodConfig)

const baseShopConfig = {
  id: '1',
  shop_name: 'Test',
  default_currency: 'USD',
  omnibus_enabled: false,
  custom_settings: {},
  created_at: '',
  updated_at: '',
}

describe('getCheckoutConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.STRIPE_TAX_MODE
    delete process.env.STRIPE_SESSION_AUTOMATIC_TAX_ENABLED
    delete process.env.STRIPE_SESSION_TAX_ID_COLLECTION_ENABLED
    delete process.env.STRIPE_SESSION_BILLING_ADDRESS_COLLECTION
    delete process.env.STRIPE_SESSION_EXPIRES_HOURS
    delete process.env.STRIPE_COLLECT_TERMS_OF_SERVICE
    delete process.env.STRIPE_PAYMENT_METHODS
    mockedGetPaymentMethodConfig.mockResolvedValue(null)
  })

  describe('tax mode (DB > env > default)', () => {
    it('should derive automatic_tax from tax_mode=local', async () => {
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        tax_mode: 'local',
        tax_id_collection_enabled: false,
      })

      const config = await getCheckoutConfig()
      expect(config.tax_mode).toBe('local')
      expect(config.automatic_tax.enabled).toBe(false)
      expect(config.tax_id_collection.enabled).toBe(false)
      expect(config.sources.automatic_tax).toBe('db')
      expect(config.sources.tax_id_collection).toBe('db')
    })

    it('should derive automatic_tax from tax_mode=stripe_tax', async () => {
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        tax_mode: 'stripe_tax',
      })

      const config = await getCheckoutConfig()
      expect(config.tax_mode).toBe('stripe_tax')
      expect(config.automatic_tax.enabled).toBe(true)
      expect(config.sources.automatic_tax).toBe('db')
    })

    it('should fall back to default local when DB tax_mode is null', async () => {
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        tax_id_collection_enabled: null,
      })

      const config = await getCheckoutConfig()
      expect(config.tax_mode).toBe('local')
      expect(config.automatic_tax.enabled).toBe(false)
      expect(config.sources.automatic_tax).toBe('default')
    })
  })

  describe('billing address (DB > env > default)', () => {
    it('should use DB value when set', async () => {
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        checkout_billing_address: 'required',
      })

      const config = await getCheckoutConfig()
      expect(config.billing_address_collection).toBe('required')
      expect(config.sources.billing_address_collection).toBe('db')
    })

    it('should use env var when DB is null', async () => {
      process.env.STRIPE_SESSION_BILLING_ADDRESS_COLLECTION = 'required'
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        checkout_billing_address: null,
      })

      const config = await getCheckoutConfig()
      expect(config.sources.billing_address_collection).toBe('env')
    })

    it('should use default (auto) when no DB or env', async () => {
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        checkout_billing_address: null,
      })

      const config = await getCheckoutConfig()
      expect(config.billing_address_collection).toBe('auto')
      expect(config.sources.billing_address_collection).toBe('default')
    })
  })

  describe('expires hours (DB > env > default)', () => {
    it('should use DB value when set', async () => {
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        checkout_expires_hours: 48,
      })

      const config = await getCheckoutConfig()
      expect(config.expires_hours).toBe(48)
      expect(config.sources.expires_hours).toBe('db')
    })

    it('should use env var when DB is null', async () => {
      process.env.STRIPE_SESSION_EXPIRES_HOURS = '12'
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        checkout_expires_hours: null,
      })

      const config = await getCheckoutConfig()
      expect(config.sources.expires_hours).toBe('env')
    })

    it('should use default (24) when no DB or env', async () => {
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        checkout_expires_hours: null,
      })

      const config = await getCheckoutConfig()
      expect(config.expires_hours).toBe(24)
      expect(config.sources.expires_hours).toBe('default')
    })
  })

  describe('collect terms of service (DB > env > default)', () => {
    it('should use DB value when set to true', async () => {
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        checkout_collect_terms: true,
      })

      const config = await getCheckoutConfig()
      expect(config.collect_terms_of_service).toBe(true)
      expect(config.sources.collect_terms).toBe('db')
    })

    it('should use DB value when set to false', async () => {
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        checkout_collect_terms: false,
      })

      const config = await getCheckoutConfig()
      expect(config.collect_terms_of_service).toBe(false)
      expect(config.sources.collect_terms).toBe('db')
    })

    it('should use env var when DB is null', async () => {
      process.env.STRIPE_COLLECT_TERMS_OF_SERVICE = 'true'
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        checkout_collect_terms: null,
      })

      const config = await getCheckoutConfig()
      expect(config.collect_terms_of_service).toBe(true)
      expect(config.sources.collect_terms).toBe('env')
    })

    it('should use default (false) when no DB or env', async () => {
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        checkout_collect_terms: null,
      })

      const config = await getCheckoutConfig()
      expect(config.collect_terms_of_service).toBe(false)
      expect(config.sources.collect_terms).toBe('default')
    })
  })

  describe('payment methods', () => {
    it('should use custom methods from DB when mode is custom', async () => {
      mockedGetShopConfig.mockResolvedValue(baseShopConfig)
      mockedGetPaymentMethodConfig.mockResolvedValue({
        id: 1,
        config_mode: 'custom',
        custom_payment_methods: [
          { type: 'card', enabled: true, display_order: 0 },
          { type: 'blik', enabled: true, display_order: 1 },
          { type: 'p24', enabled: false, display_order: 2 },
        ],
        payment_method_order: [],
        currency_overrides: {},
        enable_express_checkout: false,
        enable_apple_pay: false,
        enable_google_pay: false,
        enable_link: false,
      })

      const config = await getCheckoutConfig()
      expect(config.payment_method_types).toEqual(['card', 'blik'])
      expect(config.paymentMethodMode).toBe('custom')
      expect(config.sources.payment_methods).toBe('db')
    })

    it('should set automatic mode when config_mode is automatic', async () => {
      mockedGetShopConfig.mockResolvedValue(baseShopConfig)
      mockedGetPaymentMethodConfig.mockResolvedValue({
        id: 1,
        config_mode: 'automatic',
        custom_payment_methods: [],
        payment_method_order: [],
        currency_overrides: {},
        enable_express_checkout: false,
        enable_apple_pay: false,
        enable_google_pay: false,
        enable_link: false,
      })

      const config = await getCheckoutConfig()
      expect(config.paymentMethodMode).toBe('automatic')
      expect(config.sources.payment_methods).toBe('db')
    })

    it('should set stripe_preset mode with PMC ID', async () => {
      mockedGetShopConfig.mockResolvedValue(baseShopConfig)
      mockedGetPaymentMethodConfig.mockResolvedValue({
        id: 1,
        config_mode: 'stripe_preset',
        stripe_pmc_id: 'pmc_123',
        custom_payment_methods: [],
        payment_method_order: [],
        currency_overrides: {},
        enable_express_checkout: false,
        enable_apple_pay: false,
        enable_google_pay: false,
        enable_link: false,
      })

      const config = await getCheckoutConfig()
      expect(config.paymentMethodMode).toBe('stripe_preset')
      expect(config.stripePresetId).toBe('pmc_123')
      expect(config.sources.payment_methods).toBe('db')
    })

    it('should fallback to Stripe dynamic payment methods when no payment config or env override exists', async () => {
      mockedGetShopConfig.mockResolvedValue(baseShopConfig)
      mockedGetPaymentMethodConfig.mockResolvedValue(null)

      const config = await getCheckoutConfig()
      expect(config.paymentMethodMode).toBe('automatic')
      expect(config.payment_method_types).toEqual([])
      expect(config.sources.payment_methods).toBe('default')
    })
  })

  describe('handles missing shop config', () => {
    it('should use defaults when getShopConfig returns null', async () => {
      mockedGetShopConfig.mockResolvedValue(null)

      const config = await getCheckoutConfig()
      expect(config.tax_mode).toBe('local')
      expect(config.automatic_tax.enabled).toBe(false)
      expect(config.billing_address_collection).toBe('auto')
      expect(config.expires_hours).toBe(24)
      expect(config.collect_terms_of_service).toBe(false)
    })
  })

  describe('independent field resolution', () => {
    it('should resolve each field independently', async () => {
      process.env.STRIPE_SESSION_EXPIRES_HOURS = '12'

      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        tax_mode: 'local',
        checkout_billing_address: 'required',
        checkout_expires_hours: null,
      })

      const config = await getCheckoutConfig()
      expect(config.automatic_tax.enabled).toBe(false)
      expect(config.sources.automatic_tax).toBe('db')
      expect(config.billing_address_collection).toBe('required')
      expect(config.sources.billing_address_collection).toBe('db')
      expect(config.sources.expires_hours).toBe('env')
    })
  })

  describe('backwards compatibility', () => {
    it('getCheckoutTaxConfig should return only tax fields', async () => {
      mockedGetShopConfig.mockResolvedValue({
        ...baseShopConfig,
        tax_mode: 'stripe_tax',
        tax_id_collection_enabled: false,
      })

      const config = await getCheckoutTaxConfig()
      expect(config.automatic_tax.enabled).toBe(true)
      expect(config.tax_id_collection.enabled).toBe(false)
      expect(config.sources.automatic_tax).toBe('db')
      expect(config.sources.tax_id_collection).toBe('db')
      // Should NOT have billing/expires/payment fields
      expect('billing_address_collection' in config).toBe(false)
      expect('expires_hours' in config).toBe(false)
    })
  })

  describe('source type coverage', () => {
    it('should have all three source values', () => {
      const sources: ConfigSource[] = ['db', 'env', 'default']
      expect(sources).toHaveLength(3)
      expect(new Set(sources).size).toBe(3)
    })
  })
})
