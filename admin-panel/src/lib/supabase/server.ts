import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { buildSupabaseCookieOptions } from './cookie-options'

export async function createClient() {
  const cookieStore = await cookies()

  // Accept either the bare names (what Sellf docs ask for) or Vercel's
  // Supabase integration names — the integration sets NEXT_PUBLIC_SUPABASE_*
  // automatically when you add it from the project's Integrations panel.
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not defined. Server client cannot be created.')
  }
  if (!supabaseAnonKey) {
    throw new Error('SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) is not defined. Server client cannot be created.')
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
              // Cookie flags centralized — see buildSupabaseCookieOptions.
              cookieStore.set(name, value, {
                ...(options as object),
                ...buildSupabaseCookieOptions({ isProduction, callerOptions: options }),
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
  // Fallback chain:
  //   1. SUPABASE_URL / SUPABASE_ANON_KEY — what Sellf docs ask for
  //   2. NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — Vercel's
  //      Supabase integration sets these, so the integration just works
  //   3. ANON_KEY — legacy fallback from .env.fullstack
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.ANON_KEY

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
