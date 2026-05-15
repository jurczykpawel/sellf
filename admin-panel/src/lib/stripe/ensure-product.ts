import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

// Loose typing: this helper only touches the `products` table and is used
// from both the seller_main-scoped admin client and the public-scoped client
// in different code paths. We keep the generic open and validate at runtime
// via the .update() error path.
type AnyClient = SupabaseClient<any, any, any, any, any>;

export interface EnsureStripeProductInput {
  stripe: Stripe;
  dataClient: AnyClient;
  product: {
    id: string;
    name: string;
    stripe_product_id?: string | null;
  };
}

// Returns the persisted Stripe Product ID for a Sellf product, creating it
// on first use. Used by createSubscriptionWithDynamicPrice (Phase 3c) because
// stripe.subscriptions.create.items.price_data rejects inline product_data —
// it requires a pre-existing Stripe Product id.
//
// The Stripe Product is cheap and persistent: name/metadata can be updated
// later (Phase 8+) but the id stays stable across price changes / PWYW
// amounts. Caching it on products.stripe_product_id avoids one extra Stripe
// API round-trip per subscription create.
export async function ensureStripeProduct(
  input: EnsureStripeProductInput,
): Promise<string> {
  if (input.product.stripe_product_id) return input.product.stripe_product_id;

  const created = await input.stripe.products.create({
    name: input.product.name,
    metadata: { sellf_product_id: input.product.id },
  });

  const { error } = await input.dataClient
    .from('products')
    .update({ stripe_product_id: created.id })
    .eq('id', input.product.id);
  if (error) {
    // Best effort — log + continue. Next call will re-create a Stripe Product;
    // that's wasteful but not user-facing.
    console.error(
      '[ensureStripeProduct] failed to persist stripe_product_id for %s:',
      input.product.id,
      error,
    );
  }

  return created.id;
}
