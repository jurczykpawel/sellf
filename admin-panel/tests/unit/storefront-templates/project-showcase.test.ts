/** Project presentation boundaries. @see docs/templates/phase2-contracts.md */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ProjectShowcase from '@/components/storefront/sections/ProjectShowcase';
import { resolveProjectShowcase } from '@/lib/storefront-templates/project-showcase';
import { phase2ConfigSchema } from '@/lib/storefront-templates/phase2-contracts';
import { projectsFixture, projectsSpec, projectMediaId } from '../../fixtures/storefront-sections/project-showcase';
import { referenceConfig } from '../../fixtures/storefront-sections/phase2/contracts';

const credentialLink = new URL('https://example.test/a');
credentialLink.username = 'fixture';
credentialLink.password = 'fixture';

const render = (inputs: ReturnType<typeof projectsFixture>) => {
  const value = resolveProjectShowcase(projectsSpec, inputs);
  expect(value.success).toBe(true);
  return value.success ? renderToStaticMarkup(createElement(ProjectShowcase, value.data)) : '';
};
describe('project-showcase/1', () => {
  it('projects three ordered public items without I/O or extra fields', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      const inputs = projectsFixture('en'); const value = resolveProjectShowcase(projectsSpec, inputs);
      expect(value.success).toBe(true); if (!value.success) return;
      expect(Object.keys(value.data).sort()).toEqual(['heading', 'items', 'locale']);
      expect(value.data.items.map(item => item.id)).toEqual(['project-1', 'project-2', 'project-3']);
      expect(Object.keys(value.data.items[0]).sort()).toEqual(['body', 'id', 'media', 'name', 'url']);
      const html = render(inputs);
      expect(html.match(/<article/g)).toHaveLength(3);
      expect(html).toContain('href="https://example.test/project-1"');
      expect(html).not.toMatch(/iframe|<video|<script|<img|checkout|autoplay|undefined/);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('rejects fourth projects, duplicate IDs, wrong slots and unknown fields', () => {
    const inputs = projectsFixture('en'); const content = inputs.slots['home.projects']!;
    for (const items of [[...content.items, { ...content.items[0], id: 'fourth' }], [content.items[0], content.items[0]]])
      expect(resolveProjectShowcase(projectsSpec, { ...inputs, slots: { 'home.projects': { ...content, items } } }).success).toBe(false);
    for (const patch of [{ heading: '<b>Title</b>' }, { kind: 'biography' }, { heading: 'x'.repeat(161) }, { embed: 'https://example.test' }])
      expect(resolveProjectShowcase(projectsSpec, { ...inputs, slots: { 'home.projects': { ...content, ...patch } } }).success).toBe(false);
    expect(resolveProjectShowcase({ ...projectsSpec, content: { slot: 'home.story' } }, inputs).success).toBe(false);
    expect(resolveProjectShowcase({ ...projectsSpec, fetch: true }, inputs).success).toBe(false);
  });
  it.each(['javascript:alert(1)', 'data:text/html,test', '//example.test', 'http://example.test',
    credentialLink.href, 'https://127.0.0.1/a', 'https://[::1]/', 'https://169.254.169.254/',
    'https://localhost/a', 'https://a.internal/a', 'https://a.local/a', 'https://google.internal/a',
    'https://example.test/redirect?url=https://local.test', 'https://example.test/#fragment',
    'https://example.test/%2fprivate', 'https://example.test:8080/a', 'https://example.test/\npath',
    'https://example.test\\@local.test'])('rejects project link %s', url => {
    const inputs = projectsFixture('en'); const content = inputs.slots['home.projects']!;
    expect(resolveProjectShowcase(projectsSpec, { ...inputs, slots: { 'home.projects': { ...content, items: [{ ...content.items[0], url }] } } }).success).toBe(false);
  });
  it('omits absent content and missing samples without fabricated proof', () => {
    expect(render(projectsFixture('en', 'empty'))).toBe('');
    const inputs = projectsFixture('en'); inputs.slots['home.projects']!.items = [];
    expect(render(inputs)).toBe('');
    expect(render(projectsFixture('pl', 'unresolved-media'))).not.toMatch(/<img|<video|play|testimonial|rating/);
  });
  it('renders only approved image fields lazily and omits malformed media', () => {
    const inputs = projectsFixture('en', 'media');
    const image = { ...inputs.mediaById[projectMediaId], privateField: 'PRIVATE_SENTINEL' };
    const value = resolveProjectShowcase(projectsSpec, { ...inputs, mediaById: { [projectMediaId]: image } });
    expect(value.success && value.data.items[0].media).toEqual(inputs.mediaById[projectMediaId]);
    expect(render(inputs)).toContain('loading="lazy"');
    expect(render(inputs)).toContain('width="800" height="500"');
    for (const patch of [{ src: 'data:image/png,x' }, { src: '//example.test/a' }, { src: credentialLink.href }, { width: 0 }, { height: NaN }]) {
      const resolved = resolveProjectShowcase(projectsSpec, { ...inputs, mediaById: { [projectMediaId]: { ...image, ...patch } } });
      expect(resolved.success && resolved.data.items[0].media).toBeNull();
    }
  });
  it('uses the declared source slot in either locale when a translation is absent', () => {
    for (const sourceLocale of ['en', 'pl'] as const) {
      const value = projectsFixture(sourceLocale).slots['home.projects']!;
      const slot = sourceLocale === 'en' ? { sourceLocale, en: value } : { sourceLocale, pl: value };
      const parsed = phase2ConfigSchema.parse({ ...referenceConfig(), content: { 'home.projects': slot } });
      const saved = parsed.content['home.projects']!;
      for (const locale of ['en', 'pl'] as const) {
        const selected = saved[locale] ?? saved[saved.sourceLocale];
        const resolved = resolveProjectShowcase(projectsSpec, { locale, slots: { 'home.projects': selected }, mediaById: {} });
        expect(resolved.success && resolved.data.heading).toBe(value.heading);
      }
    }
  });
  it('accepts plain HTTPS paths and rejects item bounds and non-media references', () => {
    const inputs = projectsFixture('en'); const content = inputs.slots['home.projects']!;
    for (const url of ['https://example.test', 'https://example.test:443/projects/one-two_3']) {
      const resolved = resolveProjectShowcase(projectsSpec, { ...inputs, slots: { 'home.projects': { ...content, items: [{ ...content.items[0], url }] } } });
      expect(resolved.success && resolved.data.items[0].url).toBe(url);
    }
    for (const patch of [{ name: 'x'.repeat(121) }, { body: 'x'.repeat(1001) }, { body: '<b>Text</b>' }, { mediaId: 'https://example.test/image.png' }, { price: 0 }]) {
      expect(resolveProjectShowcase(projectsSpec, { ...inputs, slots: { 'home.projects': { ...content, items: [{ ...content.items[0], ...patch }] } } }).success).toBe(false);
    }
    const resolved = resolveProjectShowcase(projectsSpec, { ...inputs, slots: { 'home.projects': { ...content, items: [{ ...content.items[0], name: '" & { project }', body: '" & { text }' }] } } });
    expect(resolved.success && renderToStaticMarkup(createElement(ProjectShowcase, resolved.data))).toContain('&quot; &amp; { project }');
  });
  it('retains localized slots through template changes and accepts exact bounds', () => {
    const config = referenceConfig();
    for (const templateId of ['storefront-c', 'storefront-a', 'd'] as const) {
      const parsed = phase2ConfigSchema.parse(JSON.parse(JSON.stringify({ ...config, templateId })));
      expect(parsed.content['home.projects']).toEqual(config.content['home.projects']);
    }
    for (const locale of ['en', 'pl'] as const) {
      expect(render(projectsFixture(locale, 'long'))).toContain('<h2');
      expect(render(projectsFixture(locale))).toContain(locale === 'pl' ? 'Zobacz projekt' : 'View project');
    }
  });
});
