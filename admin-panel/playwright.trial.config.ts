/** Sequential trial and accessibility checks; public hydration uses a production build. */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import runtime from './playwright.runtime-urls.config';

export default defineConfig({
  ...base,
  workers: 1,
  retries: 0,
  projects: [
    ...(base.projects ?? []).filter(project => ['stripe-live', 'accessibility'].includes(project.name ?? '')),
    ...(runtime.projects ?? []).filter(project => project.name === 'public-hydration'),
  ],
});
