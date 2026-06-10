import { describe, it, expect } from 'vitest';
import { buildPlaceholderContext, deriveOrderId } from '@/lib/services/webhook-service';

// The real `purchase.completed` payload is the NESTED `PurchaseWebhookData`
// (see src/lib/services/webhook-payload.ts), NOT a flat object. These tests feed
// that real shape so the flagship {{email}}/{{amount}}/{{order_id}} placeholders
// and the delivery-key order id resolve against it.
describe('buildPlaceholderContext (nested PurchaseWebhookData)', () => {
  const data = {
    customer: { email: 'a@b.com', firstName: 'Ada', lastName: 'Byron', userId: 'u1' },
    product: { id: 'p1', name: 'Webinar', slug: 'webinar', price: 14900, currency: 'usd', icon: null },
    order: {
      amount: 14900,
      currency: 'usd',
      paymentIntentId: 'pi_X',
      sessionId: 'cs_test_1',
      couponId: null,
      isGuest: false,
    },
    // DisplayCustomField shape: { id, label, value, type } — machine key is `id`.
    customFields: [{ id: 'role', label: 'Your role', value: 'Founder', type: 'text' }],
  };

  it('reads the nested shape for the flagship placeholders', () => {
    const ctx = buildPlaceholderContext(data);
    expect(ctx.email).toBe('a@b.com');
    expect(ctx.first_name).toBe('Ada');
    expect(ctx.last_name).toBe('Byron');
    expect(ctx.amount).toBe('14900'); // raw minor units (cents)
    expect(ctx.amount_major).toBe('149.00'); // convenience major-unit value
    expect(ctx.currency).toBe('usd');
    expect(ctx.product_name).toBe('Webinar');
    expect(ctx.product_slug).toBe('webinar');
    expect(ctx.order_id).toBe('pi_X');
  });

  it('maps each custom field to custom_<machineKey> using the DisplayCustomField id', () => {
    const ctx = buildPlaceholderContext(data);
    expect(ctx.custom_role).toBe('Founder');
  });

  it('amount_major is empty when amount is absent', () => {
    const ctx = buildPlaceholderContext({ customer: { email: 'a@b.com' }, order: { currency: 'usd' } });
    expect(ctx.amount).toBe('');
    expect(ctx.amount_major).toBe('');
  });

  it('tolerates missing/null data without throwing', () => {
    expect(buildPlaceholderContext(undefined)).toMatchObject({ email: '', amount: '', order_id: '' });
    expect(buildPlaceholderContext(null)).toMatchObject({ email: '', order_id: '' });
  });
});

describe('deriveOrderId (nested order)', () => {
  it('prefers order.paymentIntentId', () => {
    expect(deriveOrderId({ order: { paymentIntentId: 'pi_X', sessionId: 'cs_1' } })).toBe('pi_X');
  });
  it('falls back to order.sessionId when no payment intent', () => {
    expect(deriveOrderId({ order: { paymentIntentId: null, sessionId: 'cs_1' } })).toBe('cs_1');
  });
  it('returns empty string when there is no order id', () => {
    expect(deriveOrderId({ order: {} })).toBe('');
    expect(deriveOrderId(undefined)).toBe('');
  });
});
