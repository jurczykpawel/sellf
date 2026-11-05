/** Transfer acceptance uses the same server-side invoice fixture as W19. */
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import config from './playwright.invoicing.config';
process.env.INVOICE_FIXTURE_LOG ??= path.join(tmpdir(), `sellf-transfer-${process.pid}.jsonl`);
export default defineConfig({ ...config, testMatch: '**/bank-transfer.spec.ts', workers: 1,
  webServer: (Array.isArray(config.webServer) ? config.webServer : []).map(server => ({
    ...server,
    command: server.command.replace('NEXT_PUBLIC_TURNSTILE_TEST_MODE=true', 'NEXT_PUBLIC_TURNSTILE_TEST_MODE=false'),
    env: { ...server.env, CLOUDFLARE_TURNSTILE_SITE_KEY: '', NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: '',
      CLOUDFLARE_TURNSTILE_SECRET_KEY: '', ALTCHA_HMAC_KEY: 'local-transfer-acceptance' },
  })),
  projects: config.projects?.filter(project => project.name === 'chromium').map(project => ({ ...project, testIgnore: [] })),
});
