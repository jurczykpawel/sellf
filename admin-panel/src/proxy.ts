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

// API prefixes that always require an authenticated session at the edge.
// Anonymous routes (checkout, embed, webhooks, cron, public reads) and
// API-key-friendly v1 endpoints handle their own auth inside the route.
const PROTECTED_API_PREFIXES = [
  '/api/admin',
  '/api/users',
]

function isProtectedApiPath(pathname: string): boolean {
  return PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

/**
 * Skip the edge session gate when the caller presents a Bearer
 * credential. The route handler runs its own API-key/JWT flow and
 * still returns 401 on failure.
 */
function hasBearerAuthorization(request: NextRequest): boolean {
  const auth = request.headers.get('authorization')
  return !!auth && /^bearer\s+\S/i.test(auth)
}

// Module-level cache for the analytics CSP origins (Umami + server-side GTM)
// derived from the public integrations RPC. A single-process Node.js deployment
// keeps this alive across requests; the TTL handles config changes.
let _cachedCspOrigins: { connect: string[]; frame: string[] } = { connect: [], frame: [] }
let _cspOriginsExpiresAt = 0

function originOf(url?: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

async function fetchAnalyticsCspOrigins(): Promise<{ connect: string[]; frame: string[] }> {
  const now = Date.now()
  if (now < _cspOriginsExpiresAt) return _cachedCspOrigins

  try {
    // Resolve the analytics origins via the PUBLIC `get_public_integrations_config`
    // RPC with the anon key (the same credential the auth gate uses). The RPC
    // exposes only safe public fields and is the same source the client
    // TrackingProvider reads, so the two never drift.
    //
    // SUPABASE_URL is read BEFORE NEXT_PUBLIC_SUPABASE_URL on purpose: the latter
    // is inlined at BUILD time to `https://placeholder.supabase.co` in the generic
    // release build (the real URL reaches the client via /api/runtime-config), so
    // reading it first pointed this fetch at the placeholder and silently failed —
    // which is why the origin never reached the CSP. `SUPABASE_URL` is a non-public
    // var read from the runtime environment, so it carries the real project URL.
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (supabaseUrl && anonKey) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/rpc/get_public_integrations_config`,
        {
          method: 'POST',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
          redirect: 'error',
        },
      )
      if (res.ok) {
        const data = await res.json() as {
          umami_script_url?: string | null
          gtm_server_container_url?: string | null
        } | null
        const connect: string[] = []
        const frame: string[] = []
        // Umami sends its cookieless beacon to `<origin>/api/send` — connect-src.
        const umami = originOf(data?.umami_script_url)
        if (umami) connect.push(umami)
        // Server-side GTM: the GA4 / Meta tags POST hits to `<sgtm>/g/collect`
        // (connect-src) and GTM frames the sGTM service-worker iframe (frame-src).
        const sgtm = originOf(data?.gtm_server_container_url)
        if (sgtm) {
          connect.push(sgtm)
          frame.push(sgtm)
        }
        _cachedCspOrigins = { connect, frame }
      }
    }
  } catch {
    // Keep the stale cached value on transient error.
  }
  _cspOriginsExpiresAt = Date.now() + 5 * 60 * 1000
  return _cachedCspOrigins
}

// Add security headers to response
function addSecurityHeaders(
  response: NextResponse,
  nonce?: string,
  extraConnectSrc: string[] = [],
  extraFrameSrc: string[] = [],
): NextResponse {
  // Add HSTS header unless disabled (e.g., when behind reverse proxy with SSL termination)
  if (process.env.DISABLE_HSTS !== 'true') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (nonce) {
    response.headers.set(
      'Content-Security-Policy',
      buildContentSecurityPolicyWithNonce(nonce, { extraConnectSrc, extraFrameSrc }),
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

  // Resolve analytics CSP origins from DB (cached 5 min). Done once per request
  // so all addSecurityHeaders call sites below stay synchronous.
  const cspOrigins = await fetchAnalyticsCspOrigins()
  const applyHeaders = (r: NextResponse) =>
    addSecurityHeaders(r, nonce, cspOrigins.connect, cspOrigins.frame)

  // Demo mode: block mutating requests on API routes
  if (isDemoBlocked(pathname, request.method)) {
    return applyHeaders(NextResponse.json(
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
      return applyHeaders(NextResponse.json(
        { error: 'Request body too large' },
        { status: 413 }
      ))
    }
  }

  // Edge-level auth check for the API surface that always requires a
  // signed-in user. Endpoints that legitimately serve anonymous traffic
  // (checkout, embed, public reads, webhooks, cron with a shared secret)
  // skip this gate and rely on their own checks inside the handler.
  // Requests presenting a Bearer credential bypass this gate so the
  // route handler can run its own API-key / token flow.
  if (isProtectedApiPath(pathname) && !hasBearerAuthorization(request)) {
    const apiAuthResponse = NextResponse.next({ request: { headers: requestHeaders } })
    const apiSupabase = createServerClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            const isProduction = process.env.NODE_ENV === 'production'
            cookiesToSet.forEach(({ name, value, options }) => {
              apiAuthResponse.cookies.set({
                name,
                value,
                ...options,
                ...buildSupabaseCookieOptions({ isProduction, callerOptions: options }),
              })
            })
          },
        },
      },
    )
    const { data: { user }, error: userError } = await apiSupabase.auth.getUser()
    if (!user || userError) {
      return applyHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    return applyHeaders(apiAuthResponse)
  }

  // Skip proxy processing for API routes, static files, and payment success page
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/payment') ||
    pathname.startsWith('/test-pages') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico|js|css|html)$/)
  ) {
    return applyHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
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

  // next-intl writes NEXT_LOCALE without the Secure flag. In production every
  // deploy terminates HTTPS at the edge, so re-write the cookie with Secure.
  if (process.env.NODE_ENV === 'production' && intlResponse.cookies.has('NEXT_LOCALE')) {
    const existing = intlResponse.cookies.get('NEXT_LOCALE')
    if (existing) {
      intlResponse.cookies.set({
        name: 'NEXT_LOCALE',
        value: existing.value,
        path: '/',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 365,
        secure: true,
      })
    }
  }

  // If intl middleware redirects, return that response with security headers
  if (intlResponse.status === 302 || intlResponse.status === 301) {
    return applyHeaders(intlResponse as NextResponse)
  }

  // Public routes (checkout, about, landing, etc.) - skip Supabase overhead
  if (!needsAuth) {
    return applyHeaders(intlResponse as NextResponse)
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
    return applyHeaders(NextResponse.redirect(new URL(redirectPath, request.url)))
  }

  if ((!user || userError) && isProtectedRoute) {
    const redirectPath = locale ? `/${locale}/login` : '/login'
    return applyHeaders(NextResponse.redirect(new URL(redirectPath, request.url)))
  }

  return applyHeaders(response);
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
