/** Temporary public transport for an owned HTTP receiver; closes with the test. */
import { appendFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export async function webhookTunnel(origin: string): Promise<{ url: string; close: () => Promise<void> }> {
  const directory = mkdtempSync(join(tmpdir(), 'sellf-webhook-'));
  const config = join(directory, 'config.yml'); writeFileSync(config, '{}\n', { mode: 0o600 });
  const child: ChildProcess = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--config', config, '--url', origin, '--protocol', 'http2'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const close = async () => {
    if (child.pid && child.exitCode === null && !child.signalCode) {
      await new Promise<void>(resolve => {
        const force = setTimeout(() => child.kill('SIGKILL'), 5000); force.unref();
        child.once('exit', () => { clearTimeout(force); resolve(); }); child.kill('SIGTERM');
      });
    }
    rmSync(directory, { recursive: true, force: true });
  };
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Public receiver transport did not start')), 45000);
      let log = '';
      const consume = (chunk: Buffer) => {
        if (process.env.WEBHOOK_TUNNEL_LOG) appendFileSync(process.env.WEBHOOK_TUNNEL_LOG, chunk);
        log = (log + chunk.toString()).slice(-16000);
        const match = [...log.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)].find(item => new URL(item[0]).hostname !== 'api.trycloudflare.com');
        if (match && new URL(match[0]).hostname !== 'api.trycloudflare.com') { clearTimeout(timeout); resolve(match[0]); }
      };
      child.stdout?.on('data', consume); child.stderr?.on('data', consume);
      child.once('error', () => { clearTimeout(timeout); reject(Error('Public receiver transport unavailable')); });
      child.once('exit', () => { clearTimeout(timeout); reject(Error('Public receiver transport stopped')); });
    });
    return { url, close };
  } catch (error) { await close(); throw error; }
}
