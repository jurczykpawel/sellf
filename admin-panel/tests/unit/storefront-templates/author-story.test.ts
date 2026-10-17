/** Biography bounds, projection and retained source-locale copy. @see docs/templates/phase2-contracts.md */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AuthorStory from '@/components/storefront/sections/AuthorStory';
import { resolveAuthorStory } from '@/lib/storefront-templates/author-story';
import { phase2ConfigSchema } from '@/lib/storefront-templates/phase2-contracts';
import { authorStoryFixture, storySpec } from '../../fixtures/storefront-sections/author-story';
import { referenceConfig } from '../../fixtures/storefront-sections/phase2/contracts';

describe('author-story/1', () => {
  it('projects only the typed biography and locale', () => {
    const inputs = authorStoryFixture('pl');
    const resolved = resolveAuthorStory(storySpec, inputs);
    expect(resolved).toEqual({ success: true, data: { content: inputs.slots['home.story'], locale: 'pl' } });
    if (!resolved.success) return;
    const html = renderToStaticMarkup(createElement(AuthorStory, resolved.data));
    expect(html.match(/<h2/g)).toHaveLength(1);
    expect(html).toContain('<blockquote');
    expect(html).not.toMatch(/<h1|<a |<img|<script|iframe|undefined/);
  });
  it('omits absent and blank optional stories without inventing copy', () => {
    for (const state of ['empty', 'blank'] as const) {
      const resolved = resolveAuthorStory(storySpec, authorStoryFixture('en', state));
      expect(resolved.success).toBe(true);
      if (resolved.success) expect(renderToStaticMarkup(createElement(AuthorStory, resolved.data))).toBe('');
    }
  });
  it('enforces the frozen slot, kind, field and prose bounds', () => {
    const inputs = authorStoryFixture('en');
    for (const spec of [{ ...storySpec, content: { slot: 'home.author' } }, { ...storySpec, url: 'https://example.test' }, { ...storySpec, type: 'author-story/2' }]) expect(resolveAuthorStory(spec, inputs).success).toBe(false);
    const content = inputs.slots['home.story']!;
    for (const patch of [{ kind: 'author' }, { heading: '<b>Title</b>' }, { heading: 'a'.repeat(161) }, { paragraphs: ['<script>text</script>'] }, { paragraphs: ['a'.repeat(2001)] }, { paragraphs: Array(7).fill('text') }, { credentials: 'Invented credential' }]) {
      expect(resolveAuthorStory(storySpec, { ...inputs, slots: { 'home.story': { ...content, ...patch } } }).success).toBe(false);
    }
    expect(resolveAuthorStory(storySpec, authorStoryFixture('en', 'long')).success).toBe(true);
  });
  it('retains localized biography through serialized A → C → D switches and uses the declared source fallback', () => {
    let config = phase2ConfigSchema.parse(referenceConfig());
    const story = config.content['home.story']!;
    const retained = JSON.stringify(story);
    for (const templateId of ['storefront-a', 'storefront-c', 'd'] as const) {
      config = phase2ConfigSchema.parse(JSON.parse(JSON.stringify({ ...config, templateId })));
      expect(JSON.stringify(config.content['home.story'])).toBe(retained);
    }
    for (const sourceLocale of ['en', 'pl'] as const) {
      const slot = { sourceLocale, [sourceLocale]: story[sourceLocale] };
      const parsed = phase2ConfigSchema.parse({ ...config, content: { ...config.content, 'home.story': slot } });
      const localized = parsed.content['home.story']!;
      const locale = sourceLocale === 'en' ? 'pl' : 'en';
      const content = localized[locale] ?? localized[localized.sourceLocale];
      expect(resolveAuthorStory(storySpec, { locale, slots: { 'home.story': content } })).toEqual({ success: true, data: { content: story[sourceLocale], locale } });
    }
  });
});
