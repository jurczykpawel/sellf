import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// /api/public/products/[slug]/recent-supporters
//
// Public read-only endpoint. Returns up to 10 most recent supporters merged
// from payment_transactions (one-shot, status=completed) and subscriptions
// (status IN active/trialing). PII never leaves the server: customer_email
// is dropped, customer_name is anonymized to first word or "Tajemniczy *".
//
// Cache: 5 min via unstable_cache + tag, so concurrent storefront hits don't
// hammer the DB. Rate limit: same envelope as other public API endpoints.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Each test creates a UNIQUE product so the unstable_cache (keyed by slug)
// always starts cold. Otherwise tests would race against the 5-minute cached
// list. Production cache invalidation happens via webhook revalidateTag —
// see Phase 3c.
async function createProductWithSupporters(
  txFixtures: Array<{ full_name: string; email: string; amount: number; status?: string }>,
): Promise<{ productId: string; productSlug: string; txIds: string[] }> {
  const slug = `rs-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: product, error } = await supabaseAdmin
    .from('products')
    .insert({
      name: 'Recent Supporters E2E',
      slug,
      price: 5,
      currency: 'USD',
      icon: '☕',
      is_active: true,
      checkout_template: 'tip-jar',
      allow_custom_price: true,
      custom_price_min: 1,
    })
    .select('id, slug')
    .single();
  if (error || !product) throw error;

  const txIds: string[] = [];
  for (const row of txFixtures) {
    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: `cs_test_rs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        product_id: product.id,
        customer_email: row.email,
        amount: row.amount,
        currency: 'USD',
        status: row.status ?? 'completed',
        metadata: { full_name: row.full_name },
      })
      .select('id')
      .single();
    if (tx?.id) txIds.push(tx.id);
  }

  return { productId: product.id, productSlug: product.slug, txIds };
}

async function cleanup({
  productId,
  txIds,
}: {
  productId: string;
  txIds: string[];
}): Promise<void> {
  if (txIds.length > 0) {
    await supabaseAdmin.from('payment_transactions').delete().in('id', txIds);
  }
  await supabaseAdmin.from('products').delete().eq('id', productId);
}

test.describe('Recent supporters API', () => {
  test.describe.configure({ mode: 'parallel' });

  test('returns the recent supporters list with anonymized display names', async ({ request }) => {
    const fx = await createProductWithSupporters([
      { full_name: 'Jan Kowalski', email: 'jan@example.com', amount: 10 },
      { full_name: 'Maria Wiśniewska', email: 'maria@example.com', amount: 25 },
      { full_name: '', email: 'anon@example.com', amount: 5 },
      { full_name: 'foo@bar.com', email: 'sneaky@example.com', amount: 3 },
    ]);
    try {
      const response = await request.get(`/api/public/products/${fx.productSlug}/recent-supporters`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body.supporters)).toBe(true);
      expect(body.supporters.length).toBe(4);
      const names = body.supporters.map((s: { displayName: string }) => s.displayName);
      expect(names).toContain('Jan');
      expect(names).toContain('Maria');
      const fallbacks = names.filter((n: string) => /Tajemniczy|Sekretny|Anonimowy/.test(n));
      expect(fallbacks.length).toBe(2);
    } finally {
      await cleanup(fx);
    }
  });

  test('exposes amount + currency + when + actionKey, NEVER email or full name', async ({ request }) => {
    const fx = await createProductWithSupporters([
      { full_name: 'Pawel Jurczyk', email: 'p@example.com', amount: 12 },
    ]);
    try {
      const response = await request.get(`/api/public/products/${fx.productSlug}/recent-supporters`);
      const body = await response.json();
      for (const s of body.supporters) {
        expect(typeof s.amount).toBe('number');
        expect(typeof s.currency).toBe('string');
        expect(typeof s.when).toBe('string');
        expect(typeof s.actionKey).toBe('string');
        expect(s.actionKey.startsWith('supporterActions.')).toBe(true);
        expect(s).not.toHaveProperty('email');
        expect(s).not.toHaveProperty('customer_email');
        expect(s).not.toHaveProperty('customer_name');
      }
      expect(typeof body.totalCount).toBe('number');
      expect(body.totalCount).toBe(1);
    } finally {
      await cleanup(fx);
    }
  });

  test('limits results to 10 most recent entries', async ({ request }) => {
    const fixtures = Array.from({ length: 12 }, (_, i) => ({
      full_name: `User${i} Last`,
      email: `bulk${i}@example.com`,
      amount: 1 + i,
    }));
    const fx = await createProductWithSupporters(fixtures);
    try {
      const response = await request.get(`/api/public/products/${fx.productSlug}/recent-supporters`);
      const body = await response.json();
      expect(body.supporters.length).toBe(10);
      expect(body.totalCount).toBe(12);
    } finally {
      await cleanup(fx);
    }
  });

  test('returns 404 for a non-existent product slug', async ({ request }) => {
    const response = await request.get('/api/public/products/no-such-slug-xyz/recent-supporters');
    expect(response.status()).toBe(404);
  });

  test('ignores pending / refunded / failed transactions', async ({ request }) => {
    const fx = await createProductWithSupporters([
      { full_name: 'Real Buyer', email: 'real@example.com', amount: 20 },
      { full_name: 'Should Not Show', email: 'pending@example.com', amount: 99, status: 'pending' },
      { full_name: 'Should Not Show', email: 'failed@example.com', amount: 99, status: 'failed' },
      { full_name: 'Should Not Show', email: 'refunded@example.com', amount: 99, status: 'refunded' },
    ]);
    try {
      const response = await request.get(`/api/public/products/${fx.productSlug}/recent-supporters`);
      const body = await response.json();
      const names = body.supporters.map((s: { displayName: string }) => s.displayName);
      expect(names).not.toContain('Should');
      expect(body.totalCount).toBe(1);
    } finally {
      await cleanup(fx);
    }
  });
});
