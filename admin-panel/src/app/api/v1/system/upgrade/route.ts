/**
 * POST /api/v1/system/upgrade
 *
 * Triggers the self-upgrade process by running upgrade.sh as a detached process.
 * Returns immediately with an upgrade token for progress tracking.
 *
 * Security:
 * - Admin-only (SYSTEM_WRITE scope)
 * - One launch at a time: a request that is still checking the release, a launch
 *   from the last few seconds (double click) or a held updater lock refuses the
 *   next one. A failed attempt releases all three at once, so a retry is immediate.
 * - Audit logged before launch (admin's auth user UUID); a refused audit entry starts nothing
 *
 * @see /admin-panel/scripts/upgrade.sh
 * @see /api/v1/system/upgrade-status
 */

import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { openSync, closeSync, readFileSync } from 'fs';
import { resolve, basename, dirname, isAbsolute } from 'path';
import { findUpgradeScript, getUpgradeInstallDir, getUpgradeCapability } from '@/lib/system/upgrade-runtime-server';
import {
  handleCorsPreFlight,
  jsonResponse,
  authenticate,
  handleApiError,
  API_SCOPES,
} from '@/lib/api';
import { checkLatestUpdaterCompatibility } from '@/lib/system/updater-compatibility';
import { createPlatformClient } from '@/lib/supabase/admin';
import { recordAuditEntry } from '@/lib/audit/audit-entry';
import { isUpgradeLockHeld } from '@/lib/system/upgrade-lock';
import { getUpgradeLockFilePath, getUpgradeLogFilePath, getUpgradeProgressFilePath } from '@/lib/system/upgrade-paths';

/** Covers the gap between launching the script and the script taking its lock. */
const LAUNCH_GUARD_MS = 10_000;
let checkInFlight = false;
let lastLaunch: { token: string; at: number } | null = null;

export function _resetUpgradeLaunchGuardForTests(): void {
  checkInFlight = false;
  lastLaunch = null;
}

function lastLaunchFailed(token: string): boolean {
  try {
    return (JSON.parse(readFileSync(getUpgradeProgressFilePath(token), 'utf8')) as { step?: unknown }).step === 'failed';
  } catch {
    return false;
  }
}

function launchGuardActive(): boolean {
  if (checkInFlight) return true;
  if (!lastLaunch || Date.now() - lastLaunch.at >= LAUNCH_GUARD_MS) return false;
  return !lastLaunchFailed(lastLaunch.token);
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.SYSTEM_WRITE]);

    const upgrade = getUpgradeCapability();
    if (upgrade.mode !== 'in-place') {
      return jsonResponse({ error: { code: 'MANUAL_UPGRADE_REQUIRED', message: 'Use the deployment upgrade instructions for this runtime.' }, data: { upgrade } }, request, 409);
    }

    if (launchGuardActive()) {
      return jsonResponse(
        { error: { code: 'UPGRADE_STARTING', message: 'An update is starting. Wait a few seconds before trying again.' } },
        request,
        409
      );
    }
    checkInFlight = true;
    try {
      return await launchUpgrade(request, auth);
    } finally {
      checkInFlight = false;
    }
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function launchUpgrade(request: NextRequest, auth: Awaited<ReturnType<typeof authenticate>>) {
  // Find upgrade script first (needed to derive instance name for lock check)
  const scriptPath = findUpgradeScript();

  if (!scriptPath) {
    return jsonResponse(
      { error: { code: 'NOT_FOUND', message: 'Upgrade script not found. Self-upgrade is only available on deployed servers.' } },
      request,
      400
    );
  }

  // No files, audit entry or launcher before fresh signed compatibility checks.
  const updater = await checkLatestUpdaterCompatibility();
  if (!updater.compatible) {
    return jsonResponse({ error: {
      code: updater.reason === 'too_old' ? 'UPDATER_TOO_OLD' : 'UPDATER_VERIFICATION_FAILED',
      message: updater.message,
      ...(updater.failure ? { failure: updater.failure } : {}),
    }, data: { updater } }, request, 409);
  }

  // Derive INSTALL_DIR from cwd in standalone mode so the script doesn't
  // fall back to glob auto-detection (which picks the first sellf-* dir
  // alphabetically and can target the wrong instance, e.g. sellf-demo
  // instead of sellf-tsa).
  // In standalone, cwd = <install>/admin-panel/.next/standalone/admin-panel
  // so three levels up = <install>/admin-panel
  const installDir = getUpgradeInstallDir();

  // Check per-instance lock file (keyed on stack dir basename, not global).
  // installDir = /opt/stacks/sellf-tsa/admin-panel → parent = sellf-tsa
  // This matches the lock key used by upgrade.sh.
  const instanceName = installDir ? basename(resolve(installDir, '..')) : 'unknown';
  const instanceLockFile = getUpgradeLockFilePath(instanceName);
  if (await isUpgradeLockHeld(instanceLockFile)) {
    return jsonResponse(
      { error: { code: 'UPGRADE_RUNNING', message: 'An update is already running. Wait for it to finish.' } },
      request,
      409
    );
  }

  // The update runs outside the database (systemd + upgrade.sh), so no transaction can cover it. The
  // entry records the admin's REQUEST before anything starts (no entry, no update); it is not proof
  // that the update ran — the upgrade log and status are. A launcher failure adds an outcome entry
  // instead of deleting the request. performed_by references auth.users, so it is the admin's auth
  // user UUID (for an API key, the key owner's), never the e-mail; audit_log.operation only accepts
  // INSERT/UPDATE/DELETE, the kind of action lives in new_values.
  const token = randomUUID();
  const auditClient = createPlatformClient();
  const audit = await recordAuditEntry(auditClient, {
    user_id: auth.admin.userId,
    performed_by: auth.admin.userId,
    table_name: 'system',
    operation: 'UPDATE',
    new_values: {
      action: 'system_upgrade_requested',
      current_version: process.env.NEXT_PUBLIC_APP_VERSION || 'unknown',
      upgrade_token: token,
    },
  });
  if (!audit.ok) {
    console.error('[system/upgrade] Audit log insert failed:', audit.error);
    return jsonResponse(
      { error: { code: 'INTERNAL_ERROR', message: 'The update could not be recorded in the audit log, so it was not started.' } },
      request,
      500
    );
  }

  try {
    // Create log file with restricted permissions before launching.
    // upgrade.sh writes to it via its own log() function using >>.
    const logFile = getUpgradeLogFilePath(token);
    const logFd = openSync(logFile, 'w', 0o600);
    closeSync(logFd);

    // Launch upgrade via systemd transient service so it runs in its own
    // cgroup, independent of pm2-root.service. This is necessary because
    // PM2 v6 (Go) kills the entire cgroup when stopping a managed process,
    // which would terminate upgrade.sh mid-run even with detached: true.
    //
    // systemd-run creates a new scope under system.slice/<unit>.service
    // that is unaffected by pm2 stop on the parent process.
    //
    // The script verifies the signed release manifest with the public key
    // embedded in the installed upgrade.sh and refuses a version older than
    // the installed one; neither check can be switched off.
    const scriptArgs = installDir ? [scriptPath, token, installDir] : [scriptPath, token];
    // Drop unusable entries (including implicit cwd lookup) while retaining the
    // running executable's directory. Log counts only, never environment values.
    // Keep this as one spawn argument; no shell interpolation is involved.
    const pathEntries = process.env.PATH === undefined ? [] : process.env.PATH.split(':');
    const validPathEntries = pathEntries.filter((entry) => isAbsolute(entry) && !/[:\x00-\x1f\x7f]/.test(entry));
    const droppedCount = pathEntries.length - validPathEntries.length;
    if (droppedCount > 0) {
      console.warn(`[system/upgrade] Skipped ${droppedCount} unusable PATH entries`);
    }
    const upgradePath = [...new Set([...validPathEntries, dirname(process.execPath)])].join(':');
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
      `--setenv=PATH=${upgradePath}`,
      '--',
      'bash', ...scriptArgs,
    ];
    // Wait for the launcher to acknowledge creation of the transient service.
    // --no-block still lets the upgrade run independently of this request.
    await new Promise<void>((accept, reject) => {
      const child = spawn('/usr/bin/systemd-run', systemdRunArgs, {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? accept() : reject(new Error('Upgrade launcher failed')));
    });
  } catch (launchError) {
    // The update never started: the request stays recorded, with its outcome next to it.
    const outcome = await recordAuditEntry(auditClient, {
      user_id: auth.admin.userId,
      performed_by: auth.admin.userId,
      table_name: 'system',
      operation: 'UPDATE',
      new_values: { action: 'system_upgrade_launch_failed', upgrade_token: token, request_audit_id: audit.id },
    });
    if (!outcome.ok) console.error('[system/upgrade] Outcome entry refused:', outcome.error);
    throw launchError;
  }
  lastLaunch = { token, at: Date.now() };

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
}
