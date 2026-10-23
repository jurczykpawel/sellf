import { describe, expect, it } from 'vitest';
import { bankTransferConfigSchema, canUseBankTransfer, normalizeBankAccount } from '@/lib/orders/bank-transfer-config';
import { checkoutProfileSchema } from '@/lib/checkout-modules/profile';
import { validateCheckoutModules } from '@/lib/checkout-modules/validate';
import { validateEventTypes } from '@/lib/validations/webhook';
import { WEBHOOK_EVENTS } from '@/types/webhooks';

describe('traditional transfers', () => {
  it('validates the Polish IBAN and NRB checksum', () => {
    expect(normalizeBankAccount('61 1090 1014 0000 0712 1981 2874')).toBe('PL61109010140000071219812874');
    expect(normalizeBankAccount('PL61109010140000071219812874')).toBe('PL61109010140000071219812874');
    for (const value of ['', 'PL62109010140000071219812874', 'DE61109010140000071219812874']) expect(normalizeBankAccount(value)).toBeNull();
  });
  it('requires complete bank details when enabled and bounds the due date', () => {
    expect(bankTransferConfigSchema.safeParse({ bank_transfer_enabled: true }).success).toBe(false);
    expect(bankTransferConfigSchema.safeParse({ bank_transfer_due_days: 61 }).success).toBe(false);
    expect(bankTransferConfigSchema.parse({}).bank_transfer_due_days).toBe(14);
    expect(bankTransferConfigSchema.parse({}).bank_transfer_max_unpaid_per_email).toBe(3);
  });
  it('requires the store, profile and matching buyer type', () => {
    const profile = { v: 1, modules: [{ id: 'buyer', types: ['person', 'organization'], gus: false, bank_transfer_for: ['organization'] }] };
    expect(canUseBankTransfer(true, profile, 'organization')).toBe(true);
    expect(canUseBankTransfer(false, profile, 'organization')).toBe(false);
    expect(canUseBankTransfer(true, null, 'organization')).toBe(false);
    expect(canUseBankTransfer(true, profile, 'person')).toBe(false);
    expect(canUseBankTransfer(true, { v: 1, modules: [{ id: 'buyer', types: ['organization'], gus: false }] }, 'organization')).toBe(false);
    expect(checkoutProfileSchema.safeParse(profile).success).toBe(true);
  });
  it('shares module validation and records explicit consent', () => {
    const result = validateCheckoutModules({ v: 1, modules: [{ id: 'buyer', types: ['person'], gus: false }] }, {
      buyer: { type: 'person', first_name: 'Anna', last_name: 'Nowak', email: 'anna@example.com' },
    }, { currency: 'PLN', locale: 'pl', termsAccepted: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.details.buyer).toMatchObject({ terms_accepted: true });
  });
  it.each(['order.placed', 'order.cancelled', 'order.overdue'])('registers %s for subscriptions', event => {
    expect(validateEventTypes([event]).valid).toBe(true);
    expect(WEBHOOK_EVENTS.some(e => e.value === event)).toBe(true);
  });
});
