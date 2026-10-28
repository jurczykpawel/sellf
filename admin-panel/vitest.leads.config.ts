/** Dedicated HTTP acceptance; run against the local lead fixture app on :3893. */
import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(__dirname, '.env.local') });
export default defineConfig({ test: {
  include: ['tests/leads/*.api.ts'], environment: 'node', fileParallelism: false,
  globalSetup: ['./tests/api/global-setup.ts'],
  testTimeout: 30_000, hookTimeout: 60_000, retry: 0,
}, resolve: { alias: { '@': resolve(__dirname, 'src') } } });
