/** Invoice acceptance uses a server-only fetch fixture. @see tests/helpers/fakturownia-mock.mjs */
import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testMatch: '**/invoicing.spec.ts',
  workers: 1,
  webServer: (Array.isArray(config.webServer) ? config.webServer : []).map(server => ({
    ...server,
    command: server.command.replace('NODE_OPTIONS=--max-old-space-size=8192', `NODE_OPTIONS="--max-old-space-size=8192 --import=${process.cwd()}/tests/helpers/fakturownia-mock.mjs"`),
  })),
});
