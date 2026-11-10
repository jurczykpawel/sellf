/** License options shared by the panel and user-access API. */
import { z } from 'zod';
import { hasScope } from '@/lib/api/api-keys';
import { API_SCOPES } from '@/lib/api/scope-constants';
import { licenseRequestSchema, issueRequestedLicense } from '@/lib/license-keys/request';
import type { LicenseRequestResult } from '@/lib/license-keys/request';
import type { createAdminClient } from '@/lib/supabase/admin';

export const accessLicenseSchema = z.object({
  issue_license: z.boolean().default(true),
  revoke_license: z.boolean().default(true),
  license: licenseRequestSchema.pick({ domain: true, customFieldValues: true, locale: true }).optional(),
});
export function canManageAccessLicense(scopes: string[]): boolean {
  return hasScope(scopes, API_SCOPES.LICENSES_WRITE);
}

export async function issueAccessLicense(
  admin: ReturnType<typeof createAdminClient>,
  input: { userId: string; productId: string; accessId: string; actorUserId: string; source: 'manual' | 'api'; origin: string; license?: z.infer<typeof accessLicenseSchema>['license'] },
): Promise<LicenseRequestResult> {
  const access = await admin.from('user_product_access').select('id,license_requested').eq('id', input.accessId).eq('user_id', input.userId).eq('product_id', input.productId).maybeSingle();
  if (access.error || !access.data?.license_requested) return { ok: false as const, status: 409 as const, error: 'Access grant is not available for license issuance' };
  const issued = await admin.from('issued_licenses').select('revoked_at').eq('access_grant_id', input.accessId).maybeSingle();
  if (issued.error || issued.data?.revoked_at) return { ok: false as const, status: 409 as const, error: 'License for this access grant is no longer available' };
  const buyer = await admin.auth.admin.getUserById(input.userId);
  if (buyer.error || !buyer.data.user?.email) return { ok: false as const, status: 400 as const, error: 'User email is required for license issuance' };
  return issueRequestedLicense({ productId: input.productId, email: buyer.data.user.email, ...input.license }, {
    actorUserId: input.actorUserId, source: input.source, origin: input.origin,
    accessGrantId: input.accessId, userId: input.userId,
  });
}
