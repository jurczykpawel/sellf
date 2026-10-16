import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ test: { include: ['tests/affiliates/payouts/*.test.ts'], environment: 'node', testTimeout: 15000, fileParallelism: false }, resolve: { alias: { '@': path.resolve(__dirname, '../../../src'), 'server-only': path.resolve(__dirname, '../../stubs/server-only.ts') } } });
