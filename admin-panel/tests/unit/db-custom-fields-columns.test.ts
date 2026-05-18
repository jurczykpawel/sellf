import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// Migration <ts>_add_custom_checkout_fields.sql must add two JSONB columns:
//   products.custom_checkout_fields JSONB NOT NULL DEFAULT '[]'
//   payment_transactions.custom_field_values JSONB NOT NULL DEFAULT '{}'
//
// We only assert structural defaults + column existence + the public.products
// view refresh (because public.products is a SELECT * view and Postgres
// freezes the column list at view creation — we hit this exact issue in
// Phase 1). RLS, grants, and indexes are unchanged so we don't assert them.

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const productOverrides = (extra: Record<string, unknown> = {}) => ({
  name: `Custom Fields Migration Test ${Date.now()}-${Math.random()}`,
  slug: `cf-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  price: 10,
  currency: 'USD',
  is_active: true,
  ...extra,
});

describe('custom checkout fields columns', () => {
  it("products.custom_checkout_fields defaults to '[]' (empty JSON array)", async () => {
    const { data, error } = await admin
      .from('products')
      .insert(productOverrides())
      .select('id, custom_checkout_fields')
      .single();
    expect(error).toBeNull();
    expect(data?.custom_checkout_fields).toEqual([]);
    if (data?.id) await admin.from('products').delete().eq('id', data.id);
  });

  it('products.custom_checkout_fields persists a non-empty JSONB array', async () => {
    const fields = [
      {
        id: 'message',
        type: 'textarea',
        label: 'Wiadomość',
        required: false,
        max_length: 500,
      },
    ];
    const { data, error } = await admin
      .from('products')
      .insert(productOverrides({ custom_checkout_fields: fields }))
      .select('id, custom_checkout_fields')
      .single();
    expect(error).toBeNull();
    expect(data?.custom_checkout_fields).toEqual(fields);
    if (data?.id) await admin.from('products').delete().eq('id', data.id);
  });

  it("payment_transactions.custom_field_values defaults to '{}' (empty JSON object)", async () => {
    // Create a transient product to satisfy FK
    const { data: product } = await admin
      .from('products')
      .insert(productOverrides())
      .select('id')
      .single();
    if (!product) throw new Error('failed to create product fixture');

    const { data: tx, error: txError } = await admin
      .from('payment_transactions')
      .insert({
        session_id: `cs_test_cf_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        product_id: product.id,
        customer_email: 'fixture@example.com',
        amount: 10,
        currency: 'USD',
        status: 'pending',
      })
      .select('id, custom_field_values')
      .single();
    expect(txError).toBeNull();
    expect(tx?.custom_field_values).toEqual({});

    if (tx?.id) await admin.from('payment_transactions').delete().eq('id', tx.id);
    await admin.from('products').delete().eq('id', product.id);
  });
});
