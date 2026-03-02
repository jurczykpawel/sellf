/**
 * CORS utilities for Sellf API endpoints
 *
 * SECURITY: Only specific endpoints should allow cross-origin requests with credentials.
 * These are READ-ONLY endpoints that return non-sensitive data (access: true/false).
 */

import { NextResponse } from 'next/server'

/**
 * Endpoints that are allowed to be called cross-origin with credentials.
 * These MUST be read-only and return only non-sensitive data.
 */
export const CROSS_ORIGIN_ALLOWED_PATHS = [
  '/api/access',      // Returns only true/false for product access (reads user from cookies)
  '/api/sellf',  // Serves the JS script (public, no auth needed)
]

/**
 * Validate that a request has proper security headers for cross-origin access.
 * Returns an error response if validation fails, null if valid.
 */
export function validateCrossOriginRequest(request: Request): NextResponse | null {
  const requestedWith = request.headers.get('X-Requested-With')
  const origin = request.headers.get('origin')

  // Require X-Requested-With header to prevent simple CSRF attacks
  if (requestedWith !== 'XMLHttpRequest') {
    return NextResponse.json(
      {
        error: 'Forbidden',
        message: 'Missing or invalid X-Requested-With header. This endpoint requires XMLHttpRequest.'
      },
      {
        status: 403,
        headers: {
          'Access-Control-Allow-Origin': origin || '*',
          'Access-Control-Allow-Credentials': 'true',
        }
      }
    )
  }

  return null // Valid request
}

/**
 * Get CORS headers for cross-origin access endpoints.
 * Only use this for endpoints in CROSS_ORIGIN_ALLOWED_PATHS.
 *
 * SECURITY: When ALLOWED_ORIGINS env var is set (comma-separated list),
 * only those origins are reflected (strict mode). When unset, any origin
 * is reflected (permissive mode) — required for cross-domain sellf feature.
 * Vary: Origin is always set for correct caching behavior.
 */
export function getCrossOriginHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')
  const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS

  let effectiveOrigin: string

  if (allowedOriginsEnv) {
    // Strict mode: only reflect origins from the whitelist
    const allowedOrigins = allowedOriginsEnv.split(',').map(o => o.trim())
    effectiveOrigin = (origin && allowedOrigins.includes(origin)) ? origin : (siteUrl || 'null')
  } else {
    // Permissive mode (cross-domain sellf feature): reflect origin
    effectiveOrigin = origin || siteUrl || 'null'
  }

  return {
    'Access-Control-Allow-Origin': effectiveOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Sellf-Origin, X-Sellf-Version',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

/**
 * Get restrictive CORS headers for admin/internal endpoints.
 * Does NOT allow credentials from cross-origin requests.
 */
export function getRestrictiveHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*', // Allow preflight but no credentials
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    // NO Access-Control-Allow-Credentials - this prevents cross-origin cookie sending
  }
}

/**
 * Create OPTIONS response for cross-origin endpoints.
 */
export function createCrossOriginOptionsResponse(request: Request): NextResponse {
  return new NextResponse(null, {
    status: 200,
    headers: getCrossOriginHeaders(request),
  })
}
