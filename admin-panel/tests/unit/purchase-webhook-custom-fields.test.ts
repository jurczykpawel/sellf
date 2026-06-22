import { describe, it, expect } from 'vitest';
import { buildPurchaseWebhookPayload } from '@/lib/services/webhook-payload';
import type { CustomFieldDefinition } from '@/lib/validations/custom-checkout-fields';
import type { OrderTaxSnapshot } from '@/lib/services/tax-snapshot';

/**
 * Mocks the supabase client so we exercise the payload-build logic without DB.
 * `select(...).eq(...).single()` returns the prepared row; `select(...).in(...)`
 * returns the prepared list. The webhook payload builder only needs these two
 * shapes today.
 */
function mockSupabase(opts: {
  productRow?: Record<string, unknown> | null;
  bumpRows?: Record<string, unknown>[];
}) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                single: async () => ({ data: opts.productRow ?? null, error: null }),
              };
            },
            in: async () => ({ data: opts.bumpRows ?? [], error: null }),
          };
        },
      };
    },
  };
}

const customFieldDefs: CustomFieldDefinition[] = [
  { id: 'note', type: 'textarea', label: 'Wiadomość', required: false, max_length: 500 },
  { id: 'imie', type: 'text', label: { pl: 'Imię', en: 'First name' }, required: true, max_length: 100 },
];

describe('buildPurchaseWebhookPayload — custom fields', () => {
  it('attaches `customFields` array when values + definitions are provided', async () => {
    const supabase = mockSupabase({
      productRow: {
        id: 'prod_1',
        name: 'Course',
        slug: 'course',
        price: 49,
        currency: 'PLN',
        icon: '📘',
        custom_checkout_fields: customFieldDefs,
      },
    });

    const payload = await buildPurchaseWebhookPayload({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseClient: supabase as any,
      customerEmail: 'buyer@example.com',
      userId: null,
      productId: 'prod_1',
      bumpProductIds: [],
      metadata: null,
      amount: 4900,
      currency: 'PLN',
      paymentIntentId: 'pi_x',
      couponId: null,
      isGuest: true,
      customFieldValues: { note: 'Dziękuję!', imie: 'Anna' },
    });

    // Webhook payload uses the English label for multilang fields (receivers
    // re-resolve locale themselves; see formatCustomFieldsForDisplay for the
    // locale-aware variant used by the admin UI).
    expect(payload.customFields).toEqual([
      { id: 'note', label: 'Wiadomość', value: 'Dziękuję!', type: 'textarea' },
      { id: 'imie', label: 'First name', value: 'Anna', type: 'text' },
    ]);
  });

  it('omits the customFields key when no values were submitted', async () => {
    const supabase = mockSupabase({
      productRow: {
        id: 'prod_1', name: 'Course', slug: 'course', price: 49, currency: 'PLN', icon: null,
        custom_checkout_fields: customFieldDefs,
      },
    });

    const payload = await buildPurchaseWebhookPayload({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseClient: supabase as any,
      customerEmail: 'buyer@example.com',
      userId: null,
      productId: 'prod_1',
      bumpProductIds: [],
      metadata: null,
      amount: 4900,
      currency: 'PLN',
      paymentIntentId: 'pi_x',
      couponId: null,
      isGuest: true,
    });

    expect(payload.customFields).toBeUndefined();
  });

  it('skips values for ids absent from the product definitions', async () => {
    const supabase = mockSupabase({
      productRow: {
        id: 'prod_1', name: 'Course', slug: 'course', price: 49, currency: 'PLN', icon: null,
        custom_checkout_fields: customFieldDefs,
      },
    });

    const payload = await buildPurchaseWebhookPayload({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseClient: supabase as any,
      customerEmail: 'buyer@example.com',
      userId: null,
      productId: 'prod_1',
      bumpProductIds: [],
      metadata: null,
      amount: 4900,
      currency: 'PLN',
      paymentIntentId: 'pi_x',
      couponId: null,
      isGuest: true,
      customFieldValues: { stale: 'ignored', note: 'kept' },
    });

    expect(payload.customFields).toEqual([
      { id: 'note', label: 'Wiadomość', value: 'kept', type: 'textarea' },
    ]);
  });
});

describe('buildPurchaseWebhookPayload — tax snapshot', () => {
  it('emits per-line tax on product + bump and order totals', async () => {
    const supabase = mockSupabase({
      productRow: {
        id: 'prod_1', name: 'Course', slug: 'course', price: 100, currency: 'PLN', icon: null,
        custom_checkout_fields: null, vat_exempt: false,
      },
      bumpRows: [
        { id: 'bump_1', name: 'Toolkit', slug: 'toolkit', price: 50, currency: 'PLN', icon: null, vat_exempt: true },
      ],
    });

    const taxSnapshot: OrderTaxSnapshot = {
      netTotal: 15000,
      taxTotal: 2300,
      currency: 'pln',
      status: 'captured',
      lines: [
        { productId: 'prod_1', isBump: false, netAmount: 10000, taxAmount: 2300, grossAmount: 12300, vatRate: 23, taxBehavior: 'exclusive', taxabilityReason: 'standard_rated', breakdown: [] },
        { productId: 'bump_1', isBump: true, netAmount: 5000, taxAmount: 0, grossAmount: 5000, vatRate: null, taxBehavior: null, taxabilityReason: null, breakdown: [] },
      ],
    };

    const payload = await buildPurchaseWebhookPayload({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseClient: supabase as any,
      customerEmail: 'b@e.com',
      userId: null,
      productId: 'prod_1',
      bumpProductIds: ['bump_1'],
      metadata: null,
      amount: 17300,
      currency: 'PLN',
      paymentIntentId: 'pi_x',
      couponId: null,
      isGuest: true,
      taxSnapshot,
    });

    expect(payload.product).toMatchObject({
      id: 'prod_1', net: 10000, tax: 2300, gross: 12300, vatRate: 23,
      vatExempt: false, taxBehavior: 'exclusive', taxabilityReason: 'standard_rated',
    });
    expect(payload.bumpProducts[0]).toMatchObject({
      id: 'bump_1', net: 5000, tax: 0, vatRate: null, vatExempt: true,
    });
    expect(payload.order.netTotal).toBe(15000);
    expect(payload.order.taxTotal).toBe(2300);
  });

  it('omits tax fields when no snapshot provided (backward-compatible)', async () => {
    const supabase = mockSupabase({
      productRow: {
        id: 'prod_1', name: 'C', slug: 'c', price: 100, currency: 'PLN', icon: null,
        custom_checkout_fields: null, vat_exempt: false,
      },
    });

    const payload = await buildPurchaseWebhookPayload({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseClient: supabase as any,
      customerEmail: 'b@e.com',
      userId: null,
      productId: 'prod_1',
      bumpProductIds: [],
      metadata: null,
      amount: 10000,
      currency: 'PLN',
      paymentIntentId: 'pi_x',
      couponId: null,
      isGuest: true,
    });

    expect((payload.product as { net?: number }).net).toBeUndefined();
    expect(payload.order.netTotal).toBeUndefined();
  });
});
