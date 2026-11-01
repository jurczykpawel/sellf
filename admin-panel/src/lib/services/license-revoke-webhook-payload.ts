/**
 * Safe metadata for committed license status notifications.
 * @see src/lib/services/business-events.ts
 * @see supabase/migrations/20261101141003_license_dispute_restoration.sql
 */

export interface RevokedLicenseRow {
  id: string;
  product_id: string;
  email: string | null;
  order_id: string;
  /** Null once the issuing seller's own account has since been deleted (the license record is kept; the account reference is not). */
  seller_id: string | null;
  original_seller_id: string;
  license_domain: string | null;
  issuance_source: string;
  issued_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  products: { name: string | null; slug: string | null; license_tier: string | null } | null;
}

export interface LicenseRevokeWebhookData {
  license: {
    id: string;
    order: string;
    email: string | null;
    tier: string | null;
    domain: string | null;
    issuanceSource: string;
    issuedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
  };
  product: { id: string; name: string | null; slug: string | null };
  /** Seller-scoped revocation list the consumer hashes its `order` claim against. */
  crlUrl: string;
}

export function buildLicenseRevokeWebhookData(
  row: RevokedLicenseRow,
  origin: string,
): LicenseRevokeWebhookData {
  return {
    license: {
      id: row.id,
      order: row.order_id,
      email: row.email,
      tier: row.products?.license_tier ?? null,
      domain: row.license_domain,
      issuanceSource: row.issuance_source,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    },
    product: { id: row.product_id, name: row.products?.name ?? null, slug: row.products?.slug ?? null },
    crlUrl: `${origin}/api/licenses/revoked?seller=${row.original_seller_id}`,
  };
}

export interface LicenseRestoreWebhookData extends Omit<LicenseRevokeWebhookData, 'license'> {
  license: LicenseRevokeWebhookData['license'] & { restoredAt: string };
}

/** Restoration retains the signed license identity and original expiration. */
export function buildLicenseRestoreWebhookData(
  row: RevokedLicenseRow,
  origin: string,
  restoredAt: string,
): LicenseRestoreWebhookData {
  const data = buildLicenseRevokeWebhookData(row, origin);
  return { ...data, license: { ...data.license, restoredAt } };
}
