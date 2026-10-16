/** Native serialization of the Next-rendered evidence subtree. */
import { expect, it } from 'vitest';
import { extractPreviewDocument } from '@/lib/storefront-templates/preview-document';
const html = (content: string) => `<!doctype html><html><head><link rel="stylesheet" href="/_next/static/test.css"></head><body class="core-font"><header>SESSION-SHELL</header><script>session()</script><div class="sf-public-theme">${content}</div></body></html>`;
it('removes the application shell and returns inert native controls', async () => {
  const snapshot = await extractPreviewDocument(html('<h1>Przykład</h1><form action="/checkout"><input name="email"><button>Buy</button></form><a href="/checkout">Details</a><script>grant()</script>'), new Set());
  expect(snapshot.body).toContain('Przykład');
  expect(snapshot.body).not.toMatch(/SESSION-SHELL|<script|<form|href=|action=/);
  expect(snapshot.body).toMatch(/<button[^>]*disabled/);
  expect(snapshot.body).toMatch(/<input[^>]*disabled/);
  expect(snapshot.body).toContain('aria-disabled="true"');
  expect(snapshot.body).toContain('<div class="sf-preview-frame"><div class="core-font">');
  expect(snapshot.stylesheets).toEqual(['/_next/static/test.css']);
});
it('retains selected values and keyboard disclosures without active controls', async () => {
  const snapshot = await extractPreviewDocument(html('<select><option value="a">A</option><option value="b" selected>B</option></select><details><summary>Requirements</summary>Text</details>'), new Set());
  expect(snapshot.body).toMatch(/<select[^>]*disabled/);
  expect(snapshot.body).toContain('<option value="b" selected="">B</option>');
  expect(snapshot.body).toContain('<details><summary>Requirements</summary>Text</details>');
});
it('accepts only the resolved public image manifest', async () => {
  const source = html('<img src="https://media.example.com/cover.webp" width="1200" height="800" alt="Example">');
  await expect(extractPreviewDocument(source, new Set())).rejects.toThrow('Missing preview image');
  expect((await extractPreviewDocument(source, new Set(['https://media.example.com/cover.webp']))).body).toContain('https://media.example.com/cover.webp');
});
it('requires the reviewed subtree and its generated styles', async () => {
  await expect(extractPreviewDocument('<main>Not a preview</main>', new Set())).rejects.toThrow();
  await expect(extractPreviewDocument('<div class="sf-public-theme">Missing styles</div>', new Set())).rejects.toThrow();
});
