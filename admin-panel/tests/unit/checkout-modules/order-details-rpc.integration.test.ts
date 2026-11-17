/**
 * DB TEST: set_payment_order_details saves custom_field_values and the MERGED order_details
 * (`order_details || p_details`) in one transaction and measures the merged JSON before writing.
 * An over-limit result is refused with details_too_large (54000) and leaves the row exactly as it was.
 *
 * Case: a valid earlier profile (buyer + quantity 100 + 100 participants, 65 010 B),
 * then the participants module is switched off and new buyer data (a 1 558 B fragment) arrives; kept
 * participants make the merged details 66 194 B.
 *
 * REQUIRES: the local Supabase stack (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY).
 * @see supabase/migrations/20261111000000_checkout_details_reconciliation.sql (set_payment_order_details)
 * @see admin-panel/src/app/api/update-payment-metadata/route.ts
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateCheckoutModules } from '@/lib/checkout-modules/validate';
import { ORDER_DETAILS_MAX_BYTES, orderDetailsByteLength } from '@/lib/checkout-modules/order-details';

const db = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');
const anon = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_ANON_KEY ?? '');
const stamp = Date.now();
const productId = crypto.randomUUID();
const context = { locale: 'pl', currency: 'PLN', termsAccepted: true };
const buyerModule = { id: 'buyer', types: ['person'] };
const quantityModule = { id: 'quantity', min: 1, max: 100, mode: 'checkout' };
const withParticipants = { v: 1, modules: [buyerModule, quantityModule, { id: 'participants', required: true, prefill_from_buyer: false }] };
const withoutParticipants = { v: 1, modules: [buyerModule, quantityModule] };

function validated(profile: unknown, values: unknown) {
  const result = validateCheckoutModules(profile, values, context);
  if (!result.success) throw new Error(JSON.stringify(result.errors));
  return result.details;
}

/** The earlier, valid details: 65 010 B. */
function earlierDetails() {
  const name = 'Ż'.repeat(100);
  const participants = Array.from({ length: 100 }, (_, i) => ({
    first_name: name, last_name: name,
    email: `${String(i).padStart(3, '0')}${'u'.repeat(i === 0 ? 179 : 181)}@example.com`,
  }));
  return validated(withParticipants, {
    buyer: { type: 'person', first_name: 'Jan', last_name: 'Nowak', email: 'jan@example.com' }, quantity: 100, participants,
  });
}

/** New buyer data after the participants module was switched off: a 1 558 B fragment. */
function laterFragment() {
  const long = '漢'.repeat(100);
  return validated(withoutParticipants, { buyer: { type: 'person', first_name: long, last_name: long, email: 'b@c.example.com' }, quantity: 100 });
}

async function pendingOrder(orderDetails: unknown, customFieldValues: unknown = { note: 'before' }) {
  const sessionId = `cs_test_order_details_${crypto.randomUUID().replaceAll('-', '')}`;
  const tx = await db.from('payment_transactions').insert({
    product_id: productId, customer_email: `order-details-${crypto.randomUUID()}@example.com`, session_id: sessionId,
    amount: 1000, currency: 'PLN', status: 'pending', order_details: orderDetails, custom_field_values: customFieldValues,
  }).select('id').single();
  if (tx.error) throw tx.error;
  const line = await db.from('payment_line_items').insert({
    transaction_id: tx.data.id, product_id: productId, item_type: 'main_product', product_name: 'Order details',
    quantity: 100, unit_price: 10, total_price: 1000, discounted_total: 1000, currency: 'PLN',
  });
  if (line.error) throw line.error;
  return { id: tx.data.id as string, sessionId };
}

const row = async (id: string) =>
  (await db.from('payment_transactions').select('order_details, custom_field_values').eq('id', id).single()).data!;

beforeAll(async () => {
  const inserted = await db.from('products').insert({ id: productId, name: 'Order details product', slug: `order-details-${stamp}`, price: 10, currency: 'PLN', is_active: true });
  if (inserted.error) throw inserted.error;
});

afterAll(async () => {
  const txs = (await db.from('payment_transactions').select('id').eq('product_id', productId)).data ?? [];
  await db.from('payment_line_items').delete().in('transaction_id', txs.map(t => t.id));
  await db.from('payment_transactions').delete().eq('product_id', productId);
  await db.from('products').delete().eq('id', productId);
});

describe('set_payment_order_details', () => {
  it('builds the case sizes: 65 010 B before, a 1 558 B fragment, 66 194 B merged', () => {
    const earlier = earlierDetails();
    const fragment = laterFragment();
    expect(orderDetailsByteLength(earlier)).toBe(65010);
    expect(orderDetailsByteLength(fragment)).toBe(1558);
    expect(orderDetailsByteLength({ ...earlier, ...fragment })).toBe(66194);
    expect(ORDER_DETAILS_MAX_BYTES).toBe(65536);
  });

  it('refuses an over-limit MERGED result with details_too_large and writes nothing, custom fields included', async () => {
    const earlier = earlierDetails();
    const order = await pendingOrder(earlier);
    const before = await row(order.id);
    const { data, error } = await db.rpc('set_payment_order_details', {
      p_details: laterFragment(), p_product_id: productId, p_quantity: 100, p_session_id: order.sessionId,
      p_custom_field_values: { note: 'after' },
    });
    expect(data).toBeNull();
    expect(error?.code).toBe('54000');
    expect(error?.message).toBe('details_too_large');
    expect(await row(order.id)).toEqual(before);
  });

  it('saves custom fields and the merged details together when the result fits', async () => {
    const order = await pendingOrder({ buyer: { v: 1, type: 'person', first_name: 'Jan' }, keep: true });
    const fragment = laterFragment();
    const { data, error } = await db.rpc('set_payment_order_details', {
      p_details: fragment, p_product_id: productId, p_quantity: 100, p_session_id: order.sessionId,
      p_custom_field_values: { note: 'after' },
    });
    expect(error).toBeNull();
    expect(data).toBe(1);
    const after = await row(order.id);
    expect(after.custom_field_values).toEqual({ note: 'after' });
    expect(after.order_details).toMatchObject({ keep: true, buyer: fragment.buyer, quantity: { v: 1, value: 100 } });
  });

  it('keeps stored custom fields when none are passed', async () => {
    const order = await pendingOrder({}, { note: 'kept' });
    const { data, error } = await db.rpc('set_payment_order_details', {
      p_details: { quantity: { v: 1, value: 100 } }, p_product_id: productId, p_quantity: 100, p_session_id: order.sessionId,
    });
    expect(error).toBeNull();
    expect(data).toBe(1);
    expect((await row(order.id)).custom_field_values).toEqual({ note: 'kept' });
  });

  it('a quantity that differs from the order line saves neither custom fields nor details', async () => {
    const order = await pendingOrder({ keep: true });
    const before = await row(order.id);
    const { data, error } = await db.rpc('set_payment_order_details', {
      p_details: { quantity: { v: 1, value: 3 } }, p_product_id: productId, p_quantity: 3, p_session_id: order.sessionId,
      p_custom_field_values: { note: 'after' },
    });
    expect(error).toBeNull();
    expect(data).toBe(-1);
    expect(await row(order.id)).toEqual(before);
  });

  it('anon cannot call it', async () => {
    const { error } = await anon.rpc('set_payment_order_details', {
      p_details: {}, p_product_id: productId, p_quantity: 1, p_session_id: 'cs_test_none', p_custom_field_values: {},
    });
    expect(error?.code).toBe('42501');
  });
});
