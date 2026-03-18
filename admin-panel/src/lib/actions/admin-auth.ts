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
import { createAdminClient, createPlatformClient } from '@/lib/supabase/admin';
import { createSellerAdminClient } from '@/lib/marketplace/seller-client';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AdminRole } from '@/lib/auth-server';
import type { SellerDataClient } from '@/lib/supabase/admin';

interface AdminAuthContext {
  user: User;
  supabase: SupabaseClient;
}

/** Extended context for withAdminOrSellerAuth — includes role and schema-scoped data client. */
interface AdminOrSellerAuthContext {
  user: User;
  /** Cookie-based session client (default schema). Use dataClient for seller-scoped queries. */
  supabase: SupabaseClient;
  role: AdminRole;
  /** Service-role client scoped to seller schema (seller admins) or seller_main (platform admins). */
  dataClient: SellerDataClient;
  /** Seller schema name (only for seller_admin role). */
  sellerSchema?: string;
  /** Seller slug (only for seller_admin role). */
  sellerSlug?: string;
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

/**
 * Wraps a server action with admin OR seller owner authentication.
 * Platform admins get a seller_main-scoped dataClient.
 * Seller admins get a dataClient scoped to their seller schema.
 *
 * Usage:
 *   return withAdminOrSellerAuth(async ({ user, dataClient, role }) => {
 *     const { data } = await dataClient.from('products').select('*');
 *     return { success: true, data };
 *   });
 */
export async function withAdminOrSellerAuth<T>(
  fn: (ctx: AdminOrSellerAuthContext) => Promise<ActionResponse<T>>
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

    // Check platform admin first
    const { data: adminCheck } = await supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .single();

    if (adminCheck) {
      return await fn({
        user,
        supabase,
        role: 'platform_admin',
        dataClient: createAdminClient(),
      });
    }

    // Check seller owner
    const platformClient = createPlatformClient();
    const { data: seller } = await platformClient
      .from('sellers')
      .select('id, slug, schema_name, display_name')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (seller) {
      return await fn({
        user,
        supabase,
        role: 'seller_admin',
        dataClient: createSellerAdminClient(seller.schema_name) as unknown as SellerDataClient,
        sellerSchema: seller.schema_name,
        sellerSlug: seller.slug,
      });
    }

    // Neither admin nor seller
    return {
      success: false,
      error: 'Forbidden - admin or seller access required',
      errorCode: 'FORBIDDEN',
    };
  } catch (error) {
    console.error('[withAdminOrSellerAuth] Unexpected error:', error);
    return {
      success: false,
      error: 'An unexpected error occurred',
      errorCode: 'UNKNOWN_ERROR',
    };
  }
}
