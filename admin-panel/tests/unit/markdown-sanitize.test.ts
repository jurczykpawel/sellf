/**
 * Coverage for the markdown rendering pipeline used by ProductShowcase.
 *
 * The product long_description is rendered with react-markdown +
 * remark-gfm + rehype-sanitize. The default rehype-sanitize schema is the
 * GitHub-flavored one — it permits the prose tags (h1-6, p, ul, ol, li,
 * a, code, pre, blockquote, strong, em, ...) and rejects everything else.
 *
 * These tests pin that contract: if anyone swaps the schema for a laxer
 * variant, downgrades the package, or removes the plugin, the failures
 * surface here instead of on a live product page.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

function render(md: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm],
      rehypePlugins: [rehypeSanitize],
      children: md,
    }),
  );
}

describe('markdown sanitize pipeline (mirrors ProductShowcase)', () => {
  it('keeps prose tags from a normal product description', () => {
    const html = render([
      '# Heading',
      '',
      'A **bold** word and an [external link](https://example.com).',
      '',
      '- bullet one',
      '- bullet two',
    ].join('\n'));

    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>bullet one</li>');
  });

  it('drops raw <script> blocks embedded in the markdown', () => {
    const html = render([
      'Welcome.',
      '',
      '<script>window.x=1</script>',
      '',
      'More text.',
    ].join('\n'));
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toContain('window.x=1');
  });

  it('drops <iframe>, <object>, <embed>, <style>', () => {
    const html = render([
      '<iframe src="https://evil.example/"></iframe>',
      '<object data="https://evil.example/"></object>',
      '<embed src="https://evil.example/" />',
      '<style>body{display:none}</style>',
    ].join('\n'));
    const lower = html.toLowerCase();
    expect(lower).not.toContain('<iframe');
    expect(lower).not.toContain('<object');
    expect(lower).not.toContain('<embed');
    expect(lower).not.toContain('<style');
  });

  it('strips inline event handlers from html elements', () => {
    const html = render('<a href="https://example.com" onclick="alert(1)">link</a>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('link');
  });

  it('rejects javascript: hrefs in markdown links', () => {
    const html = render('[click](javascript:alert(1))');
    expect(html.toLowerCase()).not.toContain('javascript:');
    expect(html).not.toContain('alert(1)');
  });

  it('rejects data: hrefs (used for in-page payload smuggling)', () => {
    const html = render('[x](data:text/html,<svg onload=alert(1)>)');
    // The link must not be rendered as an actual <a> element with the
    // data: scheme. react-markdown leaves it as escaped text instead,
    // which is fine — the rendered DOM has no clickable href.
    expect(html.toLowerCase()).not.toMatch(/<a\s[^>]*href=["']data:/);
    // The onload handler must never end up as an attribute.
    expect(html.toLowerCase()).not.toMatch(/\bonload\s*=/);
  });

  it('preserves http(s) and mailto links', () => {
    const html = render([
      '[a](https://example.com)',
      '',
      '[b](http://example.com)',
      '',
      '[c](mailto:hi@example.com)',
    ].join('\n'));
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="http://example.com"');
    expect(html).toContain('href="mailto:hi@example.com"');
  });
});
