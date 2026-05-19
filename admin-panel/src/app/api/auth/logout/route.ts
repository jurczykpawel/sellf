// app/api/auth/logout/route.ts
// Logout endpoint — POST only (GET removed to prevent logout CSRF via link/image injection)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSafeRedirectUrl } from '@/lib/validations/redirect';

/**
 * Validate return URL using the shared isSafeRedirectUrl function.
 * Returns '/' as safe default if URL is invalid.
 */
function validateReturnUrl(url: string | null): string {
  if (!url) return '/';
  const decoded = decodeURIComponent(url).trim();
  return isSafeRedirectUrl(decoded) ? decoded : '/';
}

function clearSupabaseCookies(response: NextResponse, request: NextRequest): void {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith('sb-')) {
      response.cookies.set(cookie.name, '', { path: '/', maxAge: 0 });
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const body = await request.json().catch(() => ({}));
    const returnUrl = validateReturnUrl(body.returnUrl);

    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[logout] signOut error:', error);
    }

    const response = NextResponse.json({
      success: !error,
      redirectUrl: returnUrl,
      ...(error ? { error: error.message } : {}),
    });
    clearSupabaseCookies(response, request);
    return response;

  } catch (error) {
    console.error('[logout] unexpected error:', error);
    const response = NextResponse.json({ success: false, redirectUrl: '/' });
    clearSupabaseCookies(response, request);
    return response;
  }
}
