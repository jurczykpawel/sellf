/** Dedicated local stack, pinned adapter and plugin host, one browser worker. */
import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(__dirname, '.env.local') });
const adapterRepo = process.env.PLAYERSTACK_ADAPTER_REPO;
if (!adapterRepo) throw new Error('PLAYERSTACK_ADAPTER_REPO must contain commit 8baee66');
const playerstackDist = process.env.PLAYERSTACK_TEST_DIST;
if (!playerstackDist) throw new Error('PLAYERSTACK_TEST_DIST must point to a built PlayerStack distribution');
const certFile = resolve(__dirname, 'test-results/leads-receiver-cert.pem');
export default defineConfig({
  testDir: './tests/leads', testMatch: 'playerstack-leads.e2e.ts', workers: 1, retries: 0, timeout: 90_000,
  reporter: 'list', outputDir: process.env.LEADS_TEST_OUTPUT_DIR ?? 'test-results/leads',
  use: { baseURL: 'http://localhost:3893', headless: true, trace: 'retain-on-failure' },
  webServer: [
    { command: 'bun tests/fixtures/playerstack-leads/server.mjs', port: 3894, reuseExistingServer: false,
      env: { PLAYERSTACK_TEST_DIST: playerstackDist, PLAYERSTACK_ADAPTER_REPO: adapterRepo, LEADS_E2E_CA_FILE: certFile } },
    { command: 'bun run dev --port 3893 --hostname 127.0.0.1', url: 'http://localhost:3893/api/health', timeout: 120_000, reuseExistingServer: false,
      env: { LEADS_E2E_CA_FILE: certFile, RATE_LIMIT_TEST_MODE: 'true', LEADS_E2E_TRANSPORT: '1', NODE_OPTIONS: `--import ${resolve(__dirname, 'tests/fixtures/playerstack-leads/webhook-transport.mjs')}`, SELLF_TELEMETRY_DISABLED: 'true' } },
  ],
});
