/** Portal acceptance harness. @see src/lib/affiliates/portal/service.ts */
import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../../vitest.config';
export default defineConfig(env => {
  const config = mergeConfig(typeof base === 'function' ? base(env) : base, { css: { postcss: { plugins: [] } } });
  config.test = { ...config.test, css: true, include: ['tests/affiliates/portal/*.test.{ts,tsx}'] };
  return config;
});
