/**
 * Shared owner resolution for API key routes.
 * Returns the admin ID for API key filtering.
 */

import { createPlatformClient } from '@/lib/supabase/admin';
import type { AdminRole } from '@/lib/auth-server';

interface OwnerInfo {
  role: AdminRole;
  adminId?: string;
}

export async function resolveApiKeyOwner(
  userId: string,
  role: AdminRole,
): Promise<OwnerInfo | null> {
  const platform = createPlatformClient();

  const { data: admin } = await platform
    .from('admin_users')
    .select('id')
    .eq('user_id', userId)
    .single();
  return admin ? { role, adminId: admin.id } : null;
}
