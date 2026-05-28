/**
 * GET /api/v1/system/update-check
 *
 * Checks GitHub for the latest release and compares with current version.
 * Server-side cache: 1 hour (avoids GitHub API rate limit of 60 req/h).
 * Query param ?force=true bypasses cache.
 *
 * @see /admin-panel/scripts/upgrade.sh
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  authenticate,
  handleApiError,
  API_SCOPES,
} from '@/lib/api';
import { isNewerVersion, APP_VERSION } from '@/lib/version';
import { successResponse } from '@/lib/api/types';

/** Prevent proxy/CDN caching of version info */
function withNoStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res;
}

const GITHUB_REPO = 'jurczykpawel/sellf';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedRelease {
  data: UpdateCheckData;
  fetchedAt: number;
}

interface UpdateCheckData {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_notes: string | null;
  published_at: string | null;
  release_url: string | null;
}

let releaseCache: CachedRelease | null = null;

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

function unknownUpstreamResponse(currentVersion: string): UpdateCheckData {
  return {
    current_version: currentVersion,
    latest_version: currentVersion,
    update_available: false,
    release_notes: null,
    published_at: null,
    release_url: null,
  };
}

export async function GET(request: NextRequest) {
  try {
    await authenticate(request, [API_SCOPES.SYSTEM_READ]);

    const force = request.nextUrl.searchParams.get('force') === 'true';
    const currentVersion = APP_VERSION;

    // Return cached data if fresh
    if (!force && releaseCache && Date.now() - releaseCache.fetchedAt < CACHE_TTL_MS) {
      const cached = { ...releaseCache.data, current_version: currentVersion };
      cached.update_available = isNewerVersion(currentVersion, cached.latest_version);
      return withNoStore(jsonResponse(successResponse(cached), request));
    }

    // Fetch from GitHub API with bounded timeout — GitHub rate-limit / network
    // issues must not hang the dashboard's update-check on mount. On any upstream
    // failure (rate-limit, abort, network) we degrade gracefully to "no update
    // info available", not a 502 — the dashboard hook treats this as "you're
    // up to date" and doesn't bother the admin.
    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        {
          headers: { 'Accept': 'application/vnd.github.v3+json' },
          cache: 'no-store', // module-level releaseCache handles TTL — skip Next.js Data Cache
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        }
      );
    } catch {
      return withNoStore(jsonResponse(successResponse(unknownUpstreamResponse(currentVersion)), request));
    }

    if (!response.ok) {
      return withNoStore(jsonResponse(successResponse(unknownUpstreamResponse(currentVersion)), request));
    }

    const release = await response.json();
    const rawTag = (release.tag_name || '').replace(/^v/, '');
    // Validate tag is semver-like to prevent spoofed responses
    const latestVersion = /^\d+\.\d+/.test(rawTag) ? rawTag : currentVersion;

    // Only accept release URLs from the expected GitHub repo
    const expectedUrlPrefix = `https://github.com/${GITHUB_REPO}/releases/`;
    const releaseUrl = typeof release.html_url === 'string' && release.html_url.startsWith(expectedUrlPrefix)
      ? release.html_url
      : null;

    // Validate third-party API response fields (§18: don't blindly trust external APIs)
    const releaseNotes = typeof release.body === 'string' ? release.body.slice(0, 10000) : null;
    const publishedAt = typeof release.published_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(release.published_at)
      ? release.published_at
      : null;

    const data: UpdateCheckData = {
      current_version: currentVersion,
      latest_version: latestVersion,
      update_available: isNewerVersion(currentVersion, latestVersion),
      release_notes: releaseNotes,
      published_at: publishedAt,
      release_url: releaseUrl,
    };

    // Cache the result
    releaseCache = { data, fetchedAt: Date.now() };

    return withNoStore(jsonResponse(successResponse(data), request));
  } catch (error) {
    return handleApiError(error, request);
  }
}
