import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

import { signLicense, type LicenseClaims } from '@/lib/license-keys/format';
import { normalizeLicenseDomain } from '@/lib/license-keys/domain';
import { loadActiveSellerKey } from '@/lib/license-keys/keys';
import { checkFeature } from '@/lib/license/resolve';
import {
  customFieldClaimName,
  PREDEFINED_CUSTOM_FIELDS,
  validateCustomFieldDefinitions,
  validateCustomFieldValues,
} from '@/lib/validations/custom-checkout-fields';

export interface IssueLicenseInput {
  productId: string;
  email: string;
  userId: string | null;
  orderId: string;
  customFieldValues?: Record<string, string>;
  domain?: string;
  source?: 'purchase' | 'manual';
}

interface ProductLicenseRow {
  seller_id: string | null;
  slug: string;
  issue_license_on_purchase: boolean;
  license_tier: string | null;
  license_duration_days: number | null;
  custom_checkout_fields: unknown;
}

export interface IssueLicenseResult {
  id?: string;
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
    .select('id, license_key, kid, seller_id')
    .eq('order_id', input.orderId)
    .eq('product_id', input.productId)
    .maybeSingle();
  const existing = (existingResult.data ?? null) as { id?: string; license_key: string; kid: string; seller_id: string } | null;
  if (existing) return { id: existing.id, token: existing.license_key, kid: existing.kid, sellerId: existing.seller_id };

  const productResult = await admin
    .from('products')
    .select('seller_id, slug, issue_license_on_purchase, license_tier, license_duration_days, custom_checkout_fields')
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
  if (input.domain !== undefined) {
    const domain = normalizeLicenseDomain(input.domain);
    if (!domain) throw new Error('issueLicense: Invalid domain');
    claims.domain = domain;
  }

  const definitions = validateCustomFieldDefinitions(product.custom_checkout_fields ?? []);
  if (!definitions.ok) {
    throw new Error('issueLicense: Invalid custom field definitions');
  }
  const values = validateCustomFieldValues(
    definitions.value,
    input.customFieldValues ?? {},
    { requireAll: input.customFieldValues !== undefined },
  );
  if (!values.ok) {
    throw new Error('issueLicense: Invalid custom field values');
  }
  for (const field of definitions.value) {
    const value = values.values[field.id];
    if (!value) continue;
    if (field.id === PREDEFINED_CUSTOM_FIELDS.license_domain.id) {
      claims.domain = value;
      continue;
    }
    const claim = customFieldClaimName(field.id);
    if (claim) claims[claim] = value;
  }
  const token = signLicense(claims, key.privateKeyPem);

  const licenseId = randomUUID();
  const { error } = await admin.from('issued_licenses').insert({
    id: licenseId,
    seller_id: product.seller_id,
    product_id: input.productId,
    email: input.email,
    user_id: input.userId,
    order_id: input.orderId,
    kid: key.kid,
    license_key: token,
    expires_at: exp ? new Date(exp * 1000).toISOString() : null,
    issuance_source: input.source ?? 'purchase',
    license_domain: claims.domain ?? null,
  });

  if (error) {
    // 23505 = unique_violation: concurrent webhook delivered the same event.
    // Re-read the row inserted by the other request and return it idempotently.
    if (error.code === '23505') {
      const raceResult = await admin
        .from('issued_licenses')
        .select('id, license_key, kid, seller_id')
        .eq('order_id', input.orderId)
        .eq('product_id', input.productId)
        .maybeSingle();
      const winner = (raceResult.data ?? null) as { id?: string; license_key: string; kid: string; seller_id: string } | null;
      if (winner) return { id: winner.id, token: winner.license_key, kid: winner.kid, sellerId: winner.seller_id };
    }
    throw new Error(`issueLicense: ${error.message}`);
  }

  return { id: licenseId, token, kid: key.kid, sellerId: product.seller_id };
}
