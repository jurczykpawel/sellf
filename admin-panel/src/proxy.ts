import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { locales, defaultLocale } from './lib/locales'
import { buildSupabaseCookieOptions } from './lib/supabase/cookie-options'
import { buildContentSecurityPolicyWithNonce } from './lib/security/headers'

/**
 * Header name used to forward the per-request CSP nonce from middleware
 * to React Server Components, which read it via `headers()` and attach it
 * to inline <Script> tags so the browser accepts them under the
 * `'nonce-...'` source in the CSP.
 */
export const CSP_NONCE_HEADER = 'x-csp-nonce'

function generateNonce(): string {
  // 16 random bytes → 22-char base64url string. Sufficient entropy for CSP
  // nonces per the spec (>= 128 bits) and shorter than UUIDv4 base64.
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // base64url without padding
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// Create next-intl middleware
const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'as-needed',
  alternateLinks: false,
})

// =============================================================================
// DEMO MODE — Block mutating API requests when DEMO_MODE=true
// =============================================================================

// Whitelist-only: mutations are blocked UNLESS explicitly allowed here.
// New endpoints are blocked by default until added to this list.
const DEMO_MUTATION_ALLOWED = [
  '/api/create-payment-intent',
  '/api/verify-payment',
  '/api/create-embedded-checkout',
  '/api/update-payment-metadata',
  '/api/webhooks/',
  '/api/auth/',
  '/api/public/',
  '/api/coupons/',
  '/api/order-bumps/',
  '/api/gus/',
  '/api/validate-email',
  '/api/health',
  '/api/status',
  '/api/runtime-config',
  '/api/consent',
  '/api/tracking/',
  '/api/waitlist/',
  '/api/embed/',
  '/api/oto/',
  '/api/products/',
  '/api/profile/',
  '/api/users/',
  '/api/refund-requests',
]

function isDemoBlocked(pathname: string, method: string): boolean {
  if (process.env.DEMO_MODE !== 'true') return false
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false
  // Only block API route mutations; server actions (POST to page URLs)
  // are handled by demo-guard in individual server actions
  if (!pathname.startsWith('/api')) return false
  return !DEMO_MUTATION_ALLOWED.some(p => pathname.startsWith(p))
}

// Add security headers to response
function addSecurityHeaders(response: NextResponse, nonce?: string): NextResponse {
  // Add HSTS header unless disabled (e.g., when behind reverse proxy with SSL termination)
  if (process.env.DISABLE_HSTS !== 'true') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (nonce) {
    response.headers.set(
      'Content-Security-Policy',
      buildContentSecurityPolicyWithNonce(nonce),
    );
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Per-request CSP nonce — forwarded to React Server Components via the
  // x-csp-nonce request header so inline <Script nonce={...}> tags emitted
  // by ThemeProvider / TrackingProvider match the response CSP.
  const nonce = generateNonce()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(CSP_NONCE_HEADER, nonce)

  // Demo mode: block mutating requests on API routes
  if (isDemoBlocked(pathname, request.method)) {
    return addSecurityHeaders(NextResponse.json(
      { error: { code: 'DEMO_MODE', message: 'This action is disabled in demo mode' } },
      { status: 403 }
    ), nonce);
  }

  // Body size limit for API routes (1MB) — prevents large payload DoS
  // Server actions have their own bodySizeLimit in next.config.ts
  const MAX_API_BODY_SIZE = 1_048_576 // 1MB
  if (pathname.startsWith('/api') && (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH')) {
    const contentLength = request.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_API_BODY_SIZE) {
      return addSecurityHeaders(NextResponse.json(
        { error: 'Request body too large' },
        { status: 413 }
      ), nonce)
    }
  }

  // Skip proxy processing for API routes, static files, and payment success page
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/payment') ||
    pathname.startsWith('/test-pages') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico|js|css|html)$/)
  ) {
    return addSecurityHeaders(
      NextResponse.next({ request: { headers: requestHeaders } }),
      nonce,
    );
  }

  // Extract locale from pathname early to determine route type
  const localeMatch = pathname.match(/^\/([a-z]{2})(?:\/|$)/)
  const locale = localeMatch ? localeMatch[1] : ''

  // Remove locale from pathname to get actual path
  const actualPath = locale && locales.includes(locale as typeof locales[number])
    ? pathname.replace(`/${locale}`, '') || '/'
    : pathname

  // Determine if route needs auth checking
  const isProtectedRoute =
    actualPath.startsWith('/dashboard') ||
    actualPath.startsWith('/my-products') ||
    actualPath.startsWith('/admin')
  const isLoginRoute = actualPath === '/login'
  const needsAuth = isProtectedRoute || isLoginRoute

  // Apply internationalization middleware first. Forward the nonce header
  // so server components can read it via headers().get(CSP_NONCE_HEADER).
  const intlRequest = new NextRequest(request, { headers: requestHeaders })
  const intlResponse = intlMiddleware(intlRequest)

  // If intl middleware redirects, return that response with security headers
  if (intlResponse.status === 302 || intlResponse.status === 301) {
    return addSecurityHeaders(intlResponse as NextResponse, nonce)
  }

  // Public routes (checkout, about, landing, etc.) - skip Supabase overhead
  if (!needsAuth) {
    return addSecurityHeaders(intlResponse as NextResponse, nonce)
  }

  // Auth-required routes: create response with cookie support
  const response = new NextResponse(intlResponse.body, {
    status: intlResponse.status,
    headers: intlResponse.headers
  })

  // Create Supabase client for authentication
  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          const isProduction = process.env.NODE_ENV === 'production'
          // Cookie flags centralized — see buildSupabaseCookieOptions.
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set({
              name,
              value,
              ...options,
              ...buildSupabaseCookieOptions({ isProduction, callerOptions: options }),
            })
          })
        }
      }
    }
  )

  // Verify user actually exists in DB (not just JWT validity)
  // getUser() makes a server call, unlike getSession() which only checks JWT locally.
  // This handles stale sessions after DB reset (e.g. demo mode hourly reset).
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  // Auth logic
  if (user && !userError && isLoginRoute) {
    const redirectPath = locale ? `/${locale}/dashboard` : '/dashboard'
    return addSecurityHeaders(NextResponse.redirect(new URL(redirectPath, request.url)), nonce)
  }

  if ((!user || userError) && isProtectedRoute) {
    const redirectPath = locale ? `/${locale}/login` : '/login'
    return addSecurityHeaders(NextResponse.redirect(new URL(redirectPath, request.url)), nonce)
  }

  return addSecurityHeaders(response, nonce);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static images
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
