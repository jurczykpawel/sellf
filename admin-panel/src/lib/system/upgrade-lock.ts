/**
 * Whether an update currently holds the per-instance updater lock.
 * scripts/upgrade.sh takes `flock -n` on the lock file for its whole run and
 * removes the file on exit; a file left by a killed run is not held by anyone.
 *
 * @see scripts/upgrade.sh (LOCK section)
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';

const LOCK_CONFLICT_EXIT = 75;

export async function isUpgradeLockHeld(lockFile: string): Promise<boolean> {
  if (!existsSync(lockFile)) return false;
  return new Promise<boolean>(resolve => {
    const probe = spawn('flock', ['-n', '-E', String(LOCK_CONFLICT_EXIT), lockFile, 'true'], { stdio: 'ignore' });
    // Anything other than a clean free-lock result is treated as a running update.
    probe.once('error', () => resolve(true));
    probe.once('exit', code => resolve(code !== 0));
  });
}
