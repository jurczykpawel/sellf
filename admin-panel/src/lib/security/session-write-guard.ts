import type { NextRequest } from 'next/server';
import { isAllowedOrigin } from './origin-match';
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const BODY_METHODS = new Set(['POST', 'PATCH', 'PUT']);

function requestDeclaresBody(request: NextRequest): boolean {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) return parseInt(contentLength, 10) > 0;
  if ((request.headers.get('transfer-encoding') || '').toLowerCase().includes('chunked')) return true;
  // No length header at all (e.g. streamed/chunked without the header showing
  // up in this runtime) — assume a body for methods that conventionally carry one.
  return BODY_METHODS.has(request.method);
}

/**
 * Decide whether a cookie-session, state-changing request may proceed.
 *
 * For every non-safe method:
 * - when the client is a browser (it sends `Origin` or `Sec-Fetch-Site`),
 *   the request must come from the site's own origin;
 * - a declared body must be `application/json`.
 *
 * Clients that send neither header are not browsers (scripts, server-side
 * tools, test runners); only the content-type rule applies to them.
 * API-key/bearer callers don't need this check at all.
 */
export function isSessionWriteAllowed(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return true;

  const origin = request.headers.get('origin');
  const secFetchSite = request.headers.get('sec-fetch-site');

  if (origin) {
    const siteUrl = getCanonicalOriginOrNull();
    if (!siteUrl || !isAllowedOrigin(origin, [siteUrl])) return false;
  } else if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return false;
  }

  if (requestDeclaresBody(request)) {
    const contentType = (request.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) return false;
  }

  return true;
}
