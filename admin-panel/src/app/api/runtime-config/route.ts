import { NextResponse } from 'next/server'

/**
 * Runtime Configuration API
 * Provides client-side configuration loaded from environment variables
 * No rate limiting — this is a public, read-only, heavily cached endpoint
 */
export async function GET() {
  const config = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!,
    stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY!,
    cloudflareSiteKey: process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY || process.env.CLOUDFLARE_TURNSTILE_SITE_KEY!,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL!,
    demoMode: process.env.DEMO_MODE === 'true',
  }

  return NextResponse.json(config, {
    headers: {
      // Cache for 5 minutes
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      // Prevent caching during development
      ...(process.env.NODE_ENV === 'development' && {
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      })
    }
  })
}
