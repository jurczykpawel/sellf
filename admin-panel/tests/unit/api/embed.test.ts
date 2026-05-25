import { describe, it, expect } from 'vitest';
import { parseEmbed, buildProductSelect, transformEmbeddedRelations } from '@/lib/api/embed';

describe('parseEmbed', () => {
  it('returns empty set for null', () => {
    expect(parseEmbed(null).size).toBe(0);
  });
  it('parses single key', () => {
    expect(parseEmbed('categories')).toEqual(new Set(['categories']));
  });
  it('parses comma-separated', () => {
    expect(parseEmbed('categories,tags')).toEqual(new Set(['categories', 'tags']));
  });
  it('trims whitespace', () => {
    expect(parseEmbed(' categories , tags ')).toEqual(new Set(['categories', 'tags']));
  });
  it('ignores unknown keys', () => {
    expect(parseEmbed('categories,evil')).toEqual(new Set(['categories']));
  });
  it('deduplicates', () => {
    expect(parseEmbed('tags,tags')).toEqual(new Set(['tags']));
  });
});

describe('buildProductSelect', () => {
  const BASE = 'id, name, slug';
  it('returns base when no embed', () => {
    expect(buildProductSelect(BASE, new Set())).toBe(BASE);
  });
  it('appends product_categories relation when categories embed', () => {
    const out = buildProductSelect(BASE, new Set(['categories']));
    expect(out).toContain(BASE);
    expect(out).toContain('product_categories');
    expect(out).toContain('categories ( id, name, slug )');
  });
  it('appends product_tags relation when tags embed', () => {
    const out = buildProductSelect(BASE, new Set(['tags']));
    expect(out).toContain('product_tags');
    expect(out).toContain('tags ( id, name, slug )');
  });
  it('appends both', () => {
    const out = buildProductSelect(BASE, new Set(['categories', 'tags']));
    expect(out).toContain('product_categories');
    expect(out).toContain('product_tags');
  });
});

describe('transformEmbeddedRelations', () => {
  it('flattens product_categories.categories → categories', () => {
    const out = transformEmbeddedRelations({
      id: 'p1',
      product_categories: [
        { category_id: 'c1', categories: { id: 'c1', name: 'A', slug: 'a' } },
        { category_id: 'c2', categories: { id: 'c2', name: 'B', slug: 'b' } },
      ],
    });
    expect(out.categories).toEqual([
      { id: 'c1', name: 'A', slug: 'a' },
      { id: 'c2', name: 'B', slug: 'b' },
    ]);
    expect(out).not.toHaveProperty('product_categories');
  });
  it('flattens product_tags.tags → tags', () => {
    const out = transformEmbeddedRelations({
      id: 'p1',
      product_tags: [{ tag_id: 't1', tags: { id: 't1', name: 'X', slug: 'x' } }],
    });
    expect(out.tags).toEqual([{ id: 't1', name: 'X', slug: 'x' }]);
    expect(out).not.toHaveProperty('product_tags');
  });
  it('drops null relations from join (defensive)', () => {
    const out = transformEmbeddedRelations({
      id: 'p1',
      product_tags: [{ tag_id: 't1', tags: null }],
    });
    expect(out.tags).toEqual([]);
  });
  it('passthrough for rows without embedded relations', () => {
    expect(transformEmbeddedRelations({ id: 'p1', name: 'P' })).toEqual({ id: 'p1', name: 'P' });
  });
});
