/** Shared deployment capability contract. @see upgrade-runtime-server.ts */
export type DeploymentRuntime = 'pm2' | 'systemd' | 'docker' | 'compose' | 'coolify' | 'vercel' | 'netlify' | 'manual';
export interface UpgradeCapability {
  runtime: DeploymentRuntime;
  mode: 'in-place' | 'manual';
}
export interface UpgradeRuntimeSignals {
  container: boolean;
  standalone: boolean;
  root: boolean;
  linux: boolean;
  systemd: boolean;
  pm2: boolean;
  script: boolean;
}
const RUNTIMES: DeploymentRuntime[] = ['pm2', 'systemd', 'docker', 'compose', 'coolify', 'vercel', 'netlify', 'manual'];

export function detectUpgradeRuntime(env: Record<string, string | undefined>, signals: UpgradeRuntimeSignals): UpgradeCapability {
  const override = env.SELLF_DEPLOYMENT_RUNTIME;
  let runtime: DeploymentRuntime;
  if (override) runtime = RUNTIMES.includes(override as DeploymentRuntime) ? override as DeploymentRuntime : 'manual';
  else if (env.VERCEL === '1') runtime = 'vercel';
  else if (env.NETLIFY === 'true') runtime = 'netlify';
  else if (env.COOLIFY_RESOURCE_UUID || env.COOLIFY_CONTAINER_NAME) runtime = 'coolify';
  else if (signals.container) runtime = 'docker';
  else if (env.pm_id !== undefined) runtime = 'pm2';
  else if (env.INVOCATION_ID) runtime = 'systemd';
  else runtime = 'manual';

  const ready = runtime === 'pm2' && !signals.container && signals.standalone && signals.root &&
    signals.linux && signals.systemd && signals.pm2 && signals.script;
  return { runtime, mode: ready ? 'in-place' : 'manual' };
}
