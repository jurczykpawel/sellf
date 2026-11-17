/**
 * Installation directory of a standalone release (the directory holding .next/, .env.local and
 * scripts/upgrade.sh). Dependency-free so the proxy can use it.
 *
 * @see scripts/upgrade.sh (INSTALL_DIR)
 */
import { resolve } from 'path';

/** In standalone mode the server runs in <install>/.next/standalone/admin-panel; null otherwise. */
export function getUpgradeInstallDir(): string | null {
  const cwd = process.cwd();
  return cwd.endsWith('/.next/standalone/admin-panel') ? resolve(cwd, '../../..') : null;
}
