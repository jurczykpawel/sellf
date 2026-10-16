/** Render through the authenticated Next page and return a standalone document. @see preview-document.tsx */
import 'server-only';
import { headers } from 'next/headers';
import { extractPreviewDocument } from '@/lib/storefront-templates/preview-document';
import { PREVIEW_BYTES } from '@/lib/storefront-templates/json';
import { publicThemeCSS } from '@/lib/storefront-templates/public-theme';
import type { PreparedPreview, PreviewResult } from '@/lib/storefront-templates/preview';

function loopbackOrigin(): string {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local server port');
  const binding = process.env.HOSTNAME;
  const host = binding && ['localhost', '127.0.0.1', '0.0.0.0', '::', '::1'].includes(binding) ? binding : process.env.NODE_ENV === 'development' ? 'localhost' : '0.0.0.0';
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}
async function boundedText(response: Response): Promise<string> {
  if (!response.ok || !response.body) throw new Error('Preview document unavailable');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > PREVIEW_BYTES) throw new RangeError('Preview document exceeds limit');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { await reader.cancel(); }
}
export async function renderPreviewSnapshot(input: PreparedPreview): Promise<Pick<PreviewResult, 'html' | 'css' | 'assets'>> {
  const origin = loopbackOrigin();
  const incoming = await headers(); const credentials = new Headers({ 'x-sellf-preview-document': '1' });
  for (const name of ['cookie', 'authorization', 'x-api-key']) { const value = incoming.get(name); if (value) credentials.set(name, value); }
  const cookie = (incoming.get('cookie') ?? '').split(';').filter(part => part.trim() && !part.trim().startsWith('NEXT_LOCALE=')).join(';');
  credentials.set('cookie', `${cookie}${cookie ? ';' : ''}NEXT_LOCALE=${input.locale}`);
  const request = new URL(`${input.locale === 'en' ? '' : '/pl'}/template-preview-document`, origin);
  request.searchParams.set('revision', String(input.revision)); request.searchParams.set('fixture', input.fixture);
  const raw = await boundedText(await fetch(request, { headers: credentials, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000) }));
  const assets: PreviewResult['assets'] = [];
  for (const section of input.model.sections) {
    const props = section.props;
    const products = 'product' in props ? [props.product] : 'products' in props ? props.products : 'groups' in props ? Object.values(props.groups).flatMap(page => page?.products ?? []) : [];
    for (const product of products) if (product?.image && !assets.some(a => a.url === product.image!.src)) assets.push({ id: product.id, url: product.image.src, kind: 'image' });
  }
  const document = await extractPreviewDocument(raw, new Set(assets.map(a => a.url)));
  let styles = '';
  for (const sheet of document.stylesheets) {
    const url = new URL(sheet, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/_next/static/') || !url.pathname.endsWith('.css')) throw new Error('Invalid core stylesheet');
    const text = await boundedText(await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000) }));
    styles += text.replace(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)'"\s]*))\s*\)/g, (_match, double: string | undefined, single: string | undefined, bare: string | undefined) => {
      const source = double ?? single ?? bare ?? '';
      if (source.startsWith('#')) return `url("${source}")`;
      const asset = new URL(source, url);
      const embedded = source.startsWith('data:image/svg+xml,');
      if (!embedded && (asset.origin !== origin || !asset.pathname.startsWith('/_next/static/') && asset.pathname !== '/grid.svg')) throw new Error('Invalid core asset');
      const path = embedded ? source : asset.pathname + asset.search;
      if (!assets.some(a => a.url === path)) assets.push({ id: `core-${assets.length}`, url: path, kind: /\.(woff2?|ttf|otf)$/.test(asset.pathname) ? 'font' : 'image' });
      return `url("${path}")`;
    });
    if (Buffer.byteLength(styles) > PREVIEW_BYTES) throw new RangeError('Preview styles exceed limit');
  }
  const faces = styles.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  const css = `*{box-sizing:border-box}body{margin:0}img{max-width:100%;height:auto}${faces.join('')}@scope (.sf-preview-frame){${styles.replace(/@font-face\s*\{[^}]*\}/g, '')}}${publicThemeCSS(input.tokens)}`;
  const html = `<!doctype html><html lang="${input.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${input.locale === 'pl' ? 'Podgląd sklepu' : 'Store preview'}</title></head><body><main>${document.body}</main></body></html>`;
  return { html, css, assets };
}
