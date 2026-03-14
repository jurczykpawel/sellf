'use server';

/**
 * Centralized admin authentication helper for server actions.
 *
 * Replaces the duplicated Pattern B (manual getUser + admin_users query)
 * found across gus-config, currency-config, shop-config, payment, payment-config, etc.
 *
 * Usage:
 *   import { withAdminAuth } from '@/lib/actions/admin-auth';
 *
 *   export async function myAction(input: MyInput): Promise<ActionResponse<MyData>> {
 *     return withAdminAuth(async ({ user, supabase }) => {
 *       // ... business logic ...
 *       return { success: true, data: result };
 *     });
 *   }
 *
 * @see /lib/auth-server.ts — requireAdminApi (throws on failure, for API routes)
 * @see /lib/demo-guard.ts — isDemoMode (checked before auth)
 */

import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';

export interface AdminAuthContext {
  user: User;
  supabase: SupabaseClient;
}

export interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}

/**
 * Wraps a server action with admin authentication.
 *
 * 1. Creates Supabase client (cookie-based session)
 * 2. Verifies user is authenticated via getUser()
 * 3. Verifies user is admin via admin_users table
 * 4. Calls the provided function with { user, supabase } context
 * 5. Catches errors and returns generic error response
 *
 * Returns `{ success: false, errorCode: 'UNAUTHORIZED' | 'FORBIDDEN' }` on auth failure.
 */
export async function withAdminAuth<T>(
  fn: (ctx: AdminAuthContext) => Promise<ActionResponse<T>>
): Promise<ActionResponse<T>> {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: 'Unauthorized - no user session',
        errorCode: 'UNAUTHORIZED',
      };
    }

    const { data: adminCheck } = await supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .single();

    if (!adminCheck) {
      return {
        success: false,
        error: 'Forbidden - admin access required',
        errorCode: 'FORBIDDEN',
      };
    }

    return await fn({ user, supabase });
  } catch (error) {
    console.error('[withAdminAuth] Unexpected error:', error);
    return {
      success: false,
      error: 'An unexpected error occurred',
      errorCode: 'UNKNOWN_ERROR',
    };
  }
}
