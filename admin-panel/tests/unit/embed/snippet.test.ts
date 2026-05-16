import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildEmbedSnippet } from '@/lib/embed/snippet';

describe('buildEmbedSnippet', () => {
  it('default inline mode emits exactly two lines and two data attributes', () => {
    const snippet = buildEmbedSnippet({
      productSlug: 'funnel-mini-pdf',
      sellfOrigin: 'https://sellf.tojest.dev',
    });

    expect(snippet).toBe(
      '<div data-sellf-embed data-product-slug="funnel-mini-pdf"></div>\n' +
      '<script src="https://sellf.tojest.dev/embed/v1/checkout.js"></script>',
    );
  });

  it('modal=true adds data-modal="true"', () => {
    const snippet = buildEmbedSnippet({
      productSlug: 'p1',
      sellfOrigin: 'https://s.example.com',
      modal: true,
    });

    expect(snippet).toContain('data-modal="true"');
  });

  it('button label is emitted only with modal=true', () => {
    const withModal = buildEmbedSnippet({
      productSlug: 'p1',
      sellfOrigin: 'https://s.example.com',
      modal: true,
      buttonLabel: 'Kup PDF',
    });
    const withoutModal = buildEmbedSnippet({
      productSlug: 'p1',
      sellfOrigin: 'https://s.example.com',
      buttonLabel: 'Kup PDF',
    });

    expect(withModal).toContain('data-button-label="Kup PDF"');
    expect(withoutModal).not.toContain('button-label');
  });

  it('show-price is emitted only with modal=true', () => {
    const withModal = buildEmbedSnippet({
      productSlug: 'p1',
      sellfOrigin: 'https://s.example.com',
      modal: true,
      showPrice: true,
    });
    const withoutModal = buildEmbedSnippet({
      productSlug: 'p1',
      sellfOrigin: 'https://s.example.com',
      showPrice: true,
    });

    expect(withModal).toContain('data-show-price="true"');
    expect(withoutModal).not.toContain('show-price');
  });

  it('escapes HTML-unsafe characters in slug and label', () => {
    const snippet = buildEmbedSnippet({
      productSlug: 'a"b<c',
      sellfOrigin: 'https://s.example.com',
      modal: true,
      buttonLabel: 'Kup <strong>"now"</strong>',
    });

    expect(snippet).toContain('data-product-slug="a&quot;b&lt;c"');
    expect(snippet).toContain('data-button-label="Kup &lt;strong&gt;&quot;now&quot;&lt;/strong&gt;"');
  });

  it('rejects empty productSlug', () => {
    expect(() => buildEmbedSnippet({
      productSlug: '',
      sellfOrigin: 'https://s.example.com',
    })).toThrow(/productSlug/);
  });

  it('rejects empty sellfOrigin', () => {
    expect(() => buildEmbedSnippet({
      productSlug: 'p1',
      sellfOrigin: '',
    })).toThrow(/sellfOrigin/);
  });
});

describe('SDK loader contract (source-regex)', () => {
  const sdk = readFileSync(
    resolve(__dirname, '../../../src/app/embed/v1/checkout.js/route.ts'),
    'utf-8',
  );

  it('reads data-modal attribute', () => {
    expect(sdk).toMatch(/getAttribute\(['"]data-modal['"]\)/);
  });

  it('reads data-button-label attribute', () => {
    expect(sdk).toMatch(/getAttribute\(['"]data-button-label['"]\)/);
  });

  it('reads data-show-price attribute', () => {
    expect(sdk).toMatch(/getAttribute\(['"]data-show-price['"]\)/);
  });

  it('opens a modal overlay when data-modal === "true"', () => {
    // Look for any of: classList includes 'sellf-modal', dialog element,
    // overlay z-index, or fixed positioning typical for modals.
    expect(sdk).toMatch(/sellf-(?:modal|overlay)|position:\s*['"]fixed['"]/);
  });

  it('renders a button that triggers checkout fetch on click', () => {
    expect(sdk).toMatch(/addEventListener\(['"]click['"]/);
  });
});
