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
    // Re-run a failing API integration test once before reporting it as failed.
    // Mitigates cold-start races (cron init, route compilation) without
    // masking genuine bugs — true regressions fail both attempts.
    retry: 1,
    setupFiles: [],
    globalSetup: ['./tests/api/global-setup.ts'],
    // Run tests sequentially to avoid race conditions
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
