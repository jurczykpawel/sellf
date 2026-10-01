/**
 * GET /api/v1/system/upgrade-status?token={uuid}
 *
 * Reads upgrade progress from the file written by upgrade.sh during the
 * self-upgrade process — see lib/system/upgrade-paths.ts for the resolved
 * location (prefers /run/sellf/, falls back to /tmp/).
 *
 * @see /admin-panel/scripts/upgrade.sh
 * @see /api/v1/system/upgrade
 */

import { NextRequest } from 'next/server';
import { readFileSync, openSync, closeSync, fstatSync, constants } from 'fs';
import {
  handleCorsPreFlight,
  jsonResponse,
  authenticate,
  handleApiError,
  apiError,
  API_SCOPES,
} from '@/lib/api';
import { checkRateLimit } from '@/lib/rate-limiting';
import { getUpgradeProgressFilePath } from '@/lib/system/upgrade-paths';

function pendingResponse(request: NextRequest) {
  const response = jsonResponse({
    data: {
      step: 'pending',
      progress: 0,
      message: 'Waiting for upgrade process to start...',
    },
  }, request);
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return response;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.SYSTEM_READ]);

    // Rate limit: 30 req/min per user (client polls every 3s = ~20 req/min)
    const rateLimitOk = await checkRateLimit('upgrade_status', 30, 1, auth.admin.userId);
    if (!rateLimitOk) {
      return jsonResponse(
        { error: { code: 'RATE_LIMITED', message: 'Too many status requests. Please slow down.' } },
        request,
        429
      );
    }

    const token = request.nextUrl.searchParams.get('token');
    if (!token || !UUID_RE.test(token)) {
      return apiError(request, 'VALIDATION_ERROR', 'Invalid upgrade token');
    }

    // Sanitized path — token is validated as UUID, no path traversal possible
    const progressFile = getUpgradeProgressFilePath(token);

    let fd: number;
    let legacyFile = progressFile.startsWith('/tmp/');
    try {
      fd = openSync(progressFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        if (legacyFile) return pendingResponse(request);
        // Older upgrade scripts keep writing to /tmp after the server restarts.
        try {
          fd = openSync(`/tmp/sellf-upgrade-${token}.json`, constants.O_RDONLY | constants.O_NOFOLLOW);
          legacyFile = true;
        } catch (legacyError: unknown) {
          const legacyCode = (legacyError as NodeJS.ErrnoException).code;
          if (legacyCode === 'ENOENT' || legacyCode === 'ELOOP') return pendingResponse(request);
          throw legacyError;
        }
      } else if (code === 'ELOOP') {
        return apiError(request, 'VALIDATION_ERROR', 'Invalid progress file');
      } else {
        throw err;
      }
    }

    try {
      const stat = fstatSync(fd);
      if (legacyFile && (!stat.isFile() || typeof process.getuid !== 'function' || stat.uid !== process.getuid())) {
        return pendingResponse(request);
      }
      if (!stat.isFile()) {
        return apiError(request, 'VALIDATION_ERROR', 'Invalid progress file');
      }
      const content = readFileSync(fd, 'utf-8');
      const raw = JSON.parse(content);
      // Return only the supported progress fields.
      const progress = {
        step: typeof raw.step === 'string' ? raw.step : 'unknown',
        progress: typeof raw.progress === 'number' ? raw.progress : 0,
        message: typeof raw.message === 'string' ? raw.message.slice(0, 500) : '',
        ...(typeof raw.rollback === 'boolean' ? { rollback: raw.rollback } : {}),
        ...(typeof raw.timestamp === 'string' ? { timestamp: raw.timestamp } : {}),
      };
      const res = jsonResponse({ data: progress }, request);
      res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res;
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    return handleApiError(error, request);
  }
}
