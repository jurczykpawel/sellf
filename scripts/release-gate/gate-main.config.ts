import { defineConfig } from '@playwright/test';
import base from './admin/playwright.config';

const admin = process.env.RC_GATE_ROOT + '/admin-panel';
const exclusion = process.env.RC_GATE_STRIPE_EXCLUDE;

export default defineConfig({
  ...base,
  testDir: admin + '/tests',
  globalTeardown: admin + '/tests/global-teardown.ts',
  webServer: (Array.isArray(base.webServer) ? base.webServer : [base.webServer!]).map(server => ({ ...server, cwd: admin })),
  projects: base.projects?.map(project => {
    const original = project.testIgnore ?? [];
    const ignore = Array.isArray(original) ? original : [original];
    const separate = project.name === 'chromium'
      ? ['**/invoicing.spec.ts', '**/login-routing.spec.ts', '**/runtime-urls.spec.ts']
      : [];
    return { ...project, testIgnore: [...ignore, ...separate, ...(exclusion ? [new RegExp(exclusion)] : [])] };
  }),
});
