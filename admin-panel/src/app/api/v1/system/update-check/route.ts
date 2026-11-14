/**
 * GET /api/v1/system/update-check
 *
 * Checks GitHub for the latest release and compares with current version.
 * The version comes from the github.com release redirect (not api.github.com,
 * whose 60 requests/hour per address shared NATs exhaust). Release notes are an
 * optional extra from the API. Failures are returned as `check_error`.
 * Server-side cache: 1 hour. Query param ?force=true bypasses cache.
 *
 * @see /admin-panel/scripts/upgrade.sh
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUpdaterCompatibility, refreshUpdaterCompatibility, withUpdaterCompatibility } from '@/lib/system/updater-compatibility';
import { fetchLatestReleaseTag, isReleaseTag, ReleaseFetchError, releaseTagUrl, SELLF_GITHUB_REPO, toUpdateFailure } from '@/lib/system/github-release';
import { getUpgradeCapability } from '@/lib/system/upgrade-runtime-server';
import {
  handleCorsPreFlight,
  jsonResponse,
  authenticate,
  handleApiError,
  API_SCOPES,
} from '@/lib/api';
import { isNewerVersion, APP_VERSION } from '@/lib/version';
import type { UpdaterCompatibility, UpgradeCapability } from '@/lib/system/upgrade-runtime';
import type { UpdateFailure } from '@/lib/system/update-failure';
import { successResponse } from '@/lib/api/types';

/** Prevent proxy/CDN caching of version info */
function withNoStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res;
}

// Process identity is returned only after SYSTEM_READ admin authentication.
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedRelease {
  data: UpdateCheckData;
  fetchedAt: number;
}

interface UpdateCheckData {
  upgrade: UpgradeCapability;
  updater?: UpdaterCompatibility;
  current_version: string;
  started_at: string;
  latest_version: string;
  update_available: boolean;
  release_notes: string | null;
  published_at: string | null;
  release_url: string | null;
  check_error?: UpdateFailure;
}

interface ReleaseMetadata {
  tag: string;
  notes: string | null;
  publishedAt: string | null;
  url: string | null;
}

let releaseCache: CachedRelease | null = null;

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

function unknownUpstreamResponse(currentVersion: string, checkError: UpdateFailure): UpdateCheckData {
  return {
    check_error: checkError,
    upgrade: getUpgradeCapability(),
    current_version: currentVersion,
    started_at: PROCESS_STARTED_AT,
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
      const updater = refreshUpdaterCompatibility(releaseCache.data.updater);
      const cached = { ...releaseCache.data, ...(updater ? { updater } : {}), upgrade: withUpdaterCompatibility(getUpgradeCapability(), updater), current_version: currentVersion, started_at: PROCESS_STARTED_AT };
      cached.update_available = isNewerVersion(currentVersion, cached.latest_version);
      return withNoStore(jsonResponse(successResponse(cached), request));
    }

    let release: ReleaseMetadata;
    try {
      release = process.env.SELLF_UPDATE_CHECK_URL
        ? await fetchOverrideMetadata(process.env.SELLF_UPDATE_CHECK_URL)
        : await fetchOfficialMetadata();
    } catch (error) {
      return withNoStore(jsonResponse(successResponse(unknownUpstreamResponse(currentVersion, toUpdateFailure(error))), request));
    }
    const latestVersion = release.tag.replace(/^v/, '');
    const releaseNotes = release.notes;
    const publishedAt = release.publishedAt;
    const releaseUrl = release.url;

    const capability = getUpgradeCapability();
    // Manual runtimes follow their own deployment procedure.
    const updater = capability.mode === 'in-place' ? await getUpdaterCompatibility(release.tag) : undefined;
    const data: UpdateCheckData = {
      upgrade: withUpdaterCompatibility(capability, updater),
      ...(updater ? { updater } : {}),
      current_version: currentVersion,
      started_at: PROCESS_STARTED_AT,
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

const RELEASE_TIMEOUT_MS = 5000;

/** Validates third-party release JSON fields; never trusts them blindly. */
function parseReleaseJson(release: Record<string, unknown>): Omit<ReleaseMetadata, 'tag'> & { tag: string | null } {
  const tag = typeof release.tag_name === 'string' && isReleaseTag(release.tag_name) ? release.tag_name : null;
  const expectedUrlPrefix = `https://github.com/${SELLF_GITHUB_REPO}/releases/`;
  return {
    tag,
    notes: typeof release.body === 'string' ? release.body.slice(0, 10000) : null,
    publishedAt: typeof release.published_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(release.published_at) ? release.published_at : null,
    url: typeof release.html_url === 'string' && release.html_url.startsWith(expectedUrlPrefix) ? release.html_url : null,
  };
}

async function fetchReleaseJson(url: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github.v3+json' },
    cache: 'no-store', // module-level releaseCache handles TTL — skip Next.js Data Cache
    redirect: 'error',
    signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const json: unknown = await response.json();
  return json && typeof json === 'object' ? json as Record<string, unknown> : null;
}

/** Version from the github.com redirect; notes only when the API answers for that tag. */
async function fetchOfficialMetadata(): Promise<ReleaseMetadata> {
  const tag = await fetchLatestReleaseTag();
  let notes: string | null = null;
  let publishedAt: string | null = null;
  try {
    const json = await fetchReleaseJson(`https://api.github.com/repos/${SELLF_GITHUB_REPO}/releases/tags/${tag}`);
    const parsed = json ? parseReleaseJson(json) : null;
    if (parsed?.tag === tag) {
      notes = parsed.notes;
      publishedAt = parsed.publishedAt;
    }
  } catch {
    // Release notes are optional; the version above does not depend on them.
  }
  return { tag, notes, publishedAt, url: releaseTagUrl(tag) };
}

/** Notification metadata from SELLF_UPDATE_CHECK_URL (GitHub release JSON format). */
async function fetchOverrideMetadata(url: string): Promise<ReleaseMetadata> {
  let json: Record<string, unknown> | null;
  try {
    json = await fetchReleaseJson(url);
  } catch {
    throw new ReleaseFetchError({ code: 'github_unreachable', details: {} });
  }
  const parsed = json ? parseReleaseJson(json) : null;
  if (!parsed?.tag) throw new ReleaseFetchError({ code: 'release_lookup_invalid', details: {} });
  return { ...parsed, tag: parsed.tag };
}
