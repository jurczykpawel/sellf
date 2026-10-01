/**
 * Shared path resolution for the self-upgrade lock/log/progress files
 * (L16). These previously lived directly under the world-writable /tmp
 * with a predictable name (/tmp/sellf-upgrade-<token>.json,
 * /tmp/sellf-upgrade-<instance>.lock) — any local user on a shared box
 * could pre-create one of those exact paths ahead of time (classic /tmp
 * race), causing a permanent conflict for the real process.
 *
 * Prefer /run/sellf (mode 0700): the rest of this deploy path already
 * assumes the app runs as root (upgrade.sh defaults HOME/PM2_HOME to
 * /root), and /run is only writable by root by default, so a non-root
 * local user cannot create anything under it at all — not just "cannot
 * read the 0700 directory", but cannot race-create it in the first
 * place. If /run/sellf can't be created (e.g. a future non-root
 * deployment, or /run genuinely unavailable), fall back to the original
 * /tmp/sellf-upgrade-<name> layout rather than inventing a new
 * self-verified-ownership scheme under time pressure — that's the
 * pre-existing, already-accepted risk level, not a regression.
 *
 * scripts/upgrade.sh mirrors this exact same resolution independently in
 * bash (its RUNTIME_DIR block) — both sides agree without passing the
 * chosen directory between processes, since it's a deterministic
 * function of "is /run/sellf writable right now" on the same machine.
 */
import { mkdirSync } from 'fs';

const PREFERRED_DIR = '/run/sellf';

let cachedDir: string | null = null;

export function getUpgradeRuntimeDir(): string {
  if (cachedDir) return cachedDir;

  // Only attempt /run/sellf when actually running as root. This isn't just
  // an optimization: `mkdirSync(..., { recursive: true })` succeeds as a
  // no-op if the directory already exists, REGARDLESS of who owns it — so
  // a non-root process could otherwise "succeed" against a 0700 directory
  // a previous root-owned run already created (e.g. after migrating this
  // deployment to a non-root user without a reboot in between, since /run
  // is normally tmpfs and would otherwise self-heal on the next boot), then
  // fail on every actual read/write inside it. Checking the uid first
  // means a non-root process never touches /run/sellf at all.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot) {
    try {
      mkdirSync(PREFERRED_DIR, { recursive: true, mode: 0o700 });
      cachedDir = PREFERRED_DIR;
      return cachedDir;
    } catch {
      // Fall through to /tmp below.
    }
  }

  cachedDir = '/tmp';
  return cachedDir;
}

/** Filename prefix — kept identical to the legacy /tmp layout so ops tooling grepping for it still finds these. */
const FILE_PREFIX = 'sellf-upgrade-';

export function getUpgradeProgressFilePath(token: string): string {
  return `${getUpgradeRuntimeDir()}/${FILE_PREFIX}${token}.json`;
}

export function getUpgradeLogFilePath(token: string): string {
  return `${getUpgradeRuntimeDir()}/${FILE_PREFIX}${token}.log`;
}

export function getUpgradeLockFilePath(instanceName: string): string {
  return `${getUpgradeRuntimeDir()}/${FILE_PREFIX}${instanceName}.lock`;
}

/** For tests only — clears the memoized directory choice between cases. */
export function _resetUpgradeRuntimeDirCacheForTests(): void {
  cachedDir = null;
}
