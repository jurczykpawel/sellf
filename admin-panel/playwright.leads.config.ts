/** Dedicated local stack, pinned adapter and plugin host, one browser worker. Ports/origin: tests/leads/stack.ts. */
import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { LEADS_APP_PORT, LEADS_HOST_PORT, leadsAppUrl, leadsOrigin } from './tests/leads/stack';
dotenv.config({ path: resolve(__dirname, '.env.local') });
const playerstackDist = process.env.PLAYERSTACK_TEST_DIST;
if (!playerstackDist) throw new Error('PLAYERSTACK_TEST_DIST must point to a built PlayerStack distribution');
const certFile = resolve(__dirname, 'test-results/leads-receiver-cert.pem');
// scripts/run-leads-tests.sh starts both servers once for the HTTP and browser suites.
const reuse = process.env.LEADS_REUSE_SERVERS === '1';
export default defineConfig({
  testDir: './tests/leads', testMatch: 'playerstack-leads.e2e.ts', workers: 1, retries: 0, timeout: 90_000,
  reporter: 'list', outputDir: process.env.LEADS_TEST_OUTPUT_DIR ?? 'test-results/leads',
  use: { baseURL: leadsAppUrl, headless: true, trace: 'retain-on-failure' },
  webServer: [
    { command: 'bun tests/fixtures/playerstack-leads/server.mjs', port: LEADS_HOST_PORT, reuseExistingServer: reuse,
      env: { PLAYERSTACK_TEST_DIST: playerstackDist, ...(process.env.PLAYERSTACK_ADAPTER_REPO && { PLAYERSTACK_ADAPTER_REPO: process.env.PLAYERSTACK_ADAPTER_REPO }), LEADS_E2E_CA_FILE: certFile } },
    { command: `bun run dev --port ${LEADS_APP_PORT} --hostname 127.0.0.1`, url: `${leadsAppUrl}/api/health`, timeout: 120_000, reuseExistingServer: reuse,
      env: { LEADS_E2E_CA_FILE: certFile, RATE_LIMIT_TEST_MODE: 'true', LEADS_E2E_TRANSPORT: '1', SELLF_EMBED_ALLOWED_ORIGINS: leadsOrigin, NEXT_PUBLIC_SITE_URL: leadsAppUrl, NEXT_PUBLIC_BASE_URL: leadsAppUrl,
        NODE_OPTIONS: `--import ${resolve(__dirname, 'tests/fixtures/playerstack-leads/webhook-transport.mjs')}`, SELLF_TELEMETRY_DISABLED: 'true' } },
  ],
});
