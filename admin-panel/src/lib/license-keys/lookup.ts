import type { createAdminClient } from '@/lib/supabase/admin';

export interface IssuedLicenseLookupUser {
  id: string;
  email?: string | null;
}

export interface IssuedLicenseRow {
  license_key?: string;
  issued_at?: string;
  expires_at: string | null;
}

export interface IssuedLicenseResponse {
  token: string;
  issuedAt: string;
  expiresAt: string | null;
}

export async function findIssuedLicense(
  admin: ReturnType<typeof createAdminClient>,
  productId: string,
  user: IssuedLicenseLookupUser,
  columns = 'license_key, issued_at, expires_at',
): Promise<IssuedLicenseRow | null> {
  // Prefer match by user_id (UUID, injection-safe); fall back only to guest
  // email rows where user_id IS NULL. Do not replace this with raw .or().
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

  if (!user.email) return null;

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
  return {
    token: row.license_key,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at ?? null,
  };
}
