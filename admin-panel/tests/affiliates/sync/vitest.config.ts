/** Isolated affiliate worker harness. @see src/lib/affiliates/sync/worker.ts */
import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../../vitest.config';

export default defineConfig(env => {
  const config = mergeConfig(typeof base === 'function' ? base(env) : base, {});
  config.test = { ...config.test, include: ['tests/affiliates/sync/*.test.ts'] };
  return config;
});
