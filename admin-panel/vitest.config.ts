import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode ?? 'test', process.cwd(), '');

  return {
    test: {
      include: ['tests/unit/**/*.test.ts'],
      environment: 'node',
      env,
      fileParallelism: false,
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
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
      },
    },
  };
});
