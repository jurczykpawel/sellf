import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import type { Session, AuthError } from '@supabase/supabase-js'
import { DisposableEmailService } from '@/lib/services/disposable-email'
import { isSafeRedirectUrl } from '@/lib/validations/redirect'

/**
 * Auth callback handler for Supabase magic links
 * 
 * This route handles the callback from Supabase auth when users click 
 * the magic link sent to their email. It exchanges the code for a session
 * and redirects the user to the dashboard.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type') as 'magiclink' | 'recovery' | 'invite' | 'email_change' | 'signup' | null
  
  // Get the correct origin for redirects - prioritize env var, then headers, then request URL
  const getOrigin = () => {
    // First try environment variable
    if (process.env.SITE_URL) {
      return process.env.SITE_URL
    }
    
    // Then try headers (for production environments)
    const host = request.headers.get('host')
    const protocol = request.headers.get('x-forwarded-proto') || 
                    request.headers.get('x-forwarded-protocol') ||
                    (requestUrl.protocol === 'https:' ? 'https' : 'http')
    
    if (host) {
      return `${protocol}://${host}`
    }
    
    // Fallback to request URL origin
    return requestUrl.origin
  }
  
  const origin = getOrigin()

  // OAuth provider returned an error (e.g. user denied access, token expired)
  const oauthError = requestUrl.searchParams.get('error')
  if (oauthError) {
    const loginUrl = new URL('/login', origin)
    loginUrl.searchParams.set('error', 'oauth_failed')
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
          // Set cookies on the temporary response object
          cookiesToSet.forEach(({ name, value, options }) => {
            tempResponse.cookies.set({
              name,
              value,
              ...options
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
    const otpType = type || 'magiclink';
    const otpResponse = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType
    });
    session = otpResponse.data.session;
    error = otpResponse.error;
  }
  
  
  if (error || !session) {
    return NextResponse.redirect(new URL('/login', origin))
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

  // Note: Guest purchases are now automatically claimed by database trigger
  // when user registers/signs in for the first time
  
  // Check for custom redirect URL (for product access etc.)
  let redirectPath = '/dashboard' // default to dashboard
  const redirectTo = requestUrl.searchParams.get('redirect_to')
  
  if (redirectTo) {
    try {
      // Decode the redirect URL to handle encoded parameters
      const decodedRedirectTo = decodeURIComponent(redirectTo)

      // SECURITY: use isSafeRedirectUrl — handles backslash normalization (/\evil.com → //)
      // and blocks protocol-relative URLs (//evil.com)
      if (isSafeRedirectUrl(decodedRedirectTo, origin)) {
        if (decodedRedirectTo.startsWith('/')) {
          redirectPath = decodedRedirectTo
        } else {
          // Absolute same-origin URL — extract just the path
          const redirectToUrl = new URL(decodedRedirectTo)
          redirectPath = redirectToUrl.pathname + redirectToUrl.search
        }
      }
    } catch {
      // Silent error handling - if decoding fails, fallback to default
    }
  } else {
    // No URL-based redirect_to — check for OAuth redirect cookie set by FreeProductForm.
    // This avoids embedding the redirect path as a query param in the OAuth redirectTo URL,
    // which would require registering every possible URL variant in the Supabase allowlist.
    const oauthRedirectCookie = request.cookies.get('sf_oauth_redirect')?.value
    if (oauthRedirectCookie && code) {
      try {
        const decoded = decodeURIComponent(oauthRedirectCookie)
        // SECURITY: same validation as redirect_to — blocks backslash tricks and //evil.com
        if (isSafeRedirectUrl(decoded, origin) && decoded.startsWith('/')) {
          redirectPath = decoded
        }
      } catch {
        // Invalid cookie value — fall through to role-based default
      }
    } else {
      // No custom redirect, check user role to determine default redirect
      try {
        const { data: isAdmin } = await supabase.rpc('is_admin')

        if (isAdmin) {
          redirectPath = '/dashboard' // Admins go to dashboard
        } else {
          redirectPath = '/my-products' // Regular users go to their products
        }
      } catch {
        // If we can't determine admin status, send to user page as safer default
        redirectPath = '/my-products'
      }
    }
  }

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