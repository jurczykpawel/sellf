import { defineConfig } from '@playwright/test';
import base from './admin/playwright.config';
export default defineConfig({ ...base, use: { ...base.use, trace: 'off' }, testDir: '.', testMatch: 'acceptance.spec.ts', globalTeardown: undefined, webServer: (Array.isArray(base.webServer) ? base.webServer : [base.webServer!]).map(server => ({ ...server, cwd: process.env.RC_GATE_ROOT + '/admin-panel' })), projects: [{ name: 'rc-acceptance', use: { browserName: 'chromium' } }], retries: 0, workers: 1, timeout: 90000, outputDir: process.env.RC_GATE_EVIDENCE + '/acceptance-results' });
