/** Transfer acceptance uses the same server-side invoice fixture as W19. */
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import config from './playwright.invoicing.config';
process.env.INVOICE_FIXTURE_LOG ??= path.join(tmpdir(), `sellf-transfer-${process.pid}.jsonl`);
export default defineConfig({ ...config, testMatch: '**/bank-transfer.spec.ts', workers: 1,
  projects: config.projects?.filter(project => project.name === 'chromium').map(project => ({ ...project, testIgnore: [] })),
});
