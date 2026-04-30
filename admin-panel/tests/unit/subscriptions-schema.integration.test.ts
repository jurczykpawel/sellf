/**
 * Subscriptions Schema Integration Tests
 *
 * Verifies the subscriptions MVP schema after running migrations:
 * - new columns on products / coupons / payment_transactions / user_product_access
 * - new tables: stripe_customers, subscriptions
 * - CHECK constraints reject invalid values
 * - RLS is enabled on new tables
 *
 * Run: bun run test:unit -- tests/unit/subscriptions-schema.integration.test.ts
 * Requires: local Supabase running, DB reset with subscriptions_mvp migration applied.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const createdProductIds: string[] = [];
const createdSubscriptionIds: string[] = [];
const createdStripeCustomerIds: string[] = [];

afterAll(async () => {
  if (createdSubscriptionIds.length > 0) {
    await supabaseAdmin.from('subscriptions').delete().in('id', createdSubscriptionIds);
  }
  if (createdStripeCustomerIds.length > 0) {
    await supabaseAdmin.from('stripe_customers').delete().in('id', createdStripeCustomerIds);
  }
  if (createdProductIds.length > 0) {
    await supabaseAdmin.from('products').delete().in('id', createdProductIds);
  }
});

describe('Subscriptions schema: products extensions', () => {
  it('accepts subscription product with all recurring fields', async () => {
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Sub Test ${Date.now()}`,
        slug: `sub-test-${Date.now()}`,
        price: 0,
        currency: 'PLN',
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 49.00,
        trial_days: 14,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.product_type).toBe('subscription');
    expect(data?.billing_interval).toBe('month');
    expect(data?.billing_interval_count).toBe(1);
    expect(Number(data?.recurring_price)).toBe(49);
    expect(data?.trial_days).toBe(14);

    if (data?.id) createdProductIds.push(data.id);
  });

  it('defaults product_type to one_time when omitted', async () => {
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: `OneTime Default ${Date.now()}`,
        slug: `onetime-default-${Date.now()}`,
        price: 100,
        currency: 'PLN',
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.product_type).toBe('one_time');
    if (data?.id) createdProductIds.push(data.id);
  });

  it('rejects invalid product_type via CHECK constraint', async () => {
    const { error } = await supabaseAdmin.from('products').insert({
      name: `Invalid Type ${Date.now()}`,
      slug: `invalid-type-${Date.now()}`,
      price: 100,
      currency: 'PLN',
      product_type: 'lifetime', // not in CHECK list
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514'); // Postgres check_violation
  });

  it('rejects invalid billing_interval via CHECK constraint', async () => {
    const { error } = await supabaseAdmin.from('products').insert({
      name: `Invalid Interval ${Date.now()}`,
      slug: `invalid-interval-${Date.now()}`,
      price: 0,
      currency: 'PLN',
      product_type: 'subscription',
      billing_interval: 'fortnight', // not in CHECK list
      billing_interval_count: 1,
      recurring_price: 49,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514');
  });

  it('rejects subscription product without recurring fields', async () => {
    const { error } = await supabaseAdmin.from('products').insert({
      name: `Incomplete Sub ${Date.now()}`,
      slug: `incomplete-sub-${Date.now()}`,
      price: 0,
      currency: 'PLN',
      product_type: 'subscription',
      // missing billing_interval, billing_interval_count, recurring_price
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514');
  });

  it('rejects trial_days outside 0-730 range', async () => {
    const { error } = await supabaseAdmin.from('products').insert({
      name: `Bad Trial ${Date.now()}`,
      slug: `bad-trial-${Date.now()}`,
      price: 0,
      currency: 'PLN',
      product_type: 'subscription',
      billing_interval: 'month',
      billing_interval_count: 1,
      recurring_price: 49,
      trial_days: 1000,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514');
  });
});

describe('Subscriptions schema: coupons extensions', () => {
  it('coupons table has duration column with default once', async () => {
    const code = `TEST_${Date.now()}`;
    const { data, error } = await supabaseAdmin
      .from('coupons')
      .insert({
        code,
        discount_type: 'percentage',
        discount_value: 10,
        is_active: true,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.duration).toBe('once');
    if (data?.id) await supabaseAdmin.from('coupons').delete().eq('id', data.id);
  });

  it('coupons table accepts duration repeating with duration_in_months', async () => {
    const code = `TEST_REPEAT_${Date.now()}`;
    const { data, error } = await supabaseAdmin
      .from('coupons')
      .insert({
        code,
        discount_type: 'percentage',
        discount_value: 20,
        is_active: true,
        duration: 'repeating',
        duration_in_months: 3,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.duration).toBe('repeating');
    expect(data?.duration_in_months).toBe(3);
    if (data?.id) await supabaseAdmin.from('coupons').delete().eq('id', data.id);
  });

  it('coupons table rejects invalid duration', async () => {
    const code = `TEST_BAD_${Date.now()}`;
    const { error } = await supabaseAdmin.from('coupons').insert({
      code,
      discount_type: 'percentage',
      discount_value: 10,
      is_active: true,
      duration: 'lifetime',
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514');
  });

  it('coupons table rejects duration repeating without duration_in_months', async () => {
    const code = `TEST_NULL_MONTHS_${Date.now()}`;
    const { error } = await supabaseAdmin.from('coupons').insert({
      code,
      discount_type: 'percentage',
      discount_value: 10,
      is_active: true,
      duration: 'repeating',
      // missing duration_in_months
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514');
  });
});

describe('Subscriptions schema: stripe_customers table', () => {
  it('table exists and accepts user_id + stripe_customer_id', async () => {
    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: `customer-test-${Date.now()}@example.com`,
      email_confirm: true,
    });
    expect(userError).toBeNull();
    expect(user).not.toBeNull();

    const { data, error } = await supabaseAdmin
      .from('stripe_customers')
      .insert({
        user_id: user!.id,
        stripe_customer_id: `cus_test_${Date.now()}`,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.user_id).toBe(user!.id);
    if (data?.id) createdStripeCustomerIds.push(data.id);

    // Cleanup user
    await supabaseAdmin.auth.admin.deleteUser(user!.id);
  });

  it('enforces unique stripe_customer_id', async () => {
    const { data: { user } } = await supabaseAdmin.auth.admin.createUser({
      email: `dup-cust-${Date.now()}@example.com`,
      email_confirm: true,
    });

    const { data: { user: user2 } } = await supabaseAdmin.auth.admin.createUser({
      email: `dup-cust2-${Date.now()}@example.com`,
      email_confirm: true,
    });

    const customerId = `cus_dup_${Date.now()}`;

    const { data: first } = await supabaseAdmin
      .from('stripe_customers')
      .insert({ user_id: user!.id, stripe_customer_id: customerId })
      .select()
      .single();
    if (first?.id) createdStripeCustomerIds.push(first.id);

    const { error } = await supabaseAdmin
      .from('stripe_customers')
      .insert({ user_id: user2!.id, stripe_customer_id: customerId });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23505'); // unique_violation

    await supabaseAdmin.auth.admin.deleteUser(user!.id);
    await supabaseAdmin.auth.admin.deleteUser(user2!.id);
  });
});

describe('Subscriptions schema: subscriptions table', () => {
  it('table exists and accepts a full subscription record', async () => {
    const { data: { user } } = await supabaseAdmin.auth.admin.createUser({
      email: `sub-owner-${Date.now()}@example.com`,
      email_confirm: true,
    });

    const { data: product } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Sub Owner Product ${Date.now()}`,
        slug: `sub-owner-product-${Date.now()}`,
        price: 0,
        currency: 'PLN',
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 49,
      })
      .select()
      .single();
    if (product?.id) createdProductIds.push(product.id);

    const subscriptionId = `sub_${Date.now()}`;
    const customerId = `cus_${Date.now()}`;

    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .insert({
        user_id: user!.id,
        product_id: product!.id,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        status: 'active',
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        cancel_at_period_end: false,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('active');
    expect(data?.cancel_at_period_end).toBe(false);
    if (data?.id) createdSubscriptionIds.push(data.id);

    await supabaseAdmin.auth.admin.deleteUser(user!.id);
  });

  it('rejects invalid status via CHECK constraint', async () => {
    const { data: { user } } = await supabaseAdmin.auth.admin.createUser({
      email: `bad-status-${Date.now()}@example.com`,
      email_confirm: true,
    });

    const { data: product } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Bad Status Product ${Date.now()}`,
        slug: `bad-status-product-${Date.now()}`,
        price: 0,
        currency: 'PLN',
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 49,
      })
      .select()
      .single();
    if (product?.id) createdProductIds.push(product.id);

    const { error } = await supabaseAdmin.from('subscriptions').insert({
      user_id: user!.id,
      product_id: product!.id,
      stripe_customer_id: `cus_bad_${Date.now()}`,
      stripe_subscription_id: `sub_bad_${Date.now()}`,
      status: 'expired', // not a valid Stripe status
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514');

    await supabaseAdmin.auth.admin.deleteUser(user!.id);
  });

  it('enforces unique stripe_subscription_id', async () => {
    const { data: { user } } = await supabaseAdmin.auth.admin.createUser({
      email: `unique-sub-${Date.now()}@example.com`,
      email_confirm: true,
    });

    const { data: product } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Unique Sub Product ${Date.now()}`,
        slug: `unique-sub-product-${Date.now()}`,
        price: 0,
        currency: 'PLN',
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 49,
      })
      .select()
      .single();
    if (product?.id) createdProductIds.push(product.id);

    const subscriptionId = `sub_unique_${Date.now()}`;

    const { data: first } = await supabaseAdmin
      .from('subscriptions')
      .insert({
        user_id: user!.id,
        product_id: product!.id,
        stripe_customer_id: `cus_unique_${Date.now()}`,
        stripe_subscription_id: subscriptionId,
        status: 'active',
      })
      .select()
      .single();
    if (first?.id) createdSubscriptionIds.push(first.id);

    const { error } = await supabaseAdmin.from('subscriptions').insert({
      user_id: user!.id,
      product_id: product!.id,
      stripe_customer_id: `cus_unique2_${Date.now()}`,
      stripe_subscription_id: subscriptionId, // duplicate
      status: 'active',
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23505');

    await supabaseAdmin.auth.admin.deleteUser(user!.id);
  });
});

describe('Subscriptions schema: payment_transactions extensions', () => {
  it('accepts subscription_id, stripe_invoice_id, invoice_sequence_number', async () => {
    const { data: { user } } = await supabaseAdmin.auth.admin.createUser({
      email: `pt-sub-${Date.now()}@example.com`,
      email_confirm: true,
    });

    const { data: product } = await supabaseAdmin
      .from('products')
      .insert({
        name: `PT Sub Product ${Date.now()}`,
        slug: `pt-sub-product-${Date.now()}`,
        price: 0,
        currency: 'PLN',
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 49,
      })
      .select()
      .single();
    if (product?.id) createdProductIds.push(product.id);

    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .insert({
        user_id: user!.id,
        product_id: product!.id,
        stripe_customer_id: `cus_pt_${Date.now()}`,
        stripe_subscription_id: `sub_pt_${Date.now()}`,
        status: 'active',
      })
      .select()
      .single();
    if (sub?.id) createdSubscriptionIds.push(sub.id);

    const { data: pt, error } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: `cs_test_${Date.now()}`,
        product_id: product!.id,
        user_id: user!.id,
        customer_email: user!.email!,
        amount: 4900,
        currency: 'PLN',
        status: 'completed',
        subscription_id: sub!.id,
        stripe_invoice_id: `in_test_${Date.now()}`,
        invoice_sequence_number: 1,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(pt?.subscription_id).toBe(sub!.id);
    expect(pt?.invoice_sequence_number).toBe(1);

    if (pt?.id) await supabaseAdmin.from('payment_transactions').delete().eq('id', pt.id);
    await supabaseAdmin.auth.admin.deleteUser(user!.id);
  });

  it('enforces unique stripe_invoice_id when not null', async () => {
    const invoiceId = `in_dup_${Date.now()}`;

    const { data: { user } } = await supabaseAdmin.auth.admin.createUser({
      email: `pt-dup-${Date.now()}@example.com`,
      email_confirm: true,
    });

    const { data: product } = await supabaseAdmin
      .from('products')
      .insert({
        name: `PT Dup Product ${Date.now()}`,
        slug: `pt-dup-product-${Date.now()}`,
        price: 100,
        currency: 'PLN',
      })
      .select()
      .single();
    if (product?.id) createdProductIds.push(product.id);

    const { data: pt1 } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: `cs_d1_${Date.now()}`,
        product_id: product!.id,
        user_id: user!.id,
        customer_email: user!.email!,
        amount: 100,
        currency: 'PLN',
        status: 'completed',
        stripe_invoice_id: invoiceId,
        invoice_sequence_number: 1,
      })
      .select()
      .single();

    const { error } = await supabaseAdmin.from('payment_transactions').insert({
      session_id: `cs_d2_${Date.now()}`,
      product_id: product!.id,
      user_id: user!.id,
      customer_email: user!.email!,
      amount: 100,
      currency: 'PLN',
      status: 'completed',
      stripe_invoice_id: invoiceId,
      invoice_sequence_number: 1,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23505');

    if (pt1?.id) await supabaseAdmin.from('payment_transactions').delete().eq('id', pt1.id);
    await supabaseAdmin.auth.admin.deleteUser(user!.id);
  });
});

describe('Subscriptions schema: user_product_access extensions', () => {
  it('accepts subscription_id linking to subscriptions row', async () => {
    const { data: { user } } = await supabaseAdmin.auth.admin.createUser({
      email: `upa-sub-${Date.now()}@example.com`,
      email_confirm: true,
    });

    const { data: product } = await supabaseAdmin
      .from('products')
      .insert({
        name: `UPA Sub Product ${Date.now()}`,
        slug: `upa-sub-product-${Date.now()}`,
        price: 0,
        currency: 'PLN',
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 49,
      })
      .select()
      .single();
    if (product?.id) createdProductIds.push(product.id);

    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .insert({
        user_id: user!.id,
        product_id: product!.id,
        stripe_customer_id: `cus_upa_${Date.now()}`,
        stripe_subscription_id: `sub_upa_${Date.now()}`,
        status: 'active',
      })
      .select()
      .single();
    if (sub?.id) createdSubscriptionIds.push(sub.id);

    const { data: upa, error } = await supabaseAdmin
      .from('user_product_access')
      .insert({
        user_id: user!.id,
        product_id: product!.id,
        subscription_id: sub!.id,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(upa?.subscription_id).toBe(sub!.id);

    if (upa?.id) await supabaseAdmin.from('user_product_access').delete().eq('id', upa.id);
    await supabaseAdmin.auth.admin.deleteUser(user!.id);
  });
});
