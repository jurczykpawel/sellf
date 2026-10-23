/** Real child-process startup and readiness checks for the live test runner. */
import { spawn } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { waitForLiveServer } from '../../../scripts/stripe-live-server';

const children: ChildProcess[] = [];
afterEach(() => { for (const child of children.splice(0)) child.kill('SIGKILL'); });

function harness(scripts: string[]) {
  let calls = 0;
  let url = '';
  let notice = false;
  return {
    count: () => calls,
    start: () => {
      const child = spawn(process.execPath, ['-e', scripts[calls++]], { stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      child.stdout!.on('data', chunk => {
        const text = chunk.toString();
        notice ||= text.includes('This command stopped to show the upgrade recommendation.');
        const port = text.match(/PORT=(\d+)/)?.[1];
        if (port) url = `http://127.0.0.1:${port}`;
      });
      return child;
    },
    hasUpgradeNotice: () => notice,
    isReady: async () => {
      if (!url) return false;
      try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
    },
  };
}
const stopped = "console.log('This command stopped to show the upgrade recommendation.'); process.exitCode=1;";
const ready = "const s=require('http').createServer((q,r)=>r.end('ok'));s.listen(0,'127.0.0.1',()=>console.log('PORT='+s.address().port));";

it('repeats a notified Next startup and awaits the real HTTP server', async () => {
  const h = harness([stopped, ready]);
  await waitForLiveServer({ ...h, timeoutMs: 10000 });
  expect(h.count()).toBe(2);
});
it('reports an ordinary failed process without a restart', async () => {
  const h = harness(['process.exit(1)']);
  await expect(waitForLiveServer({ ...h, timeoutMs: 10000 })).rejects.toThrow('Local server exited');
  expect(h.count()).toBe(1);
});
it('stops after a second notified exit', async () => {
  const h = harness([stopped, stopped]);
  await expect(waitForLiveServer({ ...h, timeoutMs: 10000 })).rejects.toThrow('Local server exited');
  expect(h.count()).toBe(2);
});
it('bounds waiting for a running process that never serves HTTP', async () => {
  const h = harness(['setInterval(()=>{},1000)']);
  await expect(waitForLiveServer({ ...h, timeoutMs: 100 })).rejects.toThrow('Timed out');
  expect(h.count()).toBe(1);
});
