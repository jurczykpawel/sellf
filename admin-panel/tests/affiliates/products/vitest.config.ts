/** Disposable product settings harness. @see database.test.ts */
import { defineConfig } from 'vitest/config';
import base from '../../../vitest.config';
export default defineConfig(env => {
  const config = typeof base === 'function' ? base(env) : base;
  return { ...config, test: { ...config.test, testTimeout: 30000, include: ['tests/affiliates/products/*.test.ts'] } };
});
