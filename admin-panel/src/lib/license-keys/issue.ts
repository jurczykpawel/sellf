import type { SupabaseClient } from '@supabase/supabase-js';

import { signLicense, type LicenseClaims } from '@/lib/license-keys/format';
import { loadActiveSellerKey } from '@/lib/license-keys/keys';
import { checkFeature } from '@/lib/license/resolve';

export interface IssueLicenseInput {
  productId: string;
  email: string;
  userId: string | null;
  orderId: string;
}

interface ProductLicenseRow {
  seller_id: string | null;
  slug: string;
  issue_license_on_purchase: boolean;
  license_tier: string | null;
  license_duration_days: number | null;
}

export interface IssueLicenseResult {
  token: string;
  kid: string;
  sellerId: string;
}

/**
 * Issue a signed license for a completed purchase. Returns the license token
 * plus the kid and seller ID needed to build a JWKS verification URL, or null
 * when the product has issuance disabled, is unknown, or the seller has no
 * active key. Idempotent on (order_id, product_id): a retry returns the
 * already-issued result without signing or inserting again.
 */
export async function issueLicense(
  admin: SupabaseClient,
  input: IssueLicenseInput,
  opts: { now?: Date } = {},
): Promise<IssueLicenseResult | null> {
  if (!(await checkFeature('license-key-issuance', { dataClient: admin }))) return null;

  const existingResult = await admin
    .from('issued_licenses')
    .select('license_key, kid, seller_id')
    .eq('order_id', input.orderId)
    .eq('product_id', input.productId)
    .maybeSingle();
  const existing = (existingResult.data ?? null) as { license_key: string; kid: string; seller_id: string } | null;
  if (existing) return { token: existing.license_key, kid: existing.kid, sellerId: existing.seller_id };

  const productResult = await admin
    .from('products')
    .select('seller_id, slug, issue_license_on_purchase, license_tier, license_duration_days')
    .eq('id', input.productId)
    .maybeSingle();
  const product = (productResult.data ?? null) as ProductLicenseRow | null;
  if (!product || !product.issue_license_on_purchase) return null;
  if (!product.seller_id) {
    console.warn('[issueLicense] product.seller_id is null — license skipped. Run the backfill migration to fix existing products.');
    return null;
  }

  const key = await loadActiveSellerKey(admin, product.seller_id);
  if (!key) return null;

  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const exp = product.license_duration_days ? iat + product.license_duration_days * 86400 : null;
  const claims: LicenseClaims = {
    v: 1,
    kid: key.kid,
    product: product.slug,
    email: input.email,
    order: input.orderId,
    tier: product.license_tier,
    iat,
    exp,
  };
  const token = signLicense(claims, key.privateKeyPem);

  const { error } = await admin.from('issued_licenses').insert({
    seller_id: product.seller_id,
    product_id: input.productId,
    email: input.email,
    user_id: input.userId,
    order_id: input.orderId,
    kid: key.kid,
    license_key: token,
    expires_at: exp ? new Date(exp * 1000).toISOString() : null,
  });

  if (error) {
    // 23505 = unique_violation: concurrent webhook delivered the same event.
    // Re-read the row inserted by the other request and return it idempotently.
    if (error.code === '23505') {
      const raceResult = await admin
        .from('issued_licenses')
        .select('license_key, kid, seller_id')
        .eq('order_id', input.orderId)
        .eq('product_id', input.productId)
        .maybeSingle();
      const winner = (raceResult.data ?? null) as { license_key: string; kid: string; seller_id: string } | null;
      if (winner) return { token: winner.license_key, kid: winner.kid, sellerId: winner.seller_id };
    }
    throw new Error(`issueLicense: ${error.message}`);
  }

  return { token, kid: key.kid, sellerId: product.seller_id };
}
