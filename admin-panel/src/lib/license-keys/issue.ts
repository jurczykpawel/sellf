import type { SupabaseClient } from '@supabase/supabase-js';

import { signLicense, type LicenseClaims } from '@/lib/license-keys/format';
import { loadActiveSellerKey } from '@/lib/license-keys/keys';

export interface IssueLicenseInput {
  sellerId: string;
  productId: string;
  productSlug: string;
  email: string;
  userId: string | null;
  orderId: string;
}

interface ProductLicenseConfig {
  issue_license_on_purchase: boolean;
  license_tier: string | null;
  license_duration_days: number | null;
}

/**
 * Issue a signed license for a completed purchase. Returns the license token,
 * or null when the product has issuance disabled or the seller has no active
 * key. Idempotent on (order_id, product_id): a retry returns the already-issued
 * token without signing or inserting again.
 */
export async function issueLicense(
  admin: SupabaseClient,
  input: IssueLicenseInput,
  opts: { now?: Date } = {},
): Promise<string | null> {
  const existingResult = await admin
    .from('issued_licenses')
    .select('license_key')
    .eq('order_id', input.orderId)
    .eq('product_id', input.productId)
    .maybeSingle();
  const existing = (existingResult.data ?? null) as { license_key: string } | null;
  if (existing) return existing.license_key;

  const productResult = await admin
    .from('products')
    .select('issue_license_on_purchase, license_tier, license_duration_days')
    .eq('id', input.productId)
    .maybeSingle();
  const config = (productResult.data ?? null) as ProductLicenseConfig | null;
  if (!config || !config.issue_license_on_purchase) return null;

  const key = await loadActiveSellerKey(admin, input.sellerId);
  if (!key) return null;

  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const exp = config.license_duration_days ? iat + config.license_duration_days * 86400 : null;
  const claims: LicenseClaims = {
    v: 1,
    kid: key.kid,
    product: input.productSlug,
    email: input.email,
    order: input.orderId,
    tier: config.license_tier,
    iat,
    exp,
  };
  const token = signLicense(claims, key.privateKeyPem);

  const { error } = await admin.from('issued_licenses').insert({
    seller_id: input.sellerId,
    product_id: input.productId,
    email: input.email,
    user_id: input.userId,
    order_id: input.orderId,
    kid: key.kid,
    license_key: token,
    expires_at: exp ? new Date(exp * 1000).toISOString() : null,
  });
  if (error) throw new Error(`issueLicense: ${error.message}`);

  return token;
}
