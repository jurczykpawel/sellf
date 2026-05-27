/**
 * 001 — durable Stripe Price binding per Sellf product.
 *
 * The helper creates a real Stripe Price object once per Sellf product and
 * persists its id into public.products.stripe_price_id. Subsequent calls
 * reuse the persisted id when its parameters still match the product. When the
 * product's recurring config drifts, a new Price is created (Stripe Prices are
 * immutable) and the column is updated.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { getOrCreateStripePriceForProduct } from '@/lib/stripe/product-price';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const canRun = !!STRIPE_SECRET_KEY?.startsWith('sk_test_') && !!SUPABASE_URL && !!SERVICE_ROLE_KEY;
const stripe = canRun ? new Stripe(STRIPE_SECRET_KEY!) : null;
const supabase = canRun
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { db: { schema: 'public' } })
  : null;

const createdProductIds: string[] = [];
const createdPriceIds: string[] = [];

beforeAll(() => {
  if (!canRun) console.warn('[stripe-product-price] Skipping — env missing');
});

afterAll(async () => {
  if (createdPriceIds.length > 0 && stripe) {
    await Promise.allSettled(
      createdPriceIds.map((id) => stripe.prices.update(id, { active: false }))
    );
  }
  if (createdProductIds.length > 0 && supabase) {
    await supabase.from('products').delete().in('id', createdProductIds);
  }
});

async function makeProduct(overrides: Partial<{
  recurring_price: number;
  billing_interval: 'day' | 'week' | 'month' | 'year';
  billing_interval_count: number;
  currency: string;
  stripe_price_id: string | null;
}> = {}) {
  const { data } = await supabase!
    .from('products')
    .insert({
      name: `Price Test ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      slug: `price-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      price: 0,
      currency: overrides.currency ?? 'PLN',
      product_type: 'subscription',
      billing_interval: overrides.billing_interval ?? 'month',
      billing_interval_count: overrides.billing_interval_count ?? 1,
      recurring_price: overrides.recurring_price ?? 49,
      stripe_price_id: overrides.stripe_price_id ?? null,
    })
    .select()
    .single();
  if (data?.id) createdProductIds.push(data.id);
  return data!;
}

describe.skipIf(!canRun)('getOrCreateStripePriceForProduct', () => {
  it('creates a Stripe Price for a fresh product and persists the id', async () => {
    const product = await makeProduct();
    expect(product.stripe_price_id).toBeNull();

    const priceId = await getOrCreateStripePriceForProduct(stripe!,product);
    expect(priceId).toMatch(/^price_/);
    createdPriceIds.push(priceId);

    // Persisted on the row.
    const { data: refreshed } = await supabase!
      .from('products')
      .select('stripe_price_id')
      .eq('id', product.id)
      .single();
    expect(refreshed?.stripe_price_id).toBe(priceId);

    // Real Stripe Price has matching shape.
    const stripePrice = await stripe!.prices.retrieve(priceId);
    expect(stripePrice.unit_amount).toBe(4900);
    expect(stripePrice.currency).toBe('pln');
    expect(stripePrice.recurring?.interval).toBe('month');
    expect(stripePrice.recurring?.interval_count).toBe(1);
    expect(stripePrice.active).toBe(true);
  });

  it('reuses the persisted id when parameters match (one Stripe Price per product)', async () => {
    const product = await makeProduct();
    const id1 = await getOrCreateStripePriceForProduct(stripe!,product);
    createdPriceIds.push(id1);

    const { data: refreshed } = await supabase!
      .from('products')
      .select('*')
      .eq('id', product.id)
      .single();

    const id2 = await getOrCreateStripePriceForProduct(stripe!,refreshed!);
    expect(id2).toBe(id1);
  });

  it('creates a new Price when the product recurring config drifts', async () => {
    const product = await makeProduct({ recurring_price: 49 });
    const id1 = await getOrCreateStripePriceForProduct(stripe!,product);
    createdPriceIds.push(id1);

    // Admin updates the price on the product. The persisted Stripe Price (immutable)
    // no longer matches; a new one must be created.
    await supabase!.from('products').update({ recurring_price: 99 }).eq('id', product.id);
    const { data: refreshed } = await supabase!
      .from('products')
      .select('*')
      .eq('id', product.id)
      .single();

    const id2 = await getOrCreateStripePriceForProduct(stripe!,refreshed!);
    createdPriceIds.push(id2);
    expect(id2).not.toBe(id1);

    const { data: latest } = await supabase!
      .from('products')
      .select('stripe_price_id')
      .eq('id', product.id)
      .single();
    expect(latest?.stripe_price_id).toBe(id2);
  });
});
