/**
 * Version utilities for the update system.
 *
 * @see /api/admin/system/update-check
 */

import pkg from '../../package.json';

/** Current app version — read from package.json at build time (single source of truth). */
export const APP_VERSION: string = pkg.version;

/**
 * Compare two dot-separated version strings (CalVer YYYY.M.patch or semver).
 * Returns true if `latest` is newer than `current`.
 * RC precedes its stable version; candidate numbers are compared numerically.
 * Handles `v` prefix, partial versions (e.g. "2026.3" vs "2026.3.1").
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string) => /^(.*?)(?:-rc\.([1-9]\d*))?$/.exec(v.replace(/^v/, ''));
  const currentParts = parse(current);
  const latestParts = parse(latest);
  if (!currentParts || !latestParts || currentParts[1].includes('-') || latestParts[1].includes('-')) return false;
  const normalize = (v: string) => v.split('.').map(Number);
  const c = normalize(currentParts[1]);
  const l = normalize(latestParts[1]);

  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] || 0;
    const lv = l[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  const cr = currentParts[2];
  const lr = latestParts[2];
  return cr !== undefined && (lr === undefined || Number(lr) > Number(cr));
}
