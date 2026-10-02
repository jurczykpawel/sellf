#!/usr/bin/env node
/** Build with release placeholders, then boot with local runtime configuration. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
dotenv.config({ path: '.env.local', quiet: true });
const env = {
  ...process.env,
  NODE_ENV: 'production', SITE_URL: 'http://localhost:3777', MAIN_DOMAIN: 'localhost:3777',
  TRUSTED_PROXY: 'true', SELLF_TELEMETRY_DISABLED: 'true',
  RUNTIME_URL_TEST_IP: `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
  SUPABASE_KEEP_ALIVE: 'false',
  E2E_MODE: 'true', ALLOW_PRODUCTION_E2E_MODE: 'true', NEXT_PUBLIC_TURNSTILE_TEST_MODE: 'false',
  CLOUDFLARE_TURNSTILE_SITE_KEY: '', NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: '',
  CLOUDFLARE_TURNSTILE_SECRET_KEY: '', ALTCHA_HMAC_KEY: randomBytes(32).toString('hex'),
  CHECKOUT_BINDING_SECRET: process.env.CHECKOUT_BINDING_SECRET || randomBytes(32).toString('hex'),
  APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY || randomBytes(32).toString('base64'),
};
env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL;
env.SUPABASE_ANON_KEY ||= process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete env.CURRENCY_ECB_BASE_URL;
const run = (command, args, runEnv = env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { env: runEnv, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
});
if (!process.argv.includes('--skip-build')) {
  await run('bun', ['run', 'build'], {
    ...env, SITE_URL: '', MAIN_DOMAIN: '', SUPABASE_URL: 'https://placeholder.supabase.co',
    SUPABASE_ANON_KEY: 'placeholder-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'placeholder-service-key',
    PUBLIC_SUPABASE_URL: '', STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_placeholder', STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
    NEXT_PUBLIC_SITE_URL: 'https://placeholder.example.com',
    NEXT_PUBLIC_BASE_URL: 'https://placeholder.example.com', NEXT_PUBLIC_APP_URL: 'https://placeholder.example.com',
    NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon-key',
  });
  await run('bash', ['scripts/check-build-artifact.sh']);
}
await run('bash', ['scripts/kill-dev-server.sh', '3777']);
const entry = ['.next/standalone/server.js', '.next/standalone/admin-panel/server.js'].find(existsSync);
if (!entry) throw new Error('Standalone release server is missing');
const releaseRoot = dirname(entry);
cpSync('.next/static', join(releaseRoot, '.next/static'), { recursive: true });
cpSync('public', join(releaseRoot, 'public'), { recursive: true });
const server = spawn(process.execPath, [entry], {
  env: { ...env, PORT: '3777', HOSTNAME: 'localhost' }, stdio: 'inherit',
});
const stop = () => server.kill('SIGTERM');
process.on('SIGINT', stop); process.on('SIGTERM', stop);
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error('Production server exited before readiness');
    try { if ((await fetch(`${env.SITE_URL}/api/runtime-config`)).ok) { ready = true; break; } } catch { /* booting */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Production server did not become ready');
  await run('bunx', ['playwright', 'test', '--config', 'playwright.runtime-urls.config.ts']);
} finally {
  stop();
  await run('bash', ['scripts/kill-dev-server.sh', '3777']);
}
