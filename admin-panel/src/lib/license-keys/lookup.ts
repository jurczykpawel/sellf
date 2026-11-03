import type { createAdminClient } from '@/lib/supabase/admin';

export interface IssuedLicenseLookupUser {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}

export interface IssuedLicenseRow {
  license_key?: string;
  issued_at?: string;
  expires_at: string | null;
  revoked_at?: string | null;
  revoked_by_dispute_id?: string | null;
}

/** Buyer-facing license state. A revoked key carries no token so it can never look usable. */
export interface IssuedLicenseResponse {
  token: string | null;
  issuedAt: string;
  expiresAt: string | null;
  status: 'active' | 'expired' | 'revoked';
  revokedAt: string | null;
  revokedReason: 'dispute' | 'other' | null;
}

export async function findIssuedLicense(
  admin: ReturnType<typeof createAdminClient>,
  productId: string,
  user: IssuedLicenseLookupUser,
  columns = 'license_key, issued_at, expires_at, revoked_at, revoked_by_dispute_id',
): Promise<IssuedLicenseRow | null> {
  // Prefer licenses assigned to the account; guest rows need a confirmed address.
  const { data: byUser } = await admin
    .from('issued_licenses')
    .select(columns)
    .eq('product_id', productId)
    .eq('user_id', user.id)
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byUser) {
    return byUser as unknown as IssuedLicenseRow;
  }

  if (!user.email || !user.email_confirmed_at) return null;

  const { data: byEmail } = await admin
    .from('issued_licenses')
    .select(columns)
    .eq('product_id', productId)
    .is('user_id', null)
    .eq('email', user.email)
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return byEmail ? byEmail as unknown as IssuedLicenseRow : null;
}

export function toIssuedLicenseResponse(row: IssuedLicenseRow | null): IssuedLicenseResponse | null {
  if (!row?.license_key || !row.issued_at) return null;
  const revoked = Boolean(row.revoked_at);
  const expired = !revoked && Boolean(row.expires_at && new Date(row.expires_at) <= new Date());
  return {
    token: revoked ? null : row.license_key,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at ?? null,
    status: revoked ? 'revoked' : expired ? 'expired' : 'active',
    revokedAt: row.revoked_at ?? null,
    revokedReason: revoked ? (row.revoked_by_dispute_id ? 'dispute' : 'other') : null,
  };
}
