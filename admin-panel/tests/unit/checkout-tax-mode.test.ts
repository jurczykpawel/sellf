import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies before importing
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripeServer: vi.fn(),
}))

vi.mock('@/lib/services/product-validation', () => ({
  ProductValidationService: vi.fn(),
}))

vi.mock('@/lib/stripe/checkout-config', () => ({
  getCheckoutConfig: vi.fn(),
}))

vi.mock('@/lib/stripe/tax-rate-manager', () => ({
  getOrCreateStripeTaxRate: vi.fn(),
}))

vi.mock('@/lib/stripe/config', () => ({
  STRIPE_CONFIG: {
    rate_limit: { action_type: 'checkout', max_requests: 10, window_minutes: 5 },
    session: {
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: 'auto',
      expires_hours: 24,
    },
    payment_method_types: ['card'],
  },
  CHECKOUT_ERRORS: {
    PRODUCT_ID_REQUIRED: 'Product ID required',
    PRODUCT_NOT_FOUND: 'Not found',
    INVALID_PRICE: 'Invalid price',
    RATE_LIMIT_EXCEEDED: 'Rate limit',
    STRIPE_SESSION_FAILED: 'Session failed',
    DUPLICATE_ACCESS: 'Duplicate',
  },
  HTTP_STATUS: {
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
  },
}))

vi.mock('@/lib/logger', () => ({
  sanitizeForLog: vi.fn((s: string) => s),
}))

import { CheckoutService } from '@/lib/services/checkout'
import { getCheckoutConfig } from '@/lib/stripe/checkout-config'
import { getOrCreateStripeTaxRate } from '@/lib/stripe/tax-rate-manager'
import type { CheckoutConfig } from '@/lib/stripe/checkout-config'
import type { ProductForCheckout, CheckoutSessionOptions } from '@/types/checkout'

const mockedGetCheckoutConfig = vi.mocked(getCheckoutConfig)
const mockedGetOrCreateStripeTaxRate = vi.mocked(getOrCreateStripeTaxRate)

// Base checkout config for overriding
const baseCheckoutConfig: CheckoutConfig = {
  tax_mode: 'local',
  automatic_tax: { enabled: false },
  tax_id_collection: { enabled: false },
  billing_address_collection: 'auto',
  expires_hours: 24,
  collect_terms_of_service: false,
  paymentMethodMode: 'custom',
  payment_method_types: ['card'],
  sources: {
    automatic_tax: 'default',
    tax_id_collection: 'default',
    billing_address_collection: 'default',
    expires_hours: 'default',
    collect_terms: 'default',
    payment_methods: 'default',
  },
  envExists: {
    automatic_tax: false,
    tax_id_collection: false,
    billing_address_collection: false,
    expires_hours: false,
    collect_terms: false,
    payment_methods: false,
  },
}

const baseProduct: ProductForCheckout = {
  id: 'prod_1',
  slug: 'test-product',
  name: 'Test Product',
  description: 'A test product',
  price: 100,
  currency: 'PLN',
  is_active: true,
  available_from: null,
  available_until: null,
  vat_rate: 23,
  price_includes_vat: true,
}

describe('CheckoutService.createStripeSession — tax mode', () => {
  let service: CheckoutService
  let mockStripeCreate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    mockStripeCreate = vi.fn().mockResolvedValue({
      id: 'cs_test_123',
      client_secret: 'cs_secret_123',
    })

    service = new CheckoutService()
    // Inject mock stripe directly
    ;(service as any).stripe = {
      checkout: { sessions: { create: mockStripeCreate } },
    }
  })

  const buildOptions = (overrides: Partial<CheckoutSessionOptions> = {}): CheckoutSessionOptions => ({
    product: baseProduct,
    returnUrl: 'http://localhost:3000/payment/success',
    ...overrides,
  })

  const buildBumpProduct = (id: string, price: number): ProductForCheckout => ({
    ...baseProduct,
    id,
    name: `Bump ${id}`,
    price,
    vat_rate: null,
  })

  describe('local tax mode', () => {
    it('should attach tax_rates to line item when product has vat_rate', async () => {
      mockedGetCheckoutConfig.mockResolvedValue({
        ...baseCheckoutConfig,
        tax_mode: 'local',
        automatic_tax: { enabled: false },
      })
      mockedGetOrCreateStripeTaxRate.mockResolvedValue('txr_23_incl')

      await service.createStripeSession(buildOptions())

      expect(mockedGetOrCreateStripeTaxRate).toHaveBeenCalledWith({
        percentage: 23,
        inclusive: true,
      })

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.line_items[0].tax_rates).toEqual(['txr_23_incl'])
      expect(sessionArg.line_items[0].price_data.tax_behavior).toBe('inclusive')
      expect(sessionArg.automatic_tax).toEqual({ enabled: false })
    })

    it('should set tax_behavior to exclusive when price_includes_vat is false', async () => {
      mockedGetCheckoutConfig.mockResolvedValue({
        ...baseCheckoutConfig,
        tax_mode: 'local',
        automatic_tax: { enabled: false },
      })
      mockedGetOrCreateStripeTaxRate.mockResolvedValue('txr_23_excl')

      const product = { ...baseProduct, price_includes_vat: false }
      await service.createStripeSession(buildOptions({ product }))

      expect(mockedGetOrCreateStripeTaxRate).toHaveBeenCalledWith({
        percentage: 23,
        inclusive: false,
      })

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.line_items[0].tax_rates).toEqual(['txr_23_excl'])
      expect(sessionArg.line_items[0].price_data.tax_behavior).toBe('exclusive')
    })

    it('should not attach tax_rates when vat_rate is null', async () => {
      mockedGetCheckoutConfig.mockResolvedValue({
        ...baseCheckoutConfig,
        tax_mode: 'local',
        automatic_tax: { enabled: false },
      })

      const product = { ...baseProduct, vat_rate: null }
      await service.createStripeSession(buildOptions({ product }))

      expect(mockedGetOrCreateStripeTaxRate).not.toHaveBeenCalled()

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.line_items[0].tax_rates).toBeUndefined()
      expect(sessionArg.line_items[0].price_data.tax_behavior).toBeUndefined()
    })

    it('should not attach tax_rates when vat_rate is 0', async () => {
      mockedGetCheckoutConfig.mockResolvedValue({
        ...baseCheckoutConfig,
        tax_mode: 'local',
        automatic_tax: { enabled: false },
      })

      const product = { ...baseProduct, vat_rate: 0 }
      await service.createStripeSession(buildOptions({ product }))

      expect(mockedGetOrCreateStripeTaxRate).not.toHaveBeenCalled()

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.line_items[0].tax_rates).toBeUndefined()
    })

    it('should handle bump product with its own vat_rate', async () => {
      mockedGetCheckoutConfig.mockResolvedValue({
        ...baseCheckoutConfig,
        tax_mode: 'local',
        automatic_tax: { enabled: false },
      })
      mockedGetOrCreateStripeTaxRate
        .mockResolvedValueOnce('txr_23_incl') // main product
        .mockResolvedValueOnce('txr_8_excl')  // bump product

      const bumpProduct: ProductForCheckout = {
        ...baseProduct,
        id: 'prod_bump',
        name: 'Bump Product',
        price: 20,
        vat_rate: 8,
        price_includes_vat: false,
      }

      await service.createStripeSession(buildOptions({ bumpProduct }))

      expect(mockedGetOrCreateStripeTaxRate).toHaveBeenCalledTimes(2)
      expect(mockedGetOrCreateStripeTaxRate).toHaveBeenCalledWith({
        percentage: 23,
        inclusive: true,
      })
      expect(mockedGetOrCreateStripeTaxRate).toHaveBeenCalledWith({
        percentage: 8,
        inclusive: false,
      })

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      // Main product line item
      expect(sessionArg.line_items[0].tax_rates).toEqual(['txr_23_incl'])
      expect(sessionArg.line_items[0].price_data.tax_behavior).toBe('inclusive')
      // Bump product line item
      expect(sessionArg.line_items[1].tax_rates).toEqual(['txr_8_excl'])
      expect(sessionArg.line_items[1].price_data.tax_behavior).toBe('exclusive')
    })

    it('should handle bump product with no vat_rate', async () => {
      mockedGetCheckoutConfig.mockResolvedValue({
        ...baseCheckoutConfig,
        tax_mode: 'local',
        automatic_tax: { enabled: false },
      })
      mockedGetOrCreateStripeTaxRate.mockResolvedValue('txr_23_incl')

      const bumpProduct: ProductForCheckout = {
        ...baseProduct,
        id: 'prod_bump',
        name: 'Bump Product',
        price: 20,
        vat_rate: null,
        price_includes_vat: true,
      }

      await service.createStripeSession(buildOptions({ bumpProduct }))

      // Only called once for main product
      expect(mockedGetOrCreateStripeTaxRate).toHaveBeenCalledTimes(1)

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.line_items[1].tax_rates).toBeUndefined()
      expect(sessionArg.line_items[1].price_data.tax_behavior).toBeUndefined()
    })
  })

  describe('stripe_tax mode', () => {
    it('should use automatic_tax and NOT attach tax_rates', async () => {
      mockedGetCheckoutConfig.mockResolvedValue({
        ...baseCheckoutConfig,
        tax_mode: 'stripe_tax',
        automatic_tax: { enabled: true },
      })

      await service.createStripeSession(buildOptions())

      expect(mockedGetOrCreateStripeTaxRate).not.toHaveBeenCalled()

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.automatic_tax).toEqual({ enabled: true })
      expect(sessionArg.line_items[0].tax_rates).toBeUndefined()
      // tax_behavior is set in stripe_tax mode for automatic tax to work
      expect(sessionArg.line_items[0].price_data.tax_behavior).toBe('inclusive')
    })

    it('should set tax_behavior to exclusive in stripe_tax mode when price_includes_vat is false', async () => {
      mockedGetCheckoutConfig.mockResolvedValue({
        ...baseCheckoutConfig,
        tax_mode: 'stripe_tax',
        automatic_tax: { enabled: true },
      })

      const product = { ...baseProduct, price_includes_vat: false }
      await service.createStripeSession(buildOptions({ product }))

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.line_items[0].price_data.tax_behavior).toBe('exclusive')
      expect(sessionArg.line_items[0].tax_rates).toBeUndefined()
    })

    it('should not create tax rates for bump product in stripe_tax mode', async () => {
      mockedGetCheckoutConfig.mockResolvedValue({
        ...baseCheckoutConfig,
        tax_mode: 'stripe_tax',
        automatic_tax: { enabled: true },
      })

      const bumpProduct: ProductForCheckout = {
        ...baseProduct,
        id: 'prod_bump',
        name: 'Bump Product',
        price: 20,
        vat_rate: 8,
        price_includes_vat: false,
      }

      await service.createStripeSession(buildOptions({ bumpProduct }))

      expect(mockedGetOrCreateStripeTaxRate).not.toHaveBeenCalled()

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.line_items[0].tax_rates).toBeUndefined()
      expect(sessionArg.line_items[1].tax_rates).toBeUndefined()
      expect(sessionArg.line_items[1].price_data.tax_behavior).toBe('exclusive')
    })
  })

  describe('coupon pricing in embedded checkout', () => {
    beforeEach(() => {
      mockedGetCheckoutConfig.mockResolvedValue({
        ...baseCheckoutConfig,
        tax_mode: 'local',
        automatic_tax: { enabled: false },
      })
    })

    it('should apply global percentage coupon to main product and all bumps when exclude_order_bumps is false', async () => {
      await service.createStripeSession(buildOptions({
        bumpProducts: [
          buildBumpProduct('bump_1', 20),
          buildBumpProduct('bump_2', 30),
        ],
        coupon: {
          id: 'coupon_1',
          code: 'SAVE20',
          discount_type: 'percentage',
          discount_value: 20,
          exclude_order_bumps: false,
          allowed_product_ids: [],
        },
      }))

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.line_items[0].price_data.unit_amount).toBe(8000)
      expect(sessionArg.line_items[1].price_data.unit_amount).toBe(1600)
      expect(sessionArg.line_items[2].price_data.unit_amount).toBe(2400)
    })

    it('should apply global percentage coupon only to main product when exclude_order_bumps is true', async () => {
      await service.createStripeSession(buildOptions({
        bumpProducts: [
          buildBumpProduct('bump_1', 20),
          buildBumpProduct('bump_2', 30),
        ],
        coupon: {
          id: 'coupon_2',
          code: 'SAVE20MAIN',
          discount_type: 'percentage',
          discount_value: 20,
          exclude_order_bumps: true,
          allowed_product_ids: [],
        },
      }))

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.line_items[0].price_data.unit_amount).toBe(8000)
      expect(sessionArg.line_items[1].price_data.unit_amount).toBe(2000)
      expect(sessionArg.line_items[2].price_data.unit_amount).toBe(3000)
    })

    it('should distribute global fixed coupon across eligible main and bump items when exclude_order_bumps is false', async () => {
      await service.createStripeSession(buildOptions({
        bumpProducts: [
          buildBumpProduct('bump_1', 20),
          buildBumpProduct('bump_2', 30),
        ],
        coupon: {
          id: 'coupon_3',
          code: 'FLAT40',
          discount_type: 'fixed',
          discount_value: 40,
          exclude_order_bumps: false,
          allowed_product_ids: [],
        },
      }))

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.line_items[0].price_data.unit_amount).toBe(7333)
      expect(sessionArg.line_items[1].price_data.unit_amount).toBe(1467)
      expect(sessionArg.line_items[2].price_data.unit_amount).toBe(2200)
    })

    it('should not discount bumps for product-scoped coupon unless bump ids are explicitly allowed', async () => {
      await service.createStripeSession(buildOptions({
        bumpProducts: [
          buildBumpProduct('bump_1', 20),
          buildBumpProduct('bump_2', 30),
        ],
        coupon: {
          id: 'coupon_4',
          code: 'COURSE10',
          discount_type: 'percentage',
          discount_value: 10,
          exclude_order_bumps: false,
          allowed_product_ids: ['prod_1'],
        },
      }))

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.line_items[0].price_data.unit_amount).toBe(9000)
      expect(sessionArg.line_items[1].price_data.unit_amount).toBe(2000)
      expect(sessionArg.line_items[2].price_data.unit_amount).toBe(3000)
    })

    it('should never discount bumps for a product-scoped coupon even if bump ids are listed', async () => {
      await service.createStripeSession(buildOptions({
        bumpProducts: [
          buildBumpProduct('bump_1', 20),
          buildBumpProduct('bump_2', 30),
        ],
        coupon: {
          id: 'coupon_5',
          code: 'COURSE10PLUS',
          discount_type: 'percentage',
          discount_value: 10,
          exclude_order_bumps: false,
          allowed_product_ids: ['prod_1', 'bump_1'],
        },
      }))

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.line_items[0].price_data.unit_amount).toBe(9000)
      expect(sessionArg.line_items[1].price_data.unit_amount).toBe(2000)
      expect(sessionArg.line_items[2].price_data.unit_amount).toBe(3000)
    })

    it('should enforce Stripe minimum charge after fixed coupon across multiple items', async () => {
      const product = { ...baseProduct, price: 0.4, currency: 'USD' }

      await service.createStripeSession(buildOptions({
        product,
        bumpProducts: [buildBumpProduct('bump_1', 0.4)],
        coupon: {
          id: 'coupon_6',
          code: 'FLAT40CENTS',
          discount_type: 'fixed',
          discount_value: 0.4,
          exclude_order_bumps: false,
          allowed_product_ids: [],
        },
      }))

      const sessionArg = mockStripeCreate.mock.calls[0][0]
      expect(sessionArg.line_items[0].price_data.unit_amount).toBe(30)
      expect(sessionArg.line_items[1].price_data.unit_amount).toBe(20)
    })
  })
})
