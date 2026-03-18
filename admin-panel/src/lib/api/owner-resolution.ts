/**
 * Shared owner resolution for API key routes.
 * Determines whether the caller is a platform admin or seller admin
 * and returns the corresponding owner ID for API key filtering.
 */

import { createPlatformClient } from '@/lib/supabase/admin';
import type { AdminRole } from '@/lib/auth-server';

interface OwnerInfo {
  role: AdminRole;
  sellerId?: string;
  adminId?: string;
}

export async function resolveApiKeyOwner(
  userId: string,
  role: AdminRole,
): Promise<OwnerInfo | null> {
  const platform = createPlatformClient();

  if (role === 'seller_admin') {
    const { data } = await platform
      .from('sellers')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();
    return data ? { role, sellerId: data.id } : null;
  }

  const { data: admin } = await platform
    .from('admin_users')
    .select('id')
    .eq('user_id', userId)
    .single();
  return admin ? { role, adminId: admin.id } : null;
}
