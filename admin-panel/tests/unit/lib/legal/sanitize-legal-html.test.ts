/**
 * Unit tests for the legal-document HTML sanitizer.
 *
 * Fixtures under tests/fixtures/legal/{terms,privacy}.pl.html are REAL
 * legal-engine output (realistic sp. z o.o. seller data, captured 2026-09-29),
 * copied from the B10 measurement artifacts. They exercise every tag/attribute
 * the engine is known to emit: headings, ordered lists with `start`, a
 * `pre/code` block, links, and — for privacy — a `table` with `thead`/`tbody`.
 *
 * We render through the SAME pipeline the app uses (hast -> React elements via
 * hast-util-to-jsx-runtime -> static HTML via react-dom/server), not a
 * separate serializer, so these tests exercise the real rendering path.
 *
 * Run: cd admin-panel && bunx vitest run tests/unit/lib/legal/sanitize-legal-html.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { sanitizeLegalHtml } from '@/lib/legal/sanitize-legal-html';
import { wrapHtml } from '@/lib/legal/wrap-html';

const FIXTURES_DIR = join(__dirname, '../../../fixtures/legal');

function loadFixture(name: 'terms.pl.html' | 'privacy.pl.html'): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

/** Render sanitized HTML the same way the app does: hast -> React -> static markup. */
function render(html: string): string {
  const tree = sanitizeLegalHtml(html);
  const node = toJsxRuntime(tree, { Fragment, jsx, jsxs });
  return renderToStaticMarkup(node);
}

/** Count occurrences of each opening tag in a raw HTML string. */
function tagCounts(html: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const match of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)/g)) {
    const tag = match[1].toLowerCase();
    counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return counts;
}

/** Normalize visible text for comparison (collapse whitespace, decode a few entities). */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('sanitizeLegalHtml — fidelity on real legal-engine output', () => {
  it('preserves every tag in the real terms document 1:1', () => {
    const source = loadFixture('terms.pl.html');
    const clean = render(source);

    const before = tagCounts(source);
    const after = tagCounts(clean);

    for (const tag of Object.keys(before)) {
      expect(after[tag], `tag <${tag}>`).toBe(before[tag]);
    }
    // No tag should appear that wasn't in the source.
    for (const tag of Object.keys(after)) {
      expect(before[tag], `unexpected tag <${tag}>`).toBe(after[tag]);
    }
  });

  it('preserves ordered-list start numbering in terms', () => {
    const source = loadFixture('terms.pl.html');
    const clean = render(source);

    const sourceStarts = [...source.matchAll(/<ol start="(\d+)"/g)].map((m) => m[1]);
    const cleanStarts = [...clean.matchAll(/<ol start="(\d+)"/g)].map((m) => m[1]);
    expect(cleanStarts).toEqual(sourceStarts);
    expect(cleanStarts).toEqual(['7', '5', '2', '2']);
  });

  it('preserves visible text in terms (normalized whitespace)', () => {
    const source = loadFixture('terms.pl.html');
    const clean = render(source);
    expect(visibleText(clean)).toBe(visibleText(source));
  });

  it('preserves every tag in the real privacy document, including the cookies table', () => {
    const source = loadFixture('privacy.pl.html');
    const clean = render(source);

    const before = tagCounts(source);
    const after = tagCounts(clean);

    for (const tag of Object.keys(before)) {
      expect(after[tag], `tag <${tag}>`).toBe(before[tag]);
    }
    expect(after.table).toBe(1);
    expect(after.thead).toBe(1);
    expect(after.tbody).toBe(1);
  });

  it('preserves visible text in privacy (normalized whitespace)', () => {
    const source = loadFixture('privacy.pl.html');
    const clean = render(source);
    expect(visibleText(clean)).toBe(visibleText(source));
  });

  it('renders the same content whether given a fragment or the wrapHtml()-wrapped document', () => {
    const fragment = loadFixture('terms.pl.html');
    const wrapped = wrapHtml(fragment, 'Regulamin');

    // wrapHtml's <body>\n{fragment}\n</body> leaves whitespace-only text nodes
    // at the very start/end once <html>/<head>/<body> are unwrapped by
    // sanitize (they aren't in tagNames); trim before comparing, exactly as
    // measured in the B10 brainstorm artifacts.
    expect(render(wrapped).trim()).toBe(render(fragment).trim());
  });

  it('does not show <title> or <style> content as visible text', () => {
    const uniqueTitle = 'UNIQUE_TITLE_MARKER_9f3e';
    const wrapped = wrapHtml(loadFixture('terms.pl.html'), uniqueTitle);
    const clean = render(wrapped);
    expect(clean).not.toContain(uniqueTitle);
    expect(clean).not.toContain('max-width:48rem');
  });
});

describe('sanitizeLegalHtml — hostile input is neutralized', () => {
  const attack = `<!doctype html><html><head><title>x</title><style>body{}</style><script>alert(0)</script></head><body>
<h1 onclick="alert(1)">T</h1><script>alert(1)</script><img src=x onerror=alert(1)><svg onload=alert(1)></svg>
<a href="javascript:alert(1)">js</a> <a href=" JaVaScRiPt:alert(1)">js2</a> <a href="&#106;avascript:alert(1)">js3</a>
<a href="data:text/html,x">data</a> <a href="vbscript:alert(1)">vb</a>
<a href="https://ok.example" target="_blank">ok</a> <a href="mailto:a@b.pl">mail</a> <a href="tel:+48123456789">tel</a>
<iframe src="https://evil"></iframe><form action="https://evil"><input name=p></form>
<meta http-equiv="refresh" content="0;url=https://evil"><object data="https://evil"></object><embed src="https://evil">
<base href="https://evil/">
<p style="background:url(https://track)">styled</p><a id="x" name="y" class="c">anchor</a>
<math><mi xlink:href="javascript:alert(1)">m</mi></math>
<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>
</body></html>`;

  function clean(): string {
    return render(attack);
  }

  it('strips script tags entirely', () => {
    expect(clean()).not.toContain('<script');
    expect(clean()).not.toContain('alert(0)');
  });

  it('strips dangerous elements: img, svg, iframe, form, input, meta, object, embed, base', () => {
    const out = clean();
    for (const tag of ['img', 'svg', 'iframe', 'form', 'input', 'meta', 'object', 'embed', 'base']) {
      expect(out, `<${tag}> should be stripped`).not.toContain(`<${tag}`);
    }
  });

  it('strips event handler and styling/identity attributes', () => {
    const out = clean();
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onload');
    expect(out).not.toContain('style=');
    expect(out).not.toMatch(/\sid="x"/);
    expect(out).not.toMatch(/\sname="y"/);
    expect(out).not.toMatch(/\sclass(Name)?="c"/);
    expect(out).not.toContain('target=');
  });

  it('drops javascript:, data:, and vbscript: hrefs but keeps the link text', () => {
    const out = clean();
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('data:text/html');
    expect(out).not.toContain('vbscript:');
    // Text content survives even though href is dropped.
    expect(out).toContain('js<');
    expect(out).toContain('js2<');
    expect(out).toContain('js3<');
    expect(out).toContain('data<');
  });

  it('keeps allowed protocols: https, mailto, tel', () => {
    const out = clean();
    expect(out).toContain('href="https://ok.example"');
    expect(out).toContain('href="mailto:a@b.pl"');
    expect(out).toContain('href="tel:+48123456789"');
  });

  it('does not let a noscript-wrapped payload smuggle an <img> tag', () => {
    expect(clean()).not.toContain('<img');
  });

  it('strips xlink:href from math/mi elements (and the elements themselves, not in the allowlist)', () => {
    const out = clean();
    expect(out).not.toContain('xlink:href');
    expect(out).not.toContain('<math');
    expect(out).not.toContain('<mi');
  });
});
