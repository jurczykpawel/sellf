import { describe, it, expect } from 'vitest';
import { buildPurchaseWebhookPayload } from '@/lib/services/webhook-payload';
import type { CustomFieldDefinition } from '@/lib/validations/custom-checkout-fields';

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
