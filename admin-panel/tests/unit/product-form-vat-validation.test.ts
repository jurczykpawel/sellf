import { describe, it, expect } from 'vitest'

/**
 * Tests for VAT rate validation logic extracted from useProductForm.
 * The hook uses this rule:
 *   if (taxMode === 'local' && (price > 0 || allow_custom_price) && price_includes_vat && vat_rate == null)
 *     → errors.vat_rate = 'required'
 *
 * We test the pure validation logic without rendering React hooks.
 */

type TaxMode = 'local' | 'stripe_tax'

interface VatValidationInput {
  taxMode: TaxMode
  price_includes_vat: boolean
  vat_rate: number | null
  allow_custom_price: boolean
  name: string
  slug: string
  description: string
  priceDisplayValue: string
}

interface VatValidationInputWithPrice extends VatValidationInput {
  price: number
}

function validateProductForm(input: VatValidationInputWithPrice): Record<string, string> {
  const errors: Record<string, string> = {}

  if (!input.name.trim()) errors.name = 'required'
  if (!input.slug.trim()) errors.slug = 'required'
  if (!input.description.trim()) errors.description = 'required'
  if (input.priceDisplayValue === '') errors.price = 'required'

  // VAT validation — mirrors useProductForm.validateRequiredFields
  if (input.taxMode === 'local' && (input.price > 0 || input.allow_custom_price) && input.price_includes_vat && input.vat_rate == null) {
    errors.vat_rate = 'required'
  }

  return errors
}

const validBase: VatValidationInputWithPrice = {
  taxMode: 'local',
  price_includes_vat: true,
  vat_rate: 23,
  price: 99,
  allow_custom_price: false,
  name: 'Test Product',
  slug: 'test-product',
  description: 'A test product',
  priceDisplayValue: '99.00',
}

describe('Product form VAT validation', () => {
  describe('local tax mode', () => {
    it('should pass when vat_rate is set and price_includes_vat is true', () => {
      const errors = validateProductForm(validBase)
      expect(errors.vat_rate).toBeUndefined()
    })

    it('should fail when vat_rate is null and price_includes_vat is true', () => {
      const errors = validateProductForm({
        ...validBase,
        vat_rate: null,
      })
      expect(errors.vat_rate).toBe('required')
    })

    it('should pass when vat_rate is 0 (zero tax is valid)', () => {
      const errors = validateProductForm({
        ...validBase,
        vat_rate: 0,
      })
      expect(errors.vat_rate).toBeUndefined()
    })

    it('should pass when price_includes_vat is false (VAT not relevant)', () => {
      const errors = validateProductForm({
        ...validBase,
        vat_rate: null,
        price_includes_vat: false,
      })
      expect(errors.vat_rate).toBeUndefined()
    })

    it('should pass with decimal vat_rate like 7.5', () => {
      const errors = validateProductForm({
        ...validBase,
        vat_rate: 7.5,
      })
      expect(errors.vat_rate).toBeUndefined()
    })
  })

  describe('stripe_tax mode', () => {
    it('should pass even when vat_rate is null (Stripe handles tax)', () => {
      const errors = validateProductForm({
        ...validBase,
        taxMode: 'stripe_tax',
        vat_rate: null,
      })
      expect(errors.vat_rate).toBeUndefined()
    })

    it('should pass when price_includes_vat and vat_rate is null', () => {
      const errors = validateProductForm({
        ...validBase,
        taxMode: 'stripe_tax',
        price_includes_vat: true,
        vat_rate: null,
      })
      expect(errors.vat_rate).toBeUndefined()
    })
  })

  describe('combined validation', () => {
    it('should report both name and vat_rate errors', () => {
      const errors = validateProductForm({
        ...validBase,
        name: '',
        vat_rate: null,
      })
      expect(errors.name).toBe('required')
      expect(errors.vat_rate).toBe('required')
    })

    it('should report price error but not vat_rate in stripe_tax mode', () => {
      const errors = validateProductForm({
        ...validBase,
        taxMode: 'stripe_tax',
        priceDisplayValue: '',
        vat_rate: null,
      })
      expect(errors.price).toBe('required')
      expect(errors.vat_rate).toBeUndefined()
    })

    it('should return no errors for fully valid local form', () => {
      const errors = validateProductForm(validBase)
      expect(Object.keys(errors)).toHaveLength(0)
    })

    it('should return no errors for fully valid stripe_tax form with null vat', () => {
      const errors = validateProductForm({
        ...validBase,
        taxMode: 'stripe_tax',
        vat_rate: null,
      })
      expect(Object.keys(errors)).toHaveLength(0)
    })
  })

  describe('edge cases', () => {
    it('should treat undefined vat_rate same as null (== null check)', () => {
      const input = { ...validBase, vat_rate: undefined as unknown as null }
      const errors = validateProductForm(input)
      expect(errors.vat_rate).toBe('required')
    })

    it('should not require vat_rate when price_includes_vat toggles off', () => {
      // Simulates user unchecking "price includes VAT" — no VAT rate needed
      const errors = validateProductForm({
        ...validBase,
        price_includes_vat: false,
        vat_rate: null,
      })
      expect(errors.vat_rate).toBeUndefined()
    })
  })

  describe('free products (price = 0)', () => {
    it('should not require vat_rate when price is 0', () => {
      const errors = validateProductForm({
        ...validBase,
        price: 0,
        priceDisplayValue: '0',
        price_includes_vat: true,
        vat_rate: null,
      })
      expect(errors.vat_rate).toBeUndefined()
    })

    it('should not require vat_rate for free product with empty price display', () => {
      const errors = validateProductForm({
        ...validBase,
        price: 0,
        priceDisplayValue: '',
        price_includes_vat: true,
        vat_rate: null,
      })
      // price field itself is required but vat_rate should not be
      expect(errors.price).toBe('required')
      expect(errors.vat_rate).toBeUndefined()
    })

    it('should still require vat_rate when price > 0', () => {
      const errors = validateProductForm({
        ...validBase,
        price: 49,
        priceDisplayValue: '49',
        price_includes_vat: true,
        vat_rate: null,
      })
      expect(errors.vat_rate).toBe('required')
    })
  })

  describe('PWYW (allow_custom_price) mode', () => {
    it('should require vat_rate when allow_custom_price is true even if price is 0', () => {
      const errors = validateProductForm({
        ...validBase,
        price: 0,
        priceDisplayValue: '0',
        allow_custom_price: true,
        price_includes_vat: true,
        vat_rate: null,
      })
      expect(errors.vat_rate).toBe('required')
    })

    it('should pass when allow_custom_price is true and vat_rate is set', () => {
      const errors = validateProductForm({
        ...validBase,
        price: 0,
        priceDisplayValue: '0',
        allow_custom_price: true,
        price_includes_vat: true,
        vat_rate: 23,
      })
      expect(errors.vat_rate).toBeUndefined()
    })

    it('should not require vat_rate when allow_custom_price is true but price_includes_vat is false', () => {
      const errors = validateProductForm({
        ...validBase,
        price: 0,
        priceDisplayValue: '0',
        allow_custom_price: true,
        price_includes_vat: false,
        vat_rate: null,
      })
      expect(errors.vat_rate).toBeUndefined()
    })

    it('should require vat_rate when allow_custom_price is true and price > 0 (PWYW with suggested price)', () => {
      const errors = validateProductForm({
        ...validBase,
        price: 10,
        priceDisplayValue: '10',
        allow_custom_price: true,
        price_includes_vat: true,
        vat_rate: null,
      })
      expect(errors.vat_rate).toBe('required')
    })

    it('should not require vat_rate in stripe_tax mode even with allow_custom_price', () => {
      const errors = validateProductForm({
        ...validBase,
        taxMode: 'stripe_tax',
        price: 0,
        priceDisplayValue: '0',
        allow_custom_price: true,
        price_includes_vat: true,
        vat_rate: null,
      })
      expect(errors.vat_rate).toBeUndefined()
    })
  })
})
