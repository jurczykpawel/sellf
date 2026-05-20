import { NextResponse } from 'next/server'

/**
 * Require a custom `X-Requested-With: XMLHttpRequest` header on
 * state-changing requests. Forces the browser to issue a CORS preflight
 * for cross-origin callers, blocking simple form posts and image/script
 * tag inclusion. Returns 403 when the header is missing or wrong.
 */
export function validateCrossOriginRequest(request: Request): NextResponse | null {
  const requestedWith = request.headers.get('X-Requested-With')

  if (requestedWith !== 'XMLHttpRequest') {
    return NextResponse.json(
      {
        error: 'Forbidden',
        message: 'Missing or invalid X-Requested-With header. This endpoint requires XMLHttpRequest.',
      },
      { status: 403 },
    )
  }

  return null
}
