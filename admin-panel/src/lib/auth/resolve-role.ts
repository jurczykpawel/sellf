import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import type { UserRole } from '@/types/auth'

/**
 * Resolves the current session's role by calling the `is_admin` RPC.
 * Retries transient errors with linear backoff; falls back to 'user'
 * if every attempt fails.
 *
 * Uses the uncached `is_admin` function (not `is_admin_cached`) so that a
 * change in admin status is reflected on the next auth state change
 * instead of persisting for the lifetime of a pooled DB connection.
 */
export async function resolveUserRole(
  supabase: SupabaseClient<Database>,
  retries = 3
): Promise<UserRole> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data: isAdminData, error } = await supabase.rpc('is_admin')

      if (error) {
        if (attempt === retries) return 'user'
        await new Promise(resolve => setTimeout(resolve, attempt * 1000))
        continue
      }

      return isAdminData ? 'platform_admin' : 'user'
    } catch {
      if (attempt === retries) return 'user'
      await new Promise(resolve => setTimeout(resolve, attempt * 1000))
    }
  }

  return 'user'
}
