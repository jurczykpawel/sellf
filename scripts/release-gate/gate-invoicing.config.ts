import { defineConfig } from '@playwright/test';
import base from './admin/playwright.invoicing.config';
const admin = process.env.RC_GATE_ROOT + '/admin-panel';
export default defineConfig({ ...base, testDir: admin + '/tests', globalTeardown: admin + '/tests/global-teardown.ts',
 webServer: (Array.isArray(base.webServer) ? base.webServer : [base.webServer!]).map(server => ({ ...server, cwd: admin })),
 projects: base.projects?.filter(project => project.name === 'chromium').map(project => ({ ...project, testIgnore: [], testMatch: '**/invoicing.spec.ts' })),
});
