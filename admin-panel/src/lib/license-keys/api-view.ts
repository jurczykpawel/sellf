/** Public API shape of an issued license (API v1). The token is included only when explicitly requested. */
export const LICENSE_API_FIELDS = 'id, product_id, email, order_id, kid, issued_at, expires_at, revoked_at, revoked_by_dispute_id, issuance_source, license_domain, original_seller_id, products(name, slug, license_tier)';

export interface LicenseApiRow {
  id: string;
  product_id: string;
  email: string | null;
  order_id: string;
  kid: string;
  issued_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by_dispute_id: string | null;
  issuance_source: string;
  license_domain: string | null;
  original_seller_id: string;
  products: { name: string | null; slug: string | null; license_tier: string | null } | null;
  license_key?: string;
}

export type LicenseStatus = 'active' | 'expired' | 'revoked';

export function licenseStatus(row: Pick<LicenseApiRow, 'revoked_at' | 'expires_at'>, now = new Date()): LicenseStatus {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at) <= now) return 'expired';
  return 'active';
}

export function toLicenseApiView(row: LicenseApiRow, origin: string) {
  return {
    id: row.id,
    productId: row.product_id,
    product: { name: row.products?.name ?? null, slug: row.products?.slug ?? null },
    email: row.email,
    order: row.order_id,
    kid: row.kid,
    tier: row.products?.license_tier ?? null,
    domain: row.license_domain,
    issuanceSource: row.issuance_source,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedByDisputeId: row.revoked_by_dispute_id,
    status: licenseStatus(row),
    jwksUrl: `${origin}/api/licenses/jwks?seller=${row.original_seller_id}`,
    crlUrl: `${origin}/api/licenses/revoked?seller=${row.original_seller_id}`,
    ...(row.license_key !== undefined && { token: row.license_key }),
  };
}
