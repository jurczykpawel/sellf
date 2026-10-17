/** Author hero contract and public projection. @see docs/templates/phase2-contracts.md */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import AuthorHero from '@/components/storefront/sections/AuthorHero';
import { resolveAuthorHero } from '@/lib/storefront-templates/author-hero';
import { phase2StorefrontRecipeSchema } from '@/lib/storefront-templates/phase2-contracts';
import { authorHeroFixture, authorHeroRecipe } from '../../fixtures/storefront-sections/author-hero';

const spec = authorHeroRecipe.sections[0];
describe('author-hero/1', () => {
  it('resolves only author presentation without products or I/O', () => {
    const inputs = authorHeroFixture('pl');
    const value = resolveAuthorHero(spec, inputs, authorHeroRecipe);
    expect(value.success).toBe(true);
    if (!value.success) return;
    expect(Object.keys(value.data).sort()).toEqual(['catalogueTarget', 'content', 'locale', 'pathsTarget', 'portrait']);
    expect(value.data.content).toEqual(inputs.slots['home.author']);
    expect(value.data.portrait).toEqual(inputs.mediaById[inputs.slots['home.author'].portraitMediaId!]);
    const html = renderToStaticMarkup(createElement(AuthorHero, value.data));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('href="#paths"');
    expect(html).toContain('href="#catalogue"');
    expect(html).not.toMatch(/iframe|<script|checkout|undefined/);
  });
  it('keeps one heading with absent author, blank copy or missing portrait', () => {
    for (const state of ['empty', 'blank', 'no-media', 'unresolved-media'] as const) {
      const value = resolveAuthorHero(spec, authorHeroFixture('en', state), authorHeroRecipe);
      expect(value.success).toBe(true);
      if (!value.success) continue;
      const html = renderToStaticMarkup(createElement(AuthorHero, value.data));
      expect(html.match(/<h1/g)).toHaveLength(1);
      expect(html).not.toContain('<img');
    }
  });
  it('rejects absent, wrong-kind and mismatched targets and duplicate heading owners', () => {
    for (const patch of [{ pathsTarget: 'faq' }, { catalogueTarget: 'paths' }, { pathsTarget: 'missing' }, { catalogueTarget: 'https://example.test' }, { id: 'other' }]) {
      expect(resolveAuthorHero({ ...spec, ...patch }, authorHeroFixture('en'), authorHeroRecipe).success).toBe(false);
    }
    for (const type of ['product-paths/1', 'catalogue/1']) {
      expect(resolveAuthorHero(spec, authorHeroFixture('en'), { ...authorHeroRecipe, sections: authorHeroRecipe.sections.filter(s => s.type !== type) }).success).toBe(false);
    }
    expect(phase2StorefrontRecipeSchema.safeParse({ ...authorHeroRecipe, sections: [...authorHeroRecipe.sections, { id: 'other', type: 'hero-product/1', variant: 'simple', product: { setting: 'heroProduct' }, content: { slot: 'home.hero' } }] }).success).toBe(false);
  });
  it('renders punctuation as plain text', () => {
    const value = resolveAuthorHero(spec, authorHeroFixture('en', 'hostile'), authorHeroRecipe);
    expect(value.success).toBe(true);
    if (!value.success) return;
    const html = renderToStaticMarkup(createElement(AuthorHero, value.data));
    expect(html).toContain('&quot; &amp; { heading }');
    expect(html).not.toContain('<script');
  });
  it('accepts exact-bound EN/PL long copy', () => {
    for (const locale of ['en', 'pl'] as const) expect(resolveAuthorHero(spec, authorHeroFixture(locale, 'long'), authorHeroRecipe).success).toBe(true);
  });
  it('rejects HTML, URLs and undeclared fields in author input', () => {
    const inputs = authorHeroFixture('en');
    for (const patch of [{ heading: '<img src=x>' }, { name: 'x'.repeat(121) }, { intro: 'x'.repeat(4001) }, { portraitMediaId: 'https://example.test/photo.jpg' }, { url: 'https://example.test' }, { biography: 'wrong slot' }]) {
      expect(resolveAuthorHero(spec, { ...inputs, slots: { 'home.author': { ...inputs.slots['home.author'], ...patch } } }, authorHeroRecipe).success).toBe(false);
    }
  });
  it('omits malformed media and projects only approved image fields', () => {
    const inputs = authorHeroFixture('en');
    const id = inputs.slots['home.author'].portraitMediaId!;
    const credentialUrl = new URL('https://example.test/a');
    credentialUrl.username = 'fixture';
    credentialUrl.password = 'fixture';
    for (const patch of [{ src: 'javascript:alert(1)' }, { src: '//example.test/image' }, { src: credentialUrl.href }, { width: 0 }, { height: NaN }]) {
      const value = resolveAuthorHero(spec, { ...inputs, mediaById: { [id]: { ...inputs.mediaById[id], ...patch } } }, authorHeroRecipe);
      expect(value.success && value.data.portrait).toBeNull();
    }
    const media = { ...inputs.mediaById[id], privateField: 'sentinel' };
    const value = resolveAuthorHero(spec, { ...inputs, mediaById: { [id]: media } }, authorHeroRecipe);
    expect(JSON.stringify(value)).not.toContain('sentinel');
  });
});
