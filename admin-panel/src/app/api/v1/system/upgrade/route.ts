/**
 * POST /api/v1/system/upgrade
 *
 * Triggers the self-upgrade process by running upgrade.sh as a detached process.
 * Returns immediately with an upgrade token for progress tracking.
 *
 * Security:
 * - Admin-only (SYSTEM_WRITE scope)
 * - Rate limited: 1 request per 10 minutes
 * - Lock file prevents concurrent upgrades
 * - Audit logged
 *
 * @see /admin-panel/scripts/upgrade.sh
 * @see /api/v1/system/upgrade-status
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  authenticate,
  handleApiError,
  API_SCOPES,
} from '@/lib/api';
import { createPlatformClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { existsSync, openSync, closeSync } from 'fs';
import { resolve, basename } from 'path';

/**
 * Resolve upgrade script path dynamically based on process.cwd().
 * Supports both standalone (production) and development layouts:
 *   - Standalone: cwd = /opt/stacks/sellf-{name}/admin-panel/.next/standalone/admin-panel
 *     → script at ../../scripts/upgrade.sh (relative to install root)
 *   - Development: cwd = /path/to/admin-panel
 *     → script at ./scripts/upgrade.sh
 */
function findUpgradeScript(): string | null {
  const cwd = process.cwd();

  // Candidate paths relative to cwd and common install roots
  const candidates = [
    // Standalone: script is alongside .next/ in the install dir
    resolve(cwd, '..', '..', '..', 'scripts', 'upgrade.sh'),
    // Standalone: script copied into standalone dir
    resolve(cwd, 'scripts', 'upgrade.sh'),
    // Development
    resolve(cwd, '..', 'scripts', 'upgrade.sh'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.SYSTEM_WRITE]);

    // Rate limit: 1 request per 10 minutes
    const rateLimitOk = await checkRateLimit('system_upgrade', 1, 10, auth.admin.userId);
    if (!rateLimitOk) {
      return jsonResponse(
        { error: { code: 'RATE_LIMITED', message: 'Upgrade already triggered recently. Please wait before retrying.' } },
        request,
        429
      );
    }

    // Find upgrade script first (needed to derive instance name for lock check)
    const scriptPath = findUpgradeScript();

    if (!scriptPath) {
      return jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'Upgrade script not found. Self-upgrade is only available on deployed servers.' } },
        request,
        400
      );
    }

    // Generate upgrade token
    const token = randomUUID();

    // Audit log
    try {
      const platformClient = createPlatformClient();
      await platformClient.from('audit_log').insert({
        user_id: auth.admin.userId,
        operation: 'system_upgrade_triggered',
        table_name: 'system',
        performed_by: auth.admin.email || 'unknown',
        new_values: {
          current_version: process.env.NEXT_PUBLIC_APP_VERSION || 'unknown',
          upgrade_token: token,
        },
      });
    } catch (auditErr) {
      console.error('[system/upgrade] Audit log insert failed:', auditErr instanceof Error ? auditErr.message : 'Unknown error');
    }

    // Derive INSTALL_DIR from cwd in standalone mode so the script doesn't
    // fall back to glob auto-detection (which picks the first sellf-* dir
    // alphabetically and can target the wrong instance, e.g. sellf-demo
    // instead of sellf-tsa).
    // In standalone, cwd = <install>/admin-panel/.next/standalone/admin-panel
    // so three levels up = <install>/admin-panel
    const cwd = process.cwd();
    const installDir = cwd.includes('.next/standalone')
      ? resolve(cwd, '..', '..', '..')
      : null;

    // Check per-instance lock file (keyed on stack dir basename, not global).
    // installDir = /opt/stacks/sellf-tsa/admin-panel → parent = sellf-tsa
    // This matches the lock key used by upgrade.sh.
    const instanceName = installDir ? basename(resolve(installDir, '..')) : 'unknown';
    const instanceLockFile = `/tmp/sellf-upgrade-${instanceName}.lock`;
    if (existsSync(instanceLockFile)) {
      return jsonResponse(
        { error: { code: 'CONFLICT', message: 'An upgrade is already in progress.' } },
        request,
        409
      );
    }

    // Create log file with restricted permissions before launching.
    // upgrade.sh writes to it via its own log() function using >>.
    const logFile = `/tmp/sellf-upgrade-${token}.log`;
    const logFd = openSync(logFile, 'w', 0o600);
    closeSync(logFd);

    // Launch upgrade via systemd transient service so it runs in its own
    // cgroup, independent of pm2-root.service. This is necessary because
    // PM2 v6 (Go) kills the entire cgroup when stopping a managed process,
    // which would terminate upgrade.sh mid-run even with detached: true.
    //
    // systemd-run creates a new scope under system.slice/<unit>.service
    // that is unaffected by pm2 stop on the parent process.
    const scriptArgs = installDir ? [scriptPath, token, installDir] : [scriptPath, token];
    const systemdRunArgs = [
      `--unit=sellf-upgrade-${token}`,
      '--collect',   // auto-remove unit after exit
      '--no-block',  // return immediately, don't wait for completion
      // systemd-run creates a clean environment without $HOME. Pass it
      // explicitly so PM2 resolves the correct ~/.pm2 daemon socket instead
      // of defaulting to /etc/.pm2 (which doesn't exist and causes
      // pm2 stop/start to silently target a different daemon).
      '--setenv=HOME=/root',
      '--setenv=PM2_HOME=/root/.pm2',
      '--',
      'bash', ...scriptArgs,
    ];
    const child = spawn('systemd-run', systemdRunArgs, {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.unref();

    return jsonResponse(
      {
        data: {
          status: 'upgrading',
          token,
          message: 'Upgrade process started. Poll /api/v1/system/upgrade-status for progress.',
        },
      },
      request,
      202
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
