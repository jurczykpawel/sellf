import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode ?? 'test', process.cwd(), '');

  return {
    test: {
      include: ['tests/unit/**/*.test.ts', 'tests/affiliates/**/*.test.{ts,tsx}'],
      exclude: process.env.AFFILIATE_TEST_ENV ? [] : ['tests/affiliates/**/database.test.ts'],
      testTimeout: 30000,
      hookTimeout: 125000,
      css: true,
      environment: 'node',
      env,
      fileParallelism: false,
      maxWorkers: 1,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        include: [
          'src/lib/api/api-keys.ts',
          'src/lib/api/pagination.ts',
          'src/lib/api/types.ts',
          'src/lib/validations/**/*.ts',
          'src/lib/constants.ts',
          'src/lib/timezone.ts',
          'src/lib/videoUtils.ts',
          'src/lib/license/**/*.ts',
          'src/lib/cors.ts',
        ],
        exclude: ['**/*.d.ts', '**/types.ts'],
        thresholds: {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
      },
    },
    css: { postcss: { plugins: [] } },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
      },
    },
  };
});
