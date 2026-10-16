import { defineConfig } from 'vitest/config';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

/**
 * Vitest config for API Integration Tests
 *
 * These tests run against a live server.
 * Before running: npm run dev (in another terminal)
 *
 * Run with: npm run test:api
 */
export default defineConfig({
  test: {
    include: ['tests/api/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000, // 30s timeout for API calls
    hookTimeout: 60000, // 60s for setup/teardown
    retry: 0,
    setupFiles: [],
    globalSetup: ['./tests/api/global-setup.ts'],
    // API files share database state, so run them sequentially.
    pool: 'forks',
    fileParallelism: false,
  },
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
});
