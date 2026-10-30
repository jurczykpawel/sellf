/** Provider-backed HTTP acceptance; no browser fixture or device project is used. */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: '**/money-access-events.http.ts',
  fullyParallel: false,
  workers: 1,
  projects: [{ name: 'http' }],
  webServer: (Array.isArray(base.webServer) ? base.webServer : base.webServer ? [base.webServer] : []).map(server => ({
    ...server, command: process.env.TEST_DNS_SERVERS
      ? server.command.replace('NODE_OPTIONS=--max-old-space-size=8192', "NODE_OPTIONS='--max-old-space-size=8192 --require=./tests/helpers/public-dns.cjs'")
      : server.command,
  })),
});
