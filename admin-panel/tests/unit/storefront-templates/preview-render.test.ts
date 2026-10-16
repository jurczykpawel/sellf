/** Loopback rendering uses request authentication and only generated core assets. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { D_TOKENS } from '@/lib/storefront-templates/fixtures';
import { renderPreviewSnapshot } from '@/lib/storefront-templates/preview-render';
import { result } from '@/lib/storefront-templates/json';
import type { PreparedPreview } from '@/lib/storefront-templates/preview';
const m = vi.hoisted(() => ({ request: vi.fn(), incoming: vi.fn() }));
vi.mock('next/headers', () => ({ headers: m.incoming }));
const document = '<html><head><link rel="stylesheet" href="/_next/static/chunks/core.css"></head><body class="core-font"><header>SESSION-SHELL</header><div class="sf-public-theme"><h1>Przykład</h1><a href="/checkout">Offer</a><form><button>Buy</button></form></div><script>session()</script></body></html>';
const css = '@font-face{font-family:Core;src:url(../media/core.woff2)}.core-font{--font-geist-sans:Core}';
const input: PreparedPreview = { revision: 3, locale: 'pl', fixture: 'standard', expiresAt: new Date().toISOString(), validation: result(), effectiveTokens: [], unusedSlots: [], tokens: D_TOKENS, model: { locale: 'pl', templateId: 'default', sections: [], catalogue: { groups: {} } } };
beforeEach(() => {
  vi.stubEnv('PORT', '3199'); vi.stubEnv('HOSTNAME', 'localhost');
  m.incoming.mockResolvedValue(new Headers({ authorization: 'Bearer example', cookie: 'session=example; NEXT_LOCALE=en', 'x-forwarded-for': 'example' }));
  m.request.mockReset().mockResolvedValueOnce(new Response(document)).mockResolvedValueOnce(new Response(css));
  vi.stubGlobal('fetch', m.request);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('returns portable inert evidence and the core font manifest without session UI', async () => {
  const output = await renderPreviewSnapshot(input);
  expect(output.html).toContain('<html lang="pl">');
  expect(output.html).not.toMatch(/SESSION-SHELL|<script|<form|href=|Bearer example|session=example/);
  expect(output.css).toContain('@scope (.sf-preview-frame)');
  expect(output.css).toContain('url("/_next/static/media/core.woff2")');
  expect(output.assets).toEqual([{ id: 'core-0', url: '/_next/static/media/core.woff2', kind: 'font' }]);
  const [url, options] = m.request.mock.calls[0];
  expect(url.origin).toBe('http://localhost:3199');
  expect(options.headers.get('authorization')).toBe('Bearer example');
  expect(options.headers.get('cookie')).toBe('session=example;NEXT_LOCALE=pl');
  expect(options.headers.has('x-forwarded-for')).toBe(false);
  expect(options.redirect).toBe('error');
  expect(m.request.mock.calls[1][1].headers).toBeUndefined();
});
it('does not fetch stylesheet URLs outside the generated asset surface', async () => {
  m.request.mockReset().mockResolvedValueOnce(new Response(document.replace('/_next/static/chunks/core.css', 'https://example.com/core.css')));
  await expect(renderPreviewSnapshot(input)).rejects.toThrow('Invalid core stylesheet');
  expect(m.request).toHaveBeenCalledTimes(1);
});
it('bounds the streamed source response before parsing', async () => {
  m.request.mockReset().mockResolvedValueOnce(new Response('x'.repeat(4 * 1024 * 1024 + 1)));
  await expect(renderPreviewSnapshot(input)).rejects.toThrow(RangeError);
});

it('keeps embedded core image URLs intact while resolving generated public assets', async () => {
  const embedded = "data:image/svg+xml,%3Csvg filter='url(%23noise)'/%3E";
  m.request.mockReset().mockResolvedValueOnce(new Response(document)).mockResolvedValueOnce(new Response(`.noise{background:url("${embedded}")}.grid{background:url('/grid.svg')}`));
  const output = await renderPreviewSnapshot(input);
  expect(output.assets).toEqual(expect.arrayContaining([expect.objectContaining({ url: embedded, kind: 'image' }), expect.objectContaining({ url: '/grid.svg', kind: 'image' })]));
  expect(output.css).toContain(embedded);
});
