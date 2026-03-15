import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'
import { isValidSellerSchema } from '@/lib/marketplace/tenant'

/**
 * Type alias for any Supabase client that can query seller schema tables.
 * All seller schemas are clones of seller_main, so they share the same table structure.
 * TypeScript can't express this via Supabase generics (schema name is part of the type),
 * so we use the seller_main-typed client as the common interface.
 */
export type SellerDataClient = SupabaseClient<Database, 'seller_main'>

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
 * Creates a schema-aware admin client for the dashboard.
 * Checks if the current user is a seller owner and scopes to their schema.
 *
 * - Platform admin: returns seller_main client (default)
 * - Seller admin: returns client scoped to their seller schema
 *
 * Uses Supabase auth (via cookies) to identify the user, then checks
 * public.sellers for ownership. This is server-side only.
 *
 * WARNING: Returns a service_role client that bypasses RLS.
 * Callers MUST verify admin/seller auth before calling this function.
 * Use requireAdminOrSellerApi() or verifyAdminOrSellerAccess() first.
 *
 * Use this in server actions and API routes that serve the admin dashboard.
 * For non-dashboard contexts (webhooks, verify-payment), use createAdminClient() directly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createSchemaAwareAdminClient(knownSellerSchema?: string): Promise<any> {
  if (typeof window !== 'undefined') {
    throw new Error('createSchemaAwareAdminClient can only be called on the server')
  }

  // Fast path: if schema already known (e.g. from withAdminOrSellerAuth / requireAdminOrSellerApi),
  // skip the auth + sellers lookup entirely. This eliminates the N+1 problem when multiple
  // components on the same page each need a schema-scoped client.
  if (knownSellerSchema) {
    if (!isValidSellerSchema(knownSellerSchema)) {
      throw new Error(`createSchemaAwareAdminClient: Invalid seller schema: ${knownSellerSchema}`)
    }
    const supabaseUrl = process.env.SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }
    return createSupabaseClient(supabaseUrl, serviceRoleKey, {
      db: { schema: knownSellerSchema },
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  // Slow path: resolve schema from auth session (original behavior)
  // Lazy import to avoid circular dependencies
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('createSchemaAwareAdminClient: No authenticated user. Call requireAdminOrSellerApi first.')
  }

  // Check if user owns a seller
  const platform = createPlatformClient()
  const { data: seller } = await platform
    .from('sellers')
    .select('schema_name')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (seller?.schema_name && isValidSellerSchema(seller.schema_name)) {
    const supabaseUrl = process.env.SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }
    return createSupabaseClient(supabaseUrl, serviceRoleKey, {
      db: { schema: seller.schema_name },
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  return createAdminClient()
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