/** Server preflight for the installed standalone updater. @see scripts/upgrade.sh */
import { execFileSync } from 'child_process';
import { accessSync, constants, existsSync } from 'fs';
import { basename, dirname, isAbsolute, resolve } from 'path';
import { detectUpgradeRuntime } from '@/lib/system/upgrade-runtime';
import type { UpgradeCapability } from '@/lib/system/upgrade-runtime';

export function findUpgradeScript(): string | null {
  const cwd = process.cwd();
  return [resolve(cwd, '../../..', 'scripts/upgrade.sh'), resolve(cwd, 'scripts/upgrade.sh')]
    .find(candidate => existsSync(candidate)) ?? null;
}

export function getUpgradeInstallDir(): string | null {
  const cwd = process.cwd();
  return cwd.endsWith('/.next/standalone/admin-panel') ? resolve(cwd, '../../..') : null;
}

function isExecutable(file: string): boolean {
  try { accessSync(file, constants.X_OK); return true; } catch { return false; }
}

export function getUpgradeCapability(): UpgradeCapability {
  const installDir = getUpgradeInstallDir();
  const container = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
  const root = typeof process.getuid === 'function' && process.getuid() === 0;
  const systemd = existsSync('/run/systemd/system') && isExecutable('/usr/bin/systemd-run');
  let pm2 = false;
  let script = false;
  if (installDir && root && systemd && !container) {
    try {
      accessSync(installDir, constants.W_OK);
      script = !!findUpgradeScript() && existsSync(resolve(installDir, '.env.local'));
      const candidates = [
        ...(process.env.PATH ?? '').split(':').filter(isAbsolute).map(dir => resolve(dir, 'pm2')),
        '/root/.bun/bin/pm2', '/usr/local/bin/pm2', '/usr/bin/pm2', resolve(dirname(process.execPath), 'pm2'),
      ];
      const executable = candidates.find(isExecutable);
      if (executable) {
        const processes: unknown = JSON.parse(execFileSync(executable, ['jlist'], {
          timeout: 3000, encoding: 'utf8', maxBuffer: 1024 * 1024,
          env: { ...process.env, HOME: '/root', PM2_HOME: '/root/.pm2' },
        }));
        pm2 = Array.isArray(processes) && processes.some(entry =>
          entry?.name === basename(dirname(installDir)) &&
          entry?.pm2_env?.exec_mode === 'fork_mode' && entry?.pm2_env?.pm_cwd === process.cwd()
        );
      }
    } catch { /* Incomplete installations use their deployment procedure. */ }
  }
  return detectUpgradeRuntime(process.env, {
    container, standalone: !!installDir, root, linux: process.platform === 'linux', systemd, pm2, script,
  });
}
