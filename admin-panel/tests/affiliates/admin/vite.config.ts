import { defineConfig } from 'vite';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
export default defineConfig({
  resolve: { alias: [
    { find: '@/lib/affiliates/admin/actions', replacement: path.resolve(import.meta.dirname, 'browser-stubs.tsx') },
    { find: '@/components/captcha/CaptchaWidget', replacement: path.resolve(import.meta.dirname, 'browser-stubs.tsx') },
    { find: '@', replacement: path.resolve(import.meta.dirname, '../../../src') },
  ] },
  css: { postcss: { plugins: [tailwindcss()] } },
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 55478, strictPort: true },
});
