import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  test: { include: process.env.AFFILIATE_TEST_ENV ? ['tests/affiliates/admin/database.test.ts'] : ['tests/affiliates/admin/{actions,forms,thresholds}.test.{ts,tsx}'], fileParallelism: false },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '../../../src'), 'server-only': path.resolve(import.meta.dirname, '../../stubs/server-only.ts') } },
});
