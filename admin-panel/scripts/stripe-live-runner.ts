/** Own the Stripe listener, local receiver, tunnel, and Playwright servers. */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { fetch as httpFetch } from 'undici';
import config from '../playwright.config';
import type { ChildProcess } from 'node:child_process';

const children: ChildProcess[] = [];
const dir = resolve('test-runs', `stripe-live-${new Date().toISOString().replaceAll(':', '-')}`);
let receiver: ReturnType<typeof createServer> | undefined;
let cleaning = false;
function redact(line: string): string {
  return line.replace(/(?:sk|pk|rk)_(?:test|live)_[\w]+|whsec_[\w]+/g, '[redacted]');
}
function start(command: string, args: string[], log: string, env = process.env): ChildProcess {
  const child = spawn(command, args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.on('error', () => { console.error(`Could not start ${command}`); });
  for (const stream of [child.stdout!, child.stderr!]) {
    createInterface({ input: stream }).on('line', line => {
      appendFileSync(`${dir}/${log}.jsonl`, JSON.stringify({ at: Date.now(), line: redact(line) }) + '\n');
    });
  }
  return child;
}
async function until(check: () => boolean | Promise<boolean>, description: string, timeout = 60000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}`);
}
function logText(name: string): string {
  try { return readFileSync(`${dir}/${name}.jsonl`, 'utf8'); } catch { return ''; }
}
async function cleanup(): Promise<void> {
  if (cleaning) return;
  cleaning = true;
  for (const child of children.reverse()) {
    if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ } }
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  for (const child of children) {
    if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }
  }
  receiver?.closeAllConnections();
  receiver?.close();
  spawnSync('bash', ['scripts/kill-dev-server.sh', '3777', '3779'], { stdio: 'ignore' });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void cleanup().then(() => process.exit(130)); });

let status = 1;
try {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith('sk_test_')) throw new Error('STRIPE_SECRET_KEY must be a Stripe test secret key');
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !['127.0.0.1', 'localhost'].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname)) throw new Error('This suite requires local disposable Supabase');
  for (const port of [3777, 3778, 3779]) {
    if (spawnSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN']).stdout.toString().trim()) throw new Error(`Port ${port} is already in use`);
  }
  for (const command of ['stripe', 'cloudflared']) if (spawnSync(command, ['--version']).status !== 0) throw new Error(`${command} is required`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(`${dir}/deliveries.jsonl`, '', { mode: 0o600 });
  process.env.STRIPE_LIVE_E2E = '1';
  process.env.STRIPE_LIVE_ARTIFACTS = dir;
  process.env.APP_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
  process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3777';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3777';
  process.env.SITE_URL = 'http://localhost:3777';
  // DB configuration takes precedence over env. Refuse an alternate configuration.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const configs = await db.from('stripe_configurations').select('id').eq('is_active', true);
  if (configs.error) throw new Error(configs.error.message);
  if (configs.data.length) throw new Error('Reset disposable Supabase first: active DB Stripe configuration overrides the listener secret');
  const secret = spawnSync('stripe', ['listen', '--api-key', key, '--print-secret'], { encoding: 'utf8', timeout: 30000 });
  const match = secret.stdout?.match(/whsec_[\w]+/);
  if (secret.status !== 0 || !match) throw new Error('Stripe CLI could not obtain a signing secret');
  process.env.STRIPE_WEBHOOK_SECRET = match[0];
  const receiverToken = randomUUID();
  receiver = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') { response.end('ok'); return; }
    if (request.method !== 'POST' || !request.url?.startsWith(`/${receiverToken}/`)) { response.writeHead(404).end(); return; }
    try {
      let rawBody = '';
      for await (const chunk of request) {
        rawBody += chunk.toString();
        if (rawBody.length > 1048576) { response.writeHead(413).end(); return; }
      }
      appendFileSync(`${dir}/deliveries.jsonl`, JSON.stringify({ at: Date.now(), path: request.url.slice(receiverToken.length + 1), headers: request.headers, rawBody, body: JSON.parse(rawBody) }) + '\n');
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"received":true}');
    } catch { response.writeHead(400).end(); }
  });
  await new Promise<void>((resolve, reject) => { receiver!.once('error', reject); receiver!.listen(3778, '127.0.0.1', resolve); });
  start('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:3778', '--no-autoupdate', '--no-prechecks', '--protocol', 'http2'], 'tunnel');
  await until(() => /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.test(logText('tunnel')), 'receiver tunnel');
  const tunnel = logText('tunnel').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)![0];
  process.env.STRIPE_LIVE_RECEIVER_URL = `${tunnel}/${receiverToken}`;
  // Check the public URL in the same Node runtime as Next and Playwright.
  await until(() => new Promise<boolean>(resolve => {
    const probe = spawn('node', ['-e',
    `fetch(${JSON.stringify(tunnel + '/health')}, { signal: AbortSignal.timeout(3000) }).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))`,
  ], { timeout: 4000, stdio: 'ignore' });
    probe.once('exit', code => resolve(code === 0));
    probe.once('error', () => resolve(false));
  }), 'public receiver', 300000);
  start('stripe', ['listen', '--all-snapshot', '--api-key', key, '--forward-to', 'http://localhost:3777/api/webhooks/stripe'], 'stripe');
  await until(() => {
    const log = logText('stripe');
    if (log.includes('must specify') || log.includes('Invalid API Key')) throw new Error('Stripe listener rejected its configuration; see stripe.jsonl');
    return log.includes('Ready!');
  }, 'Stripe listener');
  // Reuse the Playwright commands, including FX stub, captcha settings and memory limit.
  const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer!];
  for (const server of servers) {
    start('/bin/bash', ['-c', server.command], 'server');
    await until(async () => { try { return (await httpFetch(server.url!, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } }, server.url!, 120000);
  }
  console.log(`Stripe test-mode artifacts: ${dir}`);
  const pw = spawn('bunx', ['playwright', 'test', '--project=stripe-live', '--max-failures=1', ...process.argv.slice(2)], { env: { ...process.env, PW_REUSE_SERVER: '1' }, detached: true, stdio: 'inherit' });
  children.push(pw);
  status = await new Promise<number>(resolve => { pw.once('exit', code => resolve(code ?? 1)); pw.once('error', () => resolve(1)); });
  const summary = logText('summary').split('\n').filter(Boolean).map(line => JSON.parse(line));
  console.log('\n| scenario | runs | pass | event order observed |\n|---|---:|---:|---|');
  for (const name of ['guest', 'signed-in', '3ds', 'declined', 'subscription', 'repeat']) {
    const rows = summary.filter(row => row.scenario === name);
    console.log(`| ${name} | ${rows.length} | ${rows.filter(row => row.pass).length} | ${[...new Set(rows.map(row => row.order))].join('; ') || 'not run'} |`);
  }
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : 'Stripe live runner failed'));
} finally {
  await cleanup();
}
process.exit(status);
