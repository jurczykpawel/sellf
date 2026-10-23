/** Bounded local server startup, including Next's documented one-shot command retry.
 * @see scripts/stripe-live-runner.ts
 */
interface ServerProcess {
  exitCode: number | null;
  signalCode: string | null;
}
interface ServerStartup {
  start: () => ServerProcess;
  isReady: () => Promise<boolean>;
  hasUpgradeNotice: () => boolean;
  timeoutMs?: number;
}

export async function waitForLiveServer(options: ServerStartup): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 120000);
  let child = options.start();
  let restarted = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      if (!restarted && child.exitCode === 1 && options.hasUpgradeNotice()) {
        restarted = true;
        child = options.start();
        continue;
      }
      throw new Error('Local server exited before becoming ready');
    }
    if (await options.isReady()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for local server');
}
