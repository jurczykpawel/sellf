/** W146 B6/B7: prices below the Stripe minimum and absurd license durations are rejected at the field. */
import { describe, expect, it } from 'vitest';
import { ProductCreateDTO, ProductUpdateDTO } from '@/lib/api/dto/product';
import { collectRequiredFieldErrors } from '@/components/ProductFormModal/hooks/required-fields';
import { licenseDurationError } from '@/lib/validations/product';

const base = { name: 'P', slug: 'p', description: '', price: 0.49, currency: 'USD', price_includes_vat: false, allow_custom_price: false, ux_product_type: 'standard' as const };

describe('Stripe minimum price', () => {
  it('form flags 0.49 USD at the price field', () => {
    expect(collectRequiredFieldErrors(base, '0,49', 'stripe_tax').price).toBe('below_minimum');
    expect(collectRequiredFieldErrors({ ...base, price: 0.5 }, '0,50', 'stripe_tax').price).toBeUndefined();
    expect(collectRequiredFieldErrors({ ...base, currency: 'JPY', price: 49 }, '49', 'stripe_tax').price).toBe('below_minimum');
  });
  it('API refuses to store a paid price below the minimum', () => {
    const r = ProductCreateDTO.safeParse({ name: 'P', slug: 'p', price: 0.49, currency: 'USD' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['price']);
    expect(ProductUpdateDTO.safeParse({ price: 0.49 }).success).toBe(false);
    expect(ProductCreateDTO.safeParse({ name: 'P', slug: 'p', price: 0, currency: 'USD' }).success).toBe(true);
    expect(ProductCreateDTO.safeParse({ name: 'P', slug: 'p', price: 0.5, currency: 'USD' }).success).toBe(true);
  });
});

describe('license duration', () => {
  it.each([[0, 'license_duration'], [-1, 'license_duration'], [1.5, 'license_duration'], [36501, 'license_duration'], [99999999, 'license_duration'], [1, null], [36500, null], [null, null]])('%s → %s', (v, e) => {
    expect(licenseDurationError(v)).toBe(e);
  });
  it('API rejects durations above 100 years', () => {
    expect(ProductUpdateDTO.safeParse({ license_duration_days: 99999999 }).success).toBe(false);
    expect(ProductUpdateDTO.safeParse({ license_duration_days: 36500 }).success).toBe(true);
    expect(ProductUpdateDTO.safeParse({ license_duration_days: null }).success).toBe(true);
  });
});

describe('manual issuance with a legacy out-of-range duration', () => {
  it('answers 409 with a field code instead of 500', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { slug: 'p', name: 'P', custom_checkout_fields: [], license_duration_days: 99999999 }, error: null }) }) }) }) }) }));
    const { issueRequestedLicense } = await import('@/lib/license-keys/request');
    const r = await issueRequestedLicense({ productId: '00000000-0000-4000-8000-000000000001', email: 'a@example.com' } as never, { actorUserId: 'u', source: 'manual', origin: 'https://x' });
    expect(r).toMatchObject({ ok: false, status: 409, fieldErrors: { license_duration_days: 'license_duration' } });
    vi.doUnmock('@/lib/supabase/admin');
  });
});

describe('server validation lands at the field', () => {
  it('maps API field errors to form field codes', async () => {
    const { serverFieldErrors } = await import('@/components/ProductFormModal/hooks/required-fields');
    expect(serverFieldErrors({ price: ['price must be 0 or at least 0.5'], license_duration_days: ['Too big'] })).toEqual({ price: 'below_minimum', license_duration_days: 'license_duration' });
    expect(serverFieldErrors(undefined)).toEqual({});
  });
});

describe('checkout guard', () => {
  it('detects a paid total Stripe cannot charge', async () => {
    const { isBelowMinimumCharge } = await import('@/lib/currency/minor-units');
    expect(isBelowMinimumCharge(49, 'USD')).toBe(true);
    expect(isBelowMinimumCharge(50, 'USD')).toBe(false);
    expect(isBelowMinimumCharge(0, 'USD')).toBe(false);
    expect(isBelowMinimumCharge(49, 'JPY')).toBe(true);
  });
});
