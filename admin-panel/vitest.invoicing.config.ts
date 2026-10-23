/** Disposable local database acceptance. @see tests/invoicing/database.test.ts */
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import path from 'node:path';
export default defineConfig({
  test: { include: ['tests/invoicing/*.test.ts'], env: loadEnv('test', process.cwd(), ''), fileParallelism: false, maxWorkers: 1 },
  resolve: { alias: { '@': path.resolve('./src'), 'server-only': path.resolve('./tests/stubs/server-only.ts') } },
});
