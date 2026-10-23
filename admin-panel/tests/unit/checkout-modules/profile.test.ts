import { describe, expect, it } from 'vitest';
import { checkoutProfileSchema, parseCheckoutProfile } from '@/lib/checkout-modules/profile';
import type { CheckoutCtx } from '@/lib/checkout-modules/registry';
import { validateModuleValues } from '@/lib/checkout-modules/registry';
import { mapApiInputToProductRow } from '@/lib/api/dto/product';
import { validateCreateProduct } from '@/lib/validations/product';

const buyer = { id: 'buyer', types: ['person', 'organization'], gus: false };
const quantity = { id: 'quantity', min: 1, max: 5, mode: 'checkout' };
const profile = { v: 1, modules: [buyer, quantity] };
const ctx = { locale: 'pl', currency: 'PLN', quantity: 2, buyerType: 'person' } as const;
const person = { type: 'person', first_name: 'Jan', last_name: 'Nowak', email: 'jan@example.com' };
const company = { type: 'organization', company_name: 'Gmina', nip: 'PL 525-224-84-81', address: 'Prosta 1', postal_code: '00-001', city: 'Warszawa' };

describe('checkout profile', () => {
  it('accepts a strict versioned profile and rejects unknown keys', () => {
    expect(checkoutProfileSchema.safeParse(profile).success).toBe(true);
    for (const value of [{ ...profile, price: 1 }, { v: 2, modules: [] }, { v: 1, modules: [{ ...buyer, price: 1 }] }]) {
      expect(checkoutProfileSchema.safeParse(value).success).toBe(false);
    }
  });
  it.each([
    [buyer, buyer], [{ ...buyer, types: [] }], [{ ...buyer, types: ['person', 'person'] }],
    [{ id: 'participants', required: true, prefill_from_buyer: true }],
    [{ id: 'recipient', for: ['organization'] }],
    [{ ...buyer, types: ['person'] }, { id: 'recipient', for: ['organization'] }],
    [{ ...quantity, min: 0 }], [{ ...quantity, min: 6 }], [{ ...quantity, max: 101 }], [{ ...quantity, max: 2.5 }],
  ])('rejects invalid module combination %j', (...modules) => {
    expect(checkoutProfileSchema.safeParse({ v: 1, modules }).success).toBe(false);
  });
  it.each([
    { checkout_template: 'tip-jar' }, { checkout_template: 'oto' }, { product_type: 'subscription' },
    { allow_custom_price: true }, { is_bundle: true }, { issue_license_on_purchase: true },
  ])('rejects incompatible product %j', product => {
    expect(parseCheckoutProfile(profile, product).success).toBe(false);
  });
  it('requires configured GUS and allows one license per order', () => {
    expect(parseCheckoutProfile({ v: 1, modules: [{ ...buyer, gus: true }] }, {}, false).success).toBe(false);
    expect(parseCheckoutProfile({ v: 1, modules: [{ ...buyer, gus: true }] }, {}, true).success).toBe(true);
    expect(parseCheckoutProfile({ v: 1, modules: [{ ...quantity, max: 1 }] }, { issue_license_on_purchase: true }).success).toBe(true);
  });
  it('keeps profiles in API inputs and validates product combinations', () => {
    const input = { name: 'Seats', slug: 'seats', price: 50, checkout_profile: profile };
    expect(mapApiInputToProductRow(input, 'create').checkout_profile).toEqual(profile);
    expect(mapApiInputToProductRow({ checkout_profile: null }, 'update').checkout_profile).toBeNull();
    expect(validateCreateProduct({ ...input, is_bundle: true }).isValid).toBe(false);
    expect(() => mapApiInputToProductRow({ ...input, checkout_profile: { v: 2 } }, 'create')).toThrow();
  });
});

describe('module values', () => {
  function validate(modules: unknown[], values: unknown, context: CheckoutCtx = ctx) {
    return validateModuleValues(checkoutProfileSchema.parse({ v: 1, modules }), values, context);
  }
  it('stores versioned person and quantity data', () => {
    expect(validate([buyer, quantity], { buyer: person, quantity: 2 })).toMatchObject({ success: true, details: {
      buyer: { v: 1, ...person, full_name: 'Jan Nowak', source: 'checkout' }, quantity: { v: 1, value: 2 },
    } });
  });
  it('normalizes organization and recipient NIP', () => {
    const recipient = { id: 'recipient', for: ['organization'] };
    const result = validate([buyer, recipient], { buyer: company, recipient: { company_name: company.company_name, nip: company.nip, address: company.address, city: company.city, postal_code: company.postal_code, differs: true } }, { ...ctx, buyerType: 'organization' });
    expect(result).toMatchObject({ success: true, details: { buyer: { nip: '5252248481' }, recipient: { nip: '5252248481' } } });
  });
  it('reports field errors for missing recipient NIP', () => {
    const result = validate([buyer, { id: 'recipient', for: ['organization'] }], { buyer: company, recipient: { differs: true, company_name: 'School', address: 'A', postal_code: '00-001', city: 'City', nip: '123' } }, { ...ctx, buyerType: 'organization' });
    expect(result).toMatchObject({ success: false, errors: expect.arrayContaining([{ field: 'recipient.nip', code: 'invalid_nip' }]) });
  });
  it('checks allowed buyer type, names, company address, email and strict values', () => {
    for (const value of [{ ...person, email: 'bad' }, { ...person, first_name: '' }, { ...person, first_name: 'Jan\u0000' }, { ...company, address: 'Prosta\u0000' }, { ...person, price: 1 }, { ...company, city: '' }, { ...company, nip: '1234567890' }]) {
      expect(validate([buyer], { buyer: value }).success).toBe(false);
    }
    expect(validate([{ ...buyer, types: ['person'] }], { buyer: company }).success).toBe(false);
  });
  it('accepts disabled recipient for private buyers and refuses a different recipient', () => {
    const modules = [buyer, { id: 'recipient', for: ['organization'] }];
    expect(validate(modules, { buyer: person, recipient: { differs: false } }).success).toBe(true);
    expect(validate(modules, { buyer: person, recipient: { company_name: company.company_name, nip: company.nip, address: company.address, city: company.city, postal_code: company.postal_code, differs: true } }).success).toBe(false);
  });
  it('normalizes PL phone, checks E.164 and requiredness', () => {
    const modules = [{ id: 'phone', required: true }];
    expect(validate(modules, { phone: '501 234-567' })).toMatchObject({ success: true, details: { phone: { v: 1, value: '+48501234567' } } });
    for (const phone of ['', 'abc', '+000000000', '123']) expect(validate(modules, { phone }).success).toBe(false);
    expect(validate([{ id: 'phone', required: false }], { phone: '' }).success).toBe(true);
  });
  it('checks quantity bounds and hidden mode', () => {
    for (const value of [0, 6, 1.5, '2']) expect(validate([quantity], { quantity: value }).success).toBe(false);
    expect(validate([{ ...quantity, mode: 'hidden' }], { quantity: 2 }).success).toBe(false);
    expect(validate([{ ...quantity, mode: 'hidden' }], { quantity: 1 }).success).toBe(true);
  });
  it('validates every module even when values are missing and refuses extra modules', () => {
    expect(validate([buyer, quantity], {}).success).toBe(false);
    expect(validate([buyer], { buyer: person, phone: '501234567' }).success).toBe(false);
  });
  it('checks participant count, email, duplicates and optional empty lists', () => {
    const participants = { id: 'participants', required: true, prefill_from_buyer: true };
    const modules = [quantity, participants];
    const people = [{ first_name: 'A', last_name: 'B', email: 'a@example.com' }, { first_name: 'C', last_name: 'D', email: 'b@example.com' }];
    expect(validate(modules, { quantity: 2, participants: people }).success).toBe(true);
    for (const list of [[], people.slice(1), [people[0], { ...people[1], email: 'A@example.com' }], [people[0], { ...people[1], email: 'bad' }]]) {
      expect(validate(modules, { quantity: 2, participants: list }).success).toBe(false);
    }
    expect(validate([quantity, { ...participants, required: false }], { quantity: 2, participants: [] }).success).toBe(true);
  });
});
