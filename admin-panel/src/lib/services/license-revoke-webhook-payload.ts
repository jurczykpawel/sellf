/**
 * Payload for the `license.revoked` outbound webhook.
 *
 * Fires when a seller revokes an issued product license (DELETE
 * /api/admin/licenses/:id). Consumers verify licenses OFFLINE, so this lets a
 * seller's integration react immediately (e.g. refresh its CRL, disable a
 * customer) instead of waiting for the cached revocation list to expire.
 *
 * SECURITY: the signed token (`license_key`) is NEVER projected here — the
 * builder reads only the explicit, safe columns. The CRL stays the source of
 * truth for verification; this event is a notification.
 *
 * @see ../../app/api/admin/licenses/[id]/route.ts (manual-revoke dispatch site)
 * @see ../../app/api/webhooks/stripe/route.ts (refund/chargeback dispatch site)
 * @see ../../app/api/licenses/revoked/route.ts (the CRL the consumer reads)
 */

import { checkFeature } from '@/lib/license/resolve';
import { WebhookService } from '@/lib/services/webhook-service';

export interface RevokedLicenseRow {
  id: string;
  product_id: string;
  email: string | null;
  order_id: string;
  seller_id: string;
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
    crlUrl: `${origin}/api/licenses/revoked?seller=${row.seller_id}`,
  };
}

type AdminClientLike = { from: (table: string) => unknown };

/**
 * Fire the `license.revoked` webhook for each just-revoked license. Single source
 * of truth for both revocation paths (manual admin revoke + refund/chargeback).
 *
 * Pro-gated (the whole license feature is Pro; the event is gated explicitly too),
 * checked once for the whole batch. FIRE-AND-FORGET: never throws — a webhook
 * failure must never undo a revocation, and in the Stripe path it must never cause
 * a refund/dispute event to be redelivered. The queue worker retries failed
 * deliveries on its own.
 */
export async function emitLicenseRevokedWebhooks(
  admin: AdminClientLike,
  rows: RevokedLicenseRow[],
  origin: string,
): Promise<void> {
  try {
    if (rows.length === 0) return;
    if (!(await checkFeature('license-revoked-webhook', { dataClient: admin }))) return;
    await Promise.all(
      rows.map((row) =>
        WebhookService.trigger('license.revoked', buildLicenseRevokeWebhookData(row, origin), admin, row.product_id),
      ),
    );
  } catch (err) {
    console.error('[emitLicenseRevokedWebhooks] Error:', err instanceof Error ? err.message : 'Unknown error');
  }
}
