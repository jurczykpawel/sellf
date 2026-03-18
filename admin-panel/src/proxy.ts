import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { locales, defaultLocale } from './lib/locales'
import { isMarketplaceEnabled } from './lib/marketplace/feature-flag'

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
  '/api/config',
  '/api/runtime-config',
  '/api/consent',
  '/api/tracking/',
  '/api/waitlist/',
  '/api/sellf',
  '/api/sellf-embed',
  '/api/oto/',
  '/api/products/',
  '/api/access',
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
function addSecurityHeaders(response: NextResponse): NextResponse {
  // Add HSTS header unless disabled (e.g., when behind reverse proxy with SSL termination)
  if (process.env.DISABLE_HSTS !== 'true') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Block deprecated /api/admin/* endpoints (except payments)
  // Set ALLOW_DEPRECATED_API=true to re-enable
  if (
    pathname.startsWith('/api/admin/') &&
    !pathname.startsWith('/api/admin/payments/') &&
    process.env.ALLOW_DEPRECATED_API !== 'true'
  ) {
    return addSecurityHeaders(NextResponse.json(
      {
        error: 'Deprecated API endpoint',
        message: `Use /api/v1/* instead of ${pathname}`,
        hint: 'Set ALLOW_DEPRECATED_API=true to temporarily re-enable',
      },
      { status: 503 }
    ));
  }

  // Demo mode: block mutating requests on API routes
  if (isDemoBlocked(pathname, request.method)) {
    return addSecurityHeaders(NextResponse.json(
      { error: { code: 'DEMO_MODE', message: 'This action is disabled in demo mode' } },
      { status: 403 }
    ));
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
      ))
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
    return addSecurityHeaders(NextResponse.next());
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

  // Apply internationalization middleware first
  const intlResponse = intlMiddleware(request)

  // If intl middleware redirects, return that response with security headers
  if (intlResponse.status === 302 || intlResponse.status === 301) {
    return addSecurityHeaders(intlResponse as NextResponse)
  }

  // Public routes (checkout, about, landing, etc.) - skip Supabase overhead
  if (!needsAuth) {
    return addSecurityHeaders(intlResponse as NextResponse)
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
          const needsCrossDomain = isProduction && !isMarketplaceEnabled()
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set({
              name,
              value,
              ...options,
              httpOnly: true,
              sameSite: needsCrossDomain ? 'none' : ((options?.sameSite as 'lax' | 'strict' | 'none' | undefined) ?? 'lax'),
              secure: isProduction ? true : ((options?.secure as boolean | undefined) ?? false),
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
    return addSecurityHeaders(NextResponse.redirect(new URL(redirectPath, request.url)))
  }

  if ((!user || userError) && isProtectedRoute) {
    const redirectPath = locale ? `/${locale}/login` : '/login'
    return addSecurityHeaders(NextResponse.redirect(new URL(redirectPath, request.url)))
  }

  return addSecurityHeaders(response);
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
