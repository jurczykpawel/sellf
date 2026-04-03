import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'

// Module-level env vars — read once, reused by all client factories
function getSupabaseEnv() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('SUPABASE_URL is not defined')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined')
  return { url, key }
}

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
  const { url, key } = getSupabaseEnv()

  return createSupabaseClient<Database, 'seller_main'>(
    url,
    key,
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
 * Use for platform-only tables: admin_users, audit_log, rate_limits, api_keys, etc.
 * Also use for public-schema RPC functions: verify_api_key, check_rate_limit, is_admin, etc.
 */
export function createPlatformClient() {
  const { url, key } = getSupabaseEnv()

  return createSupabaseClient<Database, 'public'>(
    url,
    key,
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
