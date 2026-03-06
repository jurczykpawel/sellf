import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import {
  validateAccessCheck,
  sanitizeAccessCheckData
} from '@/lib/validations/access';
import {
  validateCrossOriginRequest,
  getCrossOriginHeaders,
  createCrossOriginOptionsResponse
} from '@/lib/cors';
import { checkRateLimit } from '@/lib/rate-limiting';

/**
 * Handle CORS preflight requests
 */
export async function OPTIONS(request: Request) {
  return createCrossOriginOptionsResponse(request);
}

/**
 * Check product access for authenticated user
 *
 * SECURITY: This endpoint is allowed cross-origin because it only returns
 * read-only data (true/false for access). It does NOT modify any data
 * or return sensitive information.
 */
export async function POST(request: Request) {
  const corsHeaders = getCrossOriginHeaders(request);

  try {
    // Rate limiting: 120 requests per minute (access checks can be frequent)
    const rateLimitOk = await checkRateLimit('access_check', 120, 60);
    if (!rateLimitOk) {
      return NextResponse.json(
        { hasAccess: false, error: 'Too many requests. Please try again later.' },
        { status: 429, headers: corsHeaders }
      );
    }

    // 🔐 SECURITY: Validate X-Requested-With header (CSRF protection)
    const validationError = validateCrossOriginRequest(request);
    if (validationError) {
      logger.security('Blocked cross-origin request without X-Requested-With', {
        origin: request.headers.get('origin'),
        userAgent: request.headers.get('user-agent')?.slice(0, 100),
      });
      return validationError;
    }

    // Log Sellf request details
    const sellfOrigin = request.headers.get('X-Sellf-Origin');
    const sellfVersion = request.headers.get('X-Sellf-Version');
    logger.security('Sellf access request:', {
      origin: sellfOrigin,
      version: sellfVersion,
      userAgent: request.headers.get('user-agent')?.slice(0, 100),
      timestamp: new Date().toISOString()
    });

    // Create Supabase client with server-side auth
    const supabase = await createClient()

    // SECURITY FIX (V10): Use getUser() instead of getSession()
    // getSession() only reads cookies which can be tampered on client-side
    // getUser() validates the session with the auth server
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    // Note: userError can occur when there's no session at all (not just invalid session)
    // We treat "no user" as unauthenticated and continue to check for free products
    if (userError && user === null) {
      // This is expected for unauthenticated requests - continue to free product check
      logger.security('Unauthenticated access check request');
    } else if (userError) {
      // Actual auth error with partial data - log and return error
      logger.error('User check error:', userError.message);
      return NextResponse.json(
        { hasAccess: false, error: 'Authentication error' },
        { status: 200, headers: corsHeaders }
      )
    }

    // Parse request body
    const body = await request.json()

    // Sanitize input data
    const sanitizedData = sanitizeAccessCheckData(body);

    // Validate input data
    const validation = validateAccessCheck(sanitizedData);
    if (!validation.isValid) {
      return NextResponse.json(
        { hasAccess: false, error: 'Validation failed', details: validation.errors },
        { status: 400, headers: corsHeaders }
      );
    }

    const { productSlug, productSlugs } = sanitizedData;

    // Support both single productSlug and array productSlugs
    const slugsToCheck = productSlugs ? (productSlugs as string[]) : (productSlug ? [productSlug as string] : []);

    if (!slugsToCheck.length) {
      return NextResponse.json(
        { hasAccess: false, error: 'Product slug(s) required' },
        { status: 400, headers: corsHeaders }
      )
    }

    if (!user) {
      // No authenticated user - access denied for ALL products (including free ones)
      // Free products require login (email) to grant access
      if (productSlugs) {
        const noAccessResults: { [key: string]: boolean } = {};
        for (const slug of slugsToCheck) {
          noAccessResults[slug] = false;
        }
        return NextResponse.json(
          { accessResults: noAccessResults, authenticated: false },
          { status: 200, headers: corsHeaders }
        )
      } else {
        return NextResponse.json(
          { hasAccess: false, authenticated: false },
          { status: 200, headers: corsHeaders }
        )
      }
    }

    // Check access using RPC function
    if (productSlugs) {
      // Batch access check
      const { data: accessResults, error: accessError } = await supabase.rpc('batch_check_user_product_access', {
        product_slugs_param: slugsToCheck
      });

      if (accessError) {
        console.error('Batch access check error:', accessError)
        return NextResponse.json(
          { accessResults: {}, error: accessError.message },
          { status: 200, headers: corsHeaders }
        )
      }

      return NextResponse.json(
        { accessResults: accessResults || {}, authenticated: true },
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
        }
      )
    } else {
      // Single access check
      const { data: hasAccess, error: accessError } = await supabase.rpc('check_user_product_access', {
        product_slug_param: slugsToCheck[0]
      });

      if (accessError) {
        console.error('Access check error:', accessError)
        return NextResponse.json(
          { hasAccess: false, error: accessError.message },
          { status: 200, headers: corsHeaders }
        )
      }

      return NextResponse.json(
        { hasAccess: !!hasAccess, authenticated: true },
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
        }
      )
    }
  } catch (error) {
    console.error('Access API error:', error)

    return NextResponse.json(
      { hasAccess: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
