import { defineConfig } from '@playwright/test';
import base from './admin/playwright.sections.config';

const admin = process.env.RC_GATE_ROOT + '/admin-panel';

export default defineConfig({
  ...base,
  testDir: admin + '/tests',
  projects: base.projects?.map(project => ({
    ...project,
    snapshotPathTemplate: project.snapshotPathTemplate
      ? admin + '/' + project.snapshotPathTemplate
      : '{testDir}/{testFilePath}-snapshots/{arg}{-projectName}-darwin{ext}',
  })),
});
