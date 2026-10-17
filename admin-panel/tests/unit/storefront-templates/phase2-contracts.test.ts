/** Shared Phase 2 contract acceptance. @see docs/templates/phase2-contracts.md */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { phase2ConfigSchema, phase2RecipeSchema, phase2ContentSchema, phase2SettingsSchema, validatePhase2 } from '@/lib/storefront-templates/phase2-contracts';
import { templateCapabilities, templateSchemas } from '@/lib/storefront-templates/capabilities';
import { DEFAULT_CONFIG, D_CONFIG } from '@/lib/storefront-templates/fixtures';
import { configSchema } from '@/lib/storefront-templates/schemas';
import { CONFIG_BYTES, parseBoundedJson, storedJsonBytes } from '@/lib/storefront-templates/json';
import { phase2Recipes, phase2Config, referenceConfig, uuid } from '../../fixtures/storefront-sections/phase2/contracts';

describe('frozen Phase 2 contracts', () => {
  it('accepts synthetic A/B/C and route-bound offers without selecting unfinished renderers', () => {
    for (const recipe of Object.values(phase2Recipes)) expect(validatePhase2(recipe, 'recipe').valid).toBe(true);
    expect(validatePhase2(phase2Config, 'config').valid).toBe(true);
    expect(validatePhase2(referenceConfig(), 'config').valid).toBe(true);
    expect(configSchema.safeParse(phase2Config).success).toBe(false);
    for (const config of [DEFAULT_CONFIG, D_CONFIG]) expect(configSchema.parse(config)).toEqual(config);
    expect(templateCapabilities().phase2.selectable).toBe(false);
    expect(templateSchemas()['phase2-recipe']).toEqual(z.toJSONSchema(phase2RecipeSchema));
  });
  it('declares strict section maps for offline B/C variants without installing their renderers', () => {
    for (const [templateId, sections] of [
      ['storefront-b', { hero: { variant: 'search-hero' }, featured: { variant: 'featured-grid' }, starter: { visibility: 'hidden' } }],
      ['storefront-c', { story: { visibility: 'hidden' }, start: { variant: 'compact' } }],
    ]) {
      const config = { ...phase2Config, templateId, overridesByTemplate: { [String(templateId)]: { sections } } };
      expect(validatePhase2(config, 'config').valid).toBe(true);
      expect(configSchema.safeParse(config).success).toBe(false);
      expect(validatePhase2({ ...config, overridesByTemplate: { [String(templateId)]: { hidden: [] } } }, 'config').valid).toBe(false);
    }
  });
  it('rejects wrong variant bindings, slots, unknown props and missing or wrong targets', () => {
    for (const section of [
      { ...phase2Recipes.a.sections[2], products: { setting: 'starterProducts' } },
      { ...phase2Recipes.a.sections[0], content: { slot: 'home.faq' } },
      { ...phase2Recipes.a.sections[0], price: 1 },
      { ...phase2Recipes.b.sections[0], target: 'missing' },
      { ...phase2Recipes.b.sections[0], target: 'faq' },
      { ...phase2Recipes.offer.sections[0], product: { setting: 'heroProduct' } },
      { ...phase2Recipes.c.sections[0], pathsTarget: 'catalogue' },
      { ...phase2Recipes.a.sections.at(-1), product: { setting: 'closingProduct' } },
    ]) expect(validatePhase2({ ...phase2Recipes.a, sections: [section, ...phase2Recipes.a.sections.slice(3)] }, 'recipe').valid).toBe(false);
  });
  it('keeps distinct comparison/featured/starter bounds independent', () => {
    for (const [key, count] of [['comparisonProducts', 2], ['featuredProducts', 6], ['starterProducts', 3]] as const) {
      const values = Array.from({ length: count }, (_, i) => uuid(i + 1));
      expect(phase2SettingsSchema.safeParse({ [key]: values }).success).toBe(true);
      expect(phase2SettingsSchema.safeParse({ [key]: [...values, uuid(20)] }).success).toBe(false);
      expect(phase2SettingsSchema.safeParse({ [key]: [values[0], values[0]] }).success).toBe(false);
    }
    expect(phase2SettingsSchema.safeParse({ comparisonProducts: [uuid(1)] }).success).toBe(false);
  });
  it('bounds localized paths/projects/category descriptions and rejects repeated bindings', () => {
    for (const [slot, max] of [['home.paths', 4], ['home.projects', 3], ['home.search', 12]] as const) {
      const entry = phase2Config.content[slot];
      const item = entry.en.items[0];
      const items = Array.from({ length: max }, (_, i) => ({ ...item, id: `item-${i}`, ...('productId' in item ? { productId: uuid(i + 1) } : {}), ...('categoryId' in item ? { categoryId: uuid(i + 1) } : {}) }));
      const content = { [slot]: { sourceLocale: 'en', en: { ...entry.en, items } } };
      expect(phase2ContentSchema.safeParse(content).success).toBe(true);
      expect(phase2ContentSchema.safeParse({ [slot]: { sourceLocale: 'en', en: { ...entry.en, items: [...items, { ...items[0], id: 'extra', ...('productId' in item ? { productId: uuid(25) } : {}), ...('categoryId' in item ? { categoryId: uuid(25) } : {}) }] } } }).success).toBe(false);
      expect(phase2ContentSchema.safeParse({ [slot]: { sourceLocale: 'en', en: { ...entry.en, items: [item, item] } } }).success).toBe(false);
    }
    expect(phase2ContentSchema.safeParse({ 'home.story': { sourceLocale: 'pl', en: { kind: 'biography', heading: 'Story', paragraphs: [] } } }).success).toBe(false);
    expect(phase2ContentSchema.safeParse({ 'home.story': { sourceLocale: 'en', en: { kind: 'biography', heading: '<b>Story</b>', paragraphs: [] } } }).success).toBe(false);
  });
  it('enforces project link and media policies without network access', () => {
    const credentialUrl = new URL('https://example.test');
    credentialUrl.username = 'example-user'; credentialUrl.password = 'example-password';
    for (const url of [credentialUrl.href, 'http://example.test', 'javascript:alert(1)', 'data:text/html,x', '//example.test', 'https://127.0.0.1', 'https://localhost', 'https://10.0.0.1', 'https://example.test/?email=x', 'https://example.test/#token', 'https://example.test/%2e%2e/private']) {
      const project = phase2Config.content['home.projects'].en.items[0];
      expect(phase2ContentSchema.safeParse({ 'home.projects': { sourceLocale: 'en', en: { kind: 'projects', heading: 'Projects', items: [{ ...project, url }] } } }).success, url).toBe(false);
    }
  });
  it('retains new content through switches within the original transport/stored budgets', () => {
    for (const templateId of ['default', 'd', 'storefront-a', 'storefront-b', 'storefront-c'] as const) {
      const config = { ...phase2Config, templateId };
      expect(phase2ConfigSchema.parse(config)).toEqual(config);
      expect(storedJsonBytes(config)).toBeLessThan(CONFIG_BYTES);
      expect(parseBoundedJson(new TextEncoder().encode(JSON.stringify(config))).valid).toBe(true);
    }
    for (const size of [102399, 102400, 102401]) {
      const config = structuredClone(phase2Config);
      const items = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, question: '', answer: '' }));
      config.content['home.faq'] = { sourceLocale: 'en', en: { kind: 'faq', items: structuredClone(items) }, pl: { kind: 'faq', items: structuredClone(items) } };
      let remaining = size - storedJsonBytes(config)!;
      for (const slot of [config.content['home.faq'].en, config.content['home.faq'].pl]) for (const item of slot.items) {
        const length = Math.min(4000, remaining); item.answer = 'a'.repeat(length); remaining -= length;
      }
      expect(remaining).toBe(0);
      expect(storedJsonBytes(config)).toBe(size);
      expect(validatePhase2(config, 'config').valid).toBe(size <= CONFIG_BYTES);
    }
  });
  it('keeps offer bindings route-only with optional FAQ and strict offer content', () => {
    const offer = phase2Recipes.offer;
    expect(validatePhase2({ ...offer, sections: [offer.sections[0], offer.sections[2]] }, 'recipe').valid).toBe(true);
    const config = { format: 1, enabled: true, templateId: 'offer-default', settings: { density: 'comfortable' }, content: {}, tokens: null };
    expect(validatePhase2(config, 'offer-config').valid).toBe(true);
    for (const change of [{ productId: uuid(1) }, { content: { 'home.hero': phase2Config.content['home.hero'] } }, { settings: { heroProduct: uuid(1) } }]) expect(validatePhase2({ ...config, ...change }, 'offer-config').valid).toBe(false);
  });
  it('checks Phase 2 through the existing CLI with generated contracts and stable exits', () => {
    const directory = mkdtempSync(join(tmpdir(), 'phase2-check-'));
    const run = (...args: string[]) => spawnSync(process.env.TEMPLATE_TEST_BUN ?? 'bun', ['--no-env-file', 'scripts/check-template.ts', ...args], { encoding: 'utf8' });
    try {
      const file = join(directory, 'recipe.json');
      for (const recipe of Object.values(phase2Recipes)) {
        writeFileSync(file, JSON.stringify(recipe));
        expect(run('--recipe', file, '--contract', 'phase2', '--json').status).toBe(0);
      }
      writeFileSync(file, JSON.stringify({ ...phase2Recipes.a, unknown: true }));
      expect(run('--recipe', file, '--contract', 'phase2', '--json').status).toBe(1);
      expect(run('--recipe', file, '--contract', 'phase2', '--mode', 'publish', '--json').status).toBe(2);
      expect(JSON.parse(run('--print-schema', 'phase2-config').stdout)).toEqual(z.toJSONSchema(phase2ConfigSchema));
      writeFileSync(file, JSON.stringify(phase2Config));
      expect(run('--config', file, '--contract', 'phase2', '--json').status).toBe(0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

it.each(['en', 'pl'] as const)('reports offer fallback from %s exactly like storefront validation', sourceLocale => {
  const faq = { kind: 'faq', items: [{ id: 'bring', question: 'Question', answer: 'Answer' }] };
  const config = { format: 1, enabled: true, templateId: 'offer-default', settings: { density: 'comfortable' }, tokens: null };
  const warning = { code: 'TRANSLATION_FALLBACK', path: '/content/offer.faq', message: 'Missing translation uses source locale' };
  expect(validatePhase2({ ...config, content: { 'offer.faq': { sourceLocale, [sourceLocale]: faq } } }, 'offer-config'))
    .toEqual({ validatorVersion: 1, valid: true, errors: [], warnings: [warning] });
  for (const content of [{}, { 'offer.faq': { sourceLocale, en: faq, pl: faq } }]) {
    expect(validatePhase2({ ...config, content }, 'offer-config')).toEqual({ validatorVersion: 1, valid: true, errors: [], warnings: [] });
  }
});
