import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import type { Session, AuthError } from '@supabase/supabase-js'
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';
import { DisposableEmailService } from '@/lib/services/disposable-email'
import { resolveSafeRedirectPath } from '@/lib/validations/redirect'
import { getLoginReturnPath } from '@/lib/auth/magic-link-redirect'
import { buildSupabaseCookieOptions } from '@/lib/supabase/cookie-options'
import { claimPendingFreeGrants, productSlugHandledByRedirect } from '@/lib/services/pending-free-grants'

/**
 * Auth callback handler for Supabase magic links
 * 
 * This route handles the callback from Supabase auth when users click 
 * the magic link sent to their email. It exchanges the code for a session
 * and redirects the user to the dashboard.
 */
const SUPPORTED_OTP_TYPES = ['magiclink', 'recovery', 'invite', 'email_change', 'signup'] as const
type SupportedOtpType = (typeof SUPPORTED_OTP_TYPES)[number]

function parseOtpType(raw: string | null): SupportedOtpType {
  return (SUPPORTED_OTP_TYPES as readonly string[]).includes(raw ?? '')
    ? (raw as SupportedOtpType)
    : 'magiclink'
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const type = parseOtpType(requestUrl.searchParams.get('type'))
  
  // Resolve a configured origin, never attacker-controlled Host headers.
  const origin = getCanonicalOriginOrNull();
  if (!origin) {
    console.error('[auth/callback] SITE_URL is not configured')
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 },
    )
  }

  // Upstream error from Supabase verify or OAuth provider.
  // Distinguish magic link expiry (common UX pitfall: clicking link in different browser)
  // from genuine OAuth failures (user denied access, provider error).
  const oauthError = requestUrl.searchParams.get('error')
  if (oauthError) {
    const errorCode = requestUrl.searchParams.get('error_code')
    const loginUrl = new URL('/login', origin)
    if (errorCode === 'otp_expired') {
      loginUrl.searchParams.set('error', 'magic_link_expired')
    } else {
      loginUrl.searchParams.set('error', 'oauth_failed')
    }
    return NextResponse.redirect(loginUrl)
  }

  // Check if we have code or token_hash parameter
  if (!code && !tokenHash) {
    return NextResponse.redirect(new URL('/login', origin))
  }
  
  // Create server client to exchange the code for a session first
  // We need a temporary response to collect cookies during auth process
  const tempResponse = NextResponse.next()
  
  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          // Cookie flags centralized — see buildSupabaseCookieOptions.
          const isProduction = process.env.NODE_ENV === 'production'
          cookiesToSet.forEach(({ name, value, options }) => {
            tempResponse.cookies.set({
              name,
              value,
              ...options,
              ...buildSupabaseCookieOptions({ isProduction, callerOptions: options }),
            })
          })
        },
      },
    }
  )
  
  // Exchange the code for a session - different methods for different auth types
  let session: Session | null = null;
  let error: AuthError | null = null;

  if (code) {
    // PKCE flow - exchange code for session
    const oauthResponse = await supabase.auth.exchangeCodeForSession(code);
    session = oauthResponse.data.session;
    error = oauthResponse.error;
  } else if (tokenHash) {
    // Token hash flow (from custom email templates)
    const otpResponse = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    session = otpResponse.data.session;
    error = otpResponse.error;
  }
  
  
  if (error || !session) {
    // Typical cause: code_verifier cookie missing at exchange time.
    // Happens when user clicks the magic link in a different browser/incognito session
    // than where they requested it — PKCE verifier is stored in a first-party cookie
    // on this origin and must be present when exchangeCodeForSession runs.
    const loginUrl = new URL('/login', origin)
    loginUrl.searchParams.set('error', 'session_lost')
    return NextResponse.redirect(loginUrl)
  }

  // Validate email for disposable domains (security check)
  const userEmail = session.user?.email;
  if (userEmail) {
    try {
      const emailValidation = await DisposableEmailService.validateEmail(userEmail);
      if (!emailValidation.isValid) {
        // Sign out the user immediately
        await supabase.auth.signOut();
        
        // Redirect to login with error
        const loginUrl = new URL('/login', origin);
        loginUrl.searchParams.set('error', 'disposable_email');
        return NextResponse.redirect(loginUrl);
      }
    } catch (error) {
      console.error('Email validation error in auth callback:', error);
      // Don't block auth on validation service errors, just log
    }
  }

  // Paid guest purchases are claimed by the on_auth_user_created trigger.

  const redirectTo = requestUrl.searchParams.get('redirect_to')
  let returnPath = getLoginReturnPath(redirectTo)
  if (redirectTo === null && code) {
    returnPath = getLoginReturnPath(request.cookies.get('sf_oauth_redirect')?.value)
  }
  let redirectPath = returnPath ? resolveSafeRedirectPath(returnPath, origin) : null
  if (!redirectPath) {
    try {
      const { data: isAdmin } = await supabase.rpc('is_admin')
      redirectPath = isAdmin ? '/dashboard' : '/my-products'
    } catch {
      redirectPath = '/my-products'
    }
  }

  // Free products requested by e-mail reach the user on any sign-in, not only
  // via the product-access link. The product that link grants is skipped so it
  // keeps its own success page. Nothing pending = no query (read from session).
  await claimPendingFreeGrants({
    userClient: supabase,
    user: session.user,
    skipSlug: productSlugHandledByRedirect(redirectPath),
  })

  // Use the correct origin for redirects
  const redirectUrl = new URL(redirectPath, origin)

  // Create redirect response and transfer auth cookies
  const redirectResponse = NextResponse.redirect(redirectUrl)

  // Transfer cookies from the temp response to the redirect response
  tempResponse.cookies.getAll().forEach(cookie => {
    redirectResponse.cookies.set(cookie.name, cookie.value, cookie)
  })

  // Clear the OAuth redirect cookie if it was used
  if (request.cookies.get('sf_oauth_redirect')) {
    redirectResponse.cookies.set('sf_oauth_redirect', '', { path: '/', maxAge: 0 })
  }

  return redirectResponse
}
