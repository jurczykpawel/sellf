/**
 * Maintenance mode, the server source (like WordPress `.maintenance`): a file on the server or the
 * SELLF_MAINTENANCE env flag. Read with the file system only, never the database, so it works while
 * the database is down or an update/restore runs. scripts/upgrade.sh creates and removes the file.
 *
 * File: SELLF_MAINTENANCE_FILE, else <install>/MAINTENANCE in a standalone release (next to
 * .env.local), else <cwd>/MAINTENANCE. Its content is optional: empty, plain text (the message), or
 * the JSON written by upgrade.sh ({ reason, started_at, message?, expected_end_at? }).
 *
 * @see scripts/upgrade.sh (maintenance-file block)
 * @see src/lib/maintenance/state.ts
 */
import { closeSync, openSync, readSync, statSync } from 'fs';
import { resolve } from 'path';
import { getUpgradeInstallDir } from '@/lib/system/install-dir';

export const MAINTENANCE_FILE_NAME = 'MAINTENANCE';
export const MAINTENANCE_MESSAGE_MAX = 500;
const MAX_FILE_BYTES = 4096;
const ENV_ON = new Set(['1', 'true', 'on', 'yes']);

export interface ServerMaintenance {
  source: 'file' | 'env';
  /** Absolute file path for the file source, null for the env flag. */
  path: string | null;
  /** Who created the file, e.g. 'upgrade' or 'migration_state_unknown' (upgrade.sh). */
  reason: string | null;
  message: string | null;
  expectedEndAt: string | null;
  startedAt: string | null;
}

export function getMaintenanceFilePath(): string {
  const configured = process.env.SELLF_MAINTENANCE_FILE?.trim();
  if (configured) return resolve(configured);
  return resolve(getUpgradeInstallDir() ?? process.cwd(), MAINTENANCE_FILE_NAME);
}

/** A message a visitor may see: trimmed, non-empty, at most MAINTENANCE_MESSAGE_MAX characters. */
export function cleanMaintenanceMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAINTENANCE_MESSAGE_MAX ? trimmed : null;
}

export function cleanTimestamp(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

function readHead(path: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(MAX_FILE_BYTES);
    const length = readSync(fd, buffer, 0, MAX_FILE_BYTES, 0);
    return buffer.subarray(0, length).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function parseFile(content: string | null): Pick<ServerMaintenance, 'reason' | 'message' | 'expectedEndAt' | 'startedAt'> {
  const empty = { reason: null, message: null, expectedEndAt: null, startedAt: null };
  const text = content?.trim();
  if (!text) return empty;
  if (text.startsWith('{')) {
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const reason = typeof data.reason === 'string' && /^[a-z_]{1,64}$/.test(data.reason) ? data.reason : null;
      return { reason, message: cleanMaintenanceMessage(data.message), expectedEndAt: cleanTimestamp(data.expected_end_at), startedAt: cleanTimestamp(data.started_at) };
    } catch {
      // Not JSON after all: show it as a plain-text message below.
    }
  }
  return { ...empty, message: cleanMaintenanceMessage(text) };
}

/** SELLF_MAINTENANCE=1|true|on|yes switches maintenance mode on from the environment. */
export function isMaintenanceEnvOn(): boolean {
  return ENV_ON.has((process.env.SELLF_MAINTENANCE ?? '').trim().toLowerCase());
}

/** The server source, or null when neither the file nor the env flag is present. */
export function readServerMaintenance(): ServerMaintenance | null {
  const path = getMaintenanceFilePath();
  // Any entry at the path counts, also one that cannot be read: the file fails closed.
  let present = false;
  try {
    present = !!statSync(path, { throwIfNoEntry: false });
  } catch (error) {
    console.error('[readServerMaintenance] Error:', error instanceof Error ? error.message : 'Unknown error');
  }
  if (present) {
    return { source: 'file', path, ...parseFile(readHead(path)) };
  }
  if (isMaintenanceEnvOn()) {
    return { source: 'env', path: null, reason: null, message: null, expectedEndAt: null, startedAt: null };
  }
  return null;
}
