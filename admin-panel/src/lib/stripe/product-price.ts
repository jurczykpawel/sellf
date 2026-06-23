/**
 * Durable Stripe Price binding per Sellf subscription product.
 *
 * Stripe Prices are immutable. The first time a subscription product is
 * checked out we create a Price and persist its id on the product row.
 * Subsequent checkouts reuse the same id, and webhook handlers use the
 * stored Price id as the durable product binding for subscription events.
 *
 * If admin edits `recurring_price`, `currency`, `billing_interval`,
 * `billing_interval_count`, or `price_includes_vat` (brutto/netto) after first
 * checkout, the persisted Price no longer matches; a new Price is created and the
 * column is updated. Old Stripe Prices are deactivated (Stripe doesn't support
 * delete on prices used by subs). `tax_behavior` is immutable on a Price, so a
 * brutto↔netto change can only be applied by rolling to a new Price.
 *
 * @see /supabase/migrations/20260430142135_subscriptions_mvp.sql
 * @see /app/api/webhooks/stripe/subscription-handlers.ts
 */

import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

interface ProductForPrice {
  id: string;
  name: string;
  currency: string;
  recurring_price: number | null;
  billing_interval: 'day' | 'week' | 'month' | 'year' | null;
  billing_interval_count: number | null;
  stripe_price_id: string | null;
  price_includes_vat: boolean;
}

export function priceMatchesProduct(stripePrice: Stripe.Price, product: ProductForPrice): boolean {
  if (!stripePrice.active) return false;
  const expectedAmount = Math.round((product.recurring_price ?? 0) * 100);
  if (stripePrice.unit_amount !== expectedAmount) return false;
  if (stripePrice.currency.toLowerCase() !== product.currency.toLowerCase()) return false;
  if (stripePrice.recurring?.interval !== product.billing_interval) return false;
  if ((stripePrice.recurring?.interval_count ?? 1) !== (product.billing_interval_count ?? 1)) {
    return false;
  }
  // tax_behavior is immutable on a Price, so a brutto↔netto change — or a legacy Price
  // created before we set it (tax_behavior='unspecified') — must roll to a new Price. This
  // is what lets Stripe Tax (stripe_tax mode) treat the recurring price as inclusive/exclusive.
  const expectedBehavior = product.price_includes_vat ? 'inclusive' : 'exclusive';
  if (stripePrice.tax_behavior !== expectedBehavior) return false;
  return true;
}

export async function getOrCreateStripePriceForProduct(
  stripe: Stripe,
  product: ProductForPrice
): Promise<string> {
  // Service-role admin client is created here so callers in lib/actions/
  // don't import createAdminClient directly (rbac-page-access test enforces this).
  const supabase = createAdminClient();
  if (
    !product.recurring_price ||
    !product.billing_interval ||
    !product.billing_interval_count
  ) {
    throw new Error(
      'getOrCreateStripePriceForProduct: product is missing required recurring fields'
    );
  }

  // Reuse if persisted id still matches.
  if (product.stripe_price_id) {
    try {
      const existing = await stripe.prices.retrieve(product.stripe_price_id);
      if (priceMatchesProduct(existing, product)) {
        return product.stripe_price_id;
      }
      // Drift: deactivate the old Price (Stripe disallows deletion when used by subs).
      try {
        await stripe.prices.update(product.stripe_price_id, { active: false });
      } catch (deactivateErr) {
        console.warn(
          '[getOrCreateStripePriceForProduct] could not deactivate stale price:',
          deactivateErr
        );
      }
    } catch (err) {
      console.warn(
        '[getOrCreateStripePriceForProduct] could not retrieve persisted price, will recreate:',
        err
      );
    }
  }

  const created = await stripe.prices.create({
    unit_amount: Math.round(product.recurring_price * 100),
    currency: product.currency.toLowerCase(),
    // inclusive/exclusive so Stripe Tax (stripe_tax mode) treats the recurring price as
    // brutto/netto per the product setting — consistent with the one-time line builder.
    // In local mode the manual tax_rate (same inclusive flag) carries the tax; the two agree.
    tax_behavior: product.price_includes_vat ? 'inclusive' : 'exclusive',
    recurring: {
      interval: product.billing_interval,
      interval_count: product.billing_interval_count,
    },
    product_data: {
      name: product.name,
      metadata: { sellf_product_id: product.id },
    },
    metadata: { sellf_product_id: product.id },
  });

  const { error } = await supabase
    .from('products')
    .update({ stripe_price_id: created.id })
    .eq('id', product.id);
  if (error) {
    console.error('[getOrCreateStripePriceForProduct] persist error:', error);
    throw new Error(`Could not persist stripe_price_id: ${error.message}`);
  }

  return created.id;
}
