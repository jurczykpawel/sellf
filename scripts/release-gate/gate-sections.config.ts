import { defineConfig } from '@playwright/test';
import base from './admin/playwright.sections.config';

const admin = process.env.RC_GATE_ROOT + '/admin-panel';
// Linux baselines generated on GHA (scripts/release-gate/linux-snapshots), same relative layout as the candidate's.
const linux = process.env.RC_GATE_SNAPSHOT_DIR;

export default defineConfig({
  ...base,
  testDir: admin + '/tests',
  projects: base.projects?.map(project => ({
    ...project,
    snapshotPathTemplate: linux
      ? linux + '/' + (project.snapshotPathTemplate ?? 'tests/{testFilePath}-snapshots/{arg}{-projectName}{ext}')
      : project.snapshotPathTemplate
        ? admin + '/' + project.snapshotPathTemplate
        : '{testDir}/{testFilePath}-snapshots/{arg}{-projectName}-darwin{ext}',
  })),
});
