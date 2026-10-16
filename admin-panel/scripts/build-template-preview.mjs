/** Build the standalone reviewed section renderer; never invoked during requests. */
import { build } from 'esbuild';
import { rm, access } from 'node:fs/promises';
await Promise.all(['node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2', 'src/fonts/DMSans-Variable.ttf'].map(file => access(file)));
await rm('preview-renderer/dist', { recursive: true, force: true });
await build({
  entryPoints: ['src/components/storefront/PreviewSnapshot.tsx'], outdir: 'preview-renderer/dist',
  entryNames: 'renderer', outExtension: { '.js': '.cjs' }, platform: 'node', format: 'cjs',
  bundle: true, jsx: 'automatic', loader: { '.css': 'local-css' },
});
