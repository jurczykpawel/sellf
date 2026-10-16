import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/postcss';
import path from 'node:path';
const root = __dirname, source = path.resolve(root, '../../../src');
export default defineConfig({ root, css: { postcss: { plugins: [tailwind()] } }, resolve: { alias: [
  { find: /^@\/lib\/affiliates\/payouts\/(actions|reads)$/, replacement: path.join(root, 'ui-fixtures.ts') },
  { find: '@', replacement: source },
] }, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 55465, fs: { allow: [path.resolve(root, '../../..')] } } });
