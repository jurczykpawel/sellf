import { NextResponse } from 'next/server'
import { getCaptchaProvider, getTurnstileSiteKey } from '@/lib/captcha/config'

/**
 * Runtime Configuration API
 * Provides client-side configuration loaded from environment variables
 * No rate limiting — this is a public, read-only, heavily cached endpoint
 */
export async function GET() {
  // Server-side env vars (loaded at runtime) take priority over NEXT_PUBLIC_*
  // (which are baked at build time and may contain placeholder values)
  const config = {
    supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
    cloudflareSiteKey: getTurnstileSiteKey(),
    captchaProvider: getCaptchaProvider(),
    siteUrl: process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL!,
    demoMode: process.env.DEMO_MODE === 'true',
    oauthProviders: (process.env.OAUTH_PROVIDERS || '')
      .split(',')
      .map(p => p.trim().toLowerCase())
      .filter(p => ['google', 'github', 'discord', 'twitter', 'azure', 'facebook', 'apple'].includes(p)),
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
