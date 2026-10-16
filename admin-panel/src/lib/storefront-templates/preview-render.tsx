/** Loads the immutable Node SSR artifact, outside the RSC runtime. @see scripts/build-template-preview.mjs */
import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderPreviewMarkup } from '@sellf/template-preview';
import type { PresentationModel } from '@/lib/storefront-templates/resolver';
import type { PublicThemeTokens } from '@/lib/storefront-templates/schemas';
import type { PreviewResult } from '@/lib/storefront-templates/preview';
type Snapshot = Pick<PreviewResult, 'html' | 'css' | 'assets'>;
export async function renderPreviewSnapshot(input: { model: PresentationModel; tokens: PublicThemeTokens }): Promise<Snapshot> {
  const snapshot = await renderPreviewMarkup(input);
  const styles = await readFile(path.join(process.cwd(), 'preview-renderer/dist/renderer.css'), 'utf8');
  const base = `@font-face{font-family:PreviewFont;src:url('/api/storefront/preview-font/${input.tokens.typography.font}');font-display:swap}*{box-sizing:border-box}body{margin:0}html{--font-geist-sans:PreviewFont;--font-dm-sans:PreviewFont}a{color:inherit}button,input,select{font:inherit}img{max-width:100%;height:auto}[data-testid=storefront]>footer{border-top:1px solid var(--sf-border);padding:2rem 1.5rem;text-align:center;color:var(--sf-text-muted)}`;
  return { ...snapshot, css: base + styles + snapshot.css };
}
