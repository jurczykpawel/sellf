/**
 * GET /api/v1/system/upgrade-status?token={uuid}
 *
 * Reads upgrade progress from /tmp/sellf-upgrade-{token}.json
 * written by upgrade.sh during the self-upgrade process.
 *
 * @see /admin-panel/scripts/upgrade.sh
 * @see /api/v1/system/upgrade
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  authenticate,
  handleApiError,
  apiError,
  API_SCOPES,
} from '@/lib/api';
import { readFileSync, openSync, closeSync, fstatSync, constants } from 'fs';
import { checkRateLimit } from '@/lib/rate-limiting';

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
    const progressFile = `/tmp/sellf-upgrade-${token}.json`;

    // Atomic open with O_NOFOLLOW — refuses symlinks at kernel level, no TOCTOU
    let fd: number;
    try {
      fd = openSync(progressFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return jsonResponse({
          data: {
            step: 'pending',
            progress: 0,
            message: 'Waiting for upgrade process to start...',
          },
        }, request);
      }
      if (code === 'ELOOP') {
        // O_NOFOLLOW on a symlink → ELOOP
        return apiError(request, 'VALIDATION_ERROR', 'Invalid progress file');
      }
      throw err;
    }

    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) {
        return apiError(request, 'VALIDATION_ERROR', 'Invalid progress file');
      }
      const content = readFileSync(fd, 'utf-8');
      const raw = JSON.parse(content);
      // Only expose known fields — don't leak unexpected data from the progress file (§19)
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
