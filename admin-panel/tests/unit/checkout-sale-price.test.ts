import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies before importing (mirrors checkout-tax-mode.test.ts)
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
import type { CheckoutConfig } from '@/lib/stripe/checkout-config'
import type { ProductForCheckout, CheckoutSessionOptions } from '@/types/checkout'

const mockedGetCheckoutConfig = vi.mocked(getCheckoutConfig)

const baseCheckoutConfig: CheckoutConfig = {
  tax_mode: 'stripe_tax',
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
  id: 'prod_sale',
  slug: 'poststack-pro',
  name: 'PostStack PRO',
  description: 'Annual PRO license',
  price: 499,
  currency: 'PLN',
  is_active: true,
  available_from: null,
  available_until: null,
  vat_rate: null,
  price_includes_vat: false,
  product_type: 'one_time',
  billing_interval: null,
  billing_interval_count: null,
  recurring_price: null,
  trial_days: null,
  stripe_price_id: null,
}

describe('CheckoutService.createStripeSession — sale price', () => {
  let service: CheckoutService
  let mockStripeCreate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockStripeCreate = vi.fn().mockResolvedValue({
      id: 'cs_test_123',
      client_secret: 'cs_secret_123',
    })
    service = new CheckoutService()
    ;(service as any).stripe = {
      checkout: { sessions: { create: mockStripeCreate } },
    }
    mockedGetCheckoutConfig.mockResolvedValue(baseCheckoutConfig)
  })

  const buildOptions = (overrides: Partial<CheckoutSessionOptions> = {}): CheckoutSessionOptions => ({
    product: baseProduct,
    returnUrl: 'http://localhost:3000/payment/success',
    ...overrides,
  })

  const unitAmount = () =>
    (mockStripeCreate.mock.calls[0][0].line_items[0].price_data as { unit_amount: number }).unit_amount

  it('charges the active sale price, not the regular price', async () => {
    const product: ProductForCheckout = { ...baseProduct, sale_price: 349, sale_price_until: null }
    await service.createStripeSession(buildOptions({ product }))
    expect(unitAmount()).toBe(34900)
  })

  it('charges the regular price when the sale has expired', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const product: ProductForCheckout = { ...baseProduct, sale_price: 349, sale_price_until: past }
    await service.createStripeSession(buildOptions({ product }))
    expect(unitAmount()).toBe(49900)
  })

  it('charges the regular price when no sale price is set', async () => {
    await service.createStripeSession(buildOptions())
    expect(unitAmount()).toBe(49900)
  })

  it('applies a coupon on top of the active sale price (promotions stack)', async () => {
    const product: ProductForCheckout = { ...baseProduct, sale_price: 300 }
    await service.createStripeSession(
      buildOptions({
        product,
        coupon: {
          id: 'c1',
          code: 'SAVE10',
          discount_type: 'percentage',
          discount_value: 10,
        } as any,
      }),
    )
    // 300 sale price - 10% = 270
    expect(unitAmount()).toBe(27000)
  })
})
