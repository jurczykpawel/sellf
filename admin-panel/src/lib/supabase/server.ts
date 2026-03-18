import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { isMarketplaceEnabled } from '@/lib/marketplace/feature-flag'

export async function createClient() {
  const cookieStore = await cookies()

  // Use server-side environment variables
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is not defined. Server client cannot be created.')
  }
  if (!supabaseAnonKey) {
    throw new Error('SUPABASE_ANON_KEY is not defined. Server client cannot be created.')
  }
  const isProduction = process.env.NODE_ENV === 'production'

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              // SameSite=None is required for cross-domain SDK (sellf.js on seller domains).
              // In marketplace mode, cross-domain SDK is disabled — SameSite=Lax is safer
              // and eliminates CSRF risk from the many seller_admin accounts.
              const needsCrossDomain = isProduction && !isMarketplaceEnabled()
              cookieStore.set(name, value, {
                ...(options as object),
                httpOnly: true,
                sameSite: needsCrossDomain ? 'none' : ((options?.sameSite as 'lax' | 'strict' | 'none' | undefined) ?? 'lax'),
                secure: isProduction ? true : ((options?.secure as boolean | undefined) ?? false),
              })
            })
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

/**
 * Create a public Supabase client without cookie handling.
 * This client is suitable for ISR (Incremental Static Regeneration) pages
 * as it doesn't force Dynamic Rendering like cookies() does.
 *
 * Use this for:
 * - Public pages that can be cached (homepage, product pages, etc.)
 * - Pages with `export const revalidate = N`
 * - API routes that return public data
 *
 * DO NOT use this for:
 * - User-specific data
 * - Admin pages
 * - Authenticated operations
 */
export function createPublicClient() {
  // Fallback to publicly available env vars for build-time static generation
  // Runtime: SUPABASE_URL / SUPABASE_ANON_KEY (if set)
  // Build time: NEXT_PUBLIC_SUPABASE_URL / ANON_KEY (from .env.fullstack)
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY

  // At build time (next build), env vars may not be available.
  // Throw at runtime to prevent accidental use with missing config.
  if (!supabaseUrl || !supabaseAnonKey) {
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      // During build, return a no-op client that will cause pages to be dynamic
      return createServerClient(
        'http://placeholder.invalid',
        'placeholder-key',
        { cookies: { getAll: () => [], setAll: () => {} } }
      )
    }
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_ANON_KEY. ' +
      'Set environment variables or use NEXT_PUBLIC_SUPABASE_URL / ANON_KEY.'
    )
  }

  const url = supabaseUrl
  const key = supabaseAnonKey

  return createServerClient(
    url,
    key,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    }
  )
}
