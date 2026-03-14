import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'

/**
 * Creates a Supabase client with the Service Role key targeting seller_main schema.
 * CRITICAL: This client bypasses RLS. ONLY use in secure server-side environments (API routes, server actions)
 * after verifying that the requesting user has the necessary permissions.
 *
 * Default schema: seller_main (where all shop tables live).
 * For platform-only tables in public schema (admin_users, rate_limits, api_keys, etc.),
 * use `createPlatformClient()` instead.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is not defined. Admin client cannot be created.')
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined. Admin client cannot be created.')
  }

  return createSupabaseClient<Database, 'seller_main'>(
    supabaseUrl,
    serviceRoleKey,
    {
      db: {
        schema: 'seller_main',
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}

/**
 * Creates a Supabase client with the Service Role key targeting public schema.
 * Use for platform-only tables: admin_users, admin_actions, audit_log, rate_limits,
 * application_rate_limits, api_keys, api_key_audit_log, tracking_logs, _migration_history.
 * Also use for public-schema RPC functions: verify_api_key, check_rate_limit,
 * check_application_rate_limit, is_admin, etc.
 */
export function createPlatformClient() {
  const supabaseUrl = process.env.SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is not defined. Platform client cannot be created.')
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined. Platform client cannot be created.')
  }

  return createSupabaseClient<Database, 'public'>(
    supabaseUrl,
    serviceRoleKey,
    {
      db: {
        schema: 'public',
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}