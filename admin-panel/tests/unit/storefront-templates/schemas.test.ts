/** @see priv/rfc/2026-10-03-templates/spec/contracts/template-recipe.md */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import { z } from 'zod';
import { configSchema, recipeSchema, registryEntrySchema, revisionSchema, tokenOverridesSchema } from '@/lib/storefront-templates/schemas';
import { CONFIG_BYTES, ENVELOPE_BYTES, parseBoundedJson, storedJsonBytes } from '@/lib/storefront-templates/json';
import { CORE_SETTINGS, STOREFRONT_TEMPLATES, isResetPath, validateConfig, validateRecipe } from '@/lib/storefront-templates/registry';
import { DEFAULT_CONFIG, D_CONFIG, PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';

const clone = () => structuredClone(D_CONFIG);
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('storefront schema corpus', () => {
  it('keeps generated draft 2020-12 schema synchronized', () => {
    const migration = readFileSync('../supabase/migrations/20261016000000_release_2026_10_6.sql', 'utf8');
    expect(migration).toContain(JSON.stringify(z.toJSONSchema(configSchema)).replaceAll("'", "''"));
  });

  it('agrees across structural validators for complete configs and partial tokens', () => {
    const validate = new Ajv2020({ strict: false }).compile(z.toJSONSchema(configSchema));
    const invalid = [
      { ...clone(), sections: [] }, { ...clone(), templateId: 'other' },
      { ...clone(), content: { 'home.hero': { sourceLocale: 'en', en: { kind: 'heading', heading: '', body: '' } } } },
      { ...clone(), tokens: { format: 1, light: { accent: 'url(https://example.com)' } } },
      { ...clone(), settingsByTemplate: { d: { heroProduct: 'invalid' } } },
      { ...clone(), overridesByTemplate: { d: { sections: { catalogue: { visibility: 'hidden' } } } } },
      { ...clone(), content: { unknown: {} } },
      { ...clone(), tokens: { format: 1, typography: { font: 'inter' } } },
    ];
    const valid = [DEFAULT_CONFIG, D_CONFIG, ...[null, { format: 1 }, { format: 1, light: { accent: '#075C43' } }].map(tokens => ({ ...clone(), tokens }))];
    for (const [corpus, expected] of [[valid, true], [invalid, false]] as const) {
      for (const config of corpus) {
        expect(configSchema.safeParse(config).success).toBe(expected);
        expect(validate(config), JSON.stringify(validate.errors)).toBe(expected);
      }
    }
  });

  it('validates both complete registry entries and recipes', () => {
    for (const entry of Object.values(STOREFRONT_TEMPLATES)) {
      expect(registryEntrySchema.safeParse(entry).success).toBe(true);
      expect(validateRecipe(entry.defaults).valid).toBe(true);
    }
    expect(CORE_SETTINGS.density.default).toBe('comfortable');
    expect(STOREFRONT_TEMPLATES.default.settings).toEqual([]);
    expect(validateConfig(DEFAULT_CONFIG).valid).toBe(true);
    expect(validateConfig(D_CONFIG).valid).toBe(true);
    const ids = new Set(PUBLIC_FIXTURE.products.map(product => product.id));
    for (const id of [D_CONFIG.settingsByTemplate.d!.heroProduct!, D_CONFIG.settingsByTemplate.d!.closingProduct!, ...D_CONFIG.settingsByTemplate.d!.starterProducts!]) expect(ids.has(id)).toBe(true);
    expect(D_CONFIG.settingsByTemplate.d!.taskCategories).toEqual(PUBLIC_FIXTURE.categories.map(category => category.id));
  });

  it('bounds flat recipes and checks section IDs, slots, variants and targets', () => {
    const recipe = STOREFRONT_TEMPLATES.d.defaults;
    const section = recipe.sections[0];
    const validate = new Ajv2020({ strict: false }).compile(z.toJSONSchema(recipeSchema));
    expect(validate(recipe)).toBe(true);
    const oversized = { ...recipe, sections: Array.from({ length: 33 }, (_, i) => ({ ...section, id: `s${i}` })) };
    expect(recipeSchema.safeParse(oversized).success).toBe(false);
    expect(validate(oversized)).toBe(false);
    for (const sections of [
      [{ ...section, content: { slot: 'home.faq' } }],
      [{ ...section, type: 'hero-product/2' }], [{ ...section, props: {} }],
      [{ id: 'tasks', type: 'task-nav/1', categories: { setting: 'taskCategories' }, content: { slot: 'home.tasks' }, target: 'missing' }],
    ]) {
      expect(validateRecipe({ ...recipe, sections }).valid).toBe(false);
      if (sections[0].type !== 'task-nav/1') expect(validate({ ...recipe, sections })).toBe(false);
    }
    expect(validateRecipe({ ...recipe, sections: [section, section] }).valid).toBe(false);
  });

  it('checks localized source, unique lists and override permutations without losing inactive values', () => {
    for (const change of [
      { content: { 'home.hero': { sourceLocale: 'pl', en: D_CONFIG.content['home.hero']!.en } } },
      { settingsByTemplate: { d: { starterProducts: Array(2).fill('22222222-2222-4222-8222-222222222222') } } },
      { overridesByTemplate: { d: { order: ['hero', 'hero'] } } },
      { overridesByTemplate: { d: { sections: { hero: { variant: 'compact' } } } } },
    ]) expect(validateConfig({ ...clone(), ...change }).valid).toBe(false);
    const switched = { ...clone(), templateId: 'default' };
    expect(validateConfig(switched).valid).toBe(true);
    expect(configSchema.parse(switched).content).toEqual(D_CONFIG.content);
    expect(configSchema.parse(switched).settingsByTemplate).toEqual(D_CONFIG.settingsByTemplate);
  });

  it('enforces nested content, list and token limits', () => {
    const faq = { sourceLocale: 'en', en: { kind: 'faq', items: [{ id: 'q', question: 'Q', answer: 'A' }, { id: 'q', question: 'Q2', answer: 'A2' }] } };
    expect(validateConfig({ ...clone(), content: { 'home.faq': faq } }).valid).toBe(false);
    for (const tokens of [
      { format: 1, typography: { bodyWeight: 0 } }, { format: 1, typography: { headingWeight: 800 } },
      { format: 1, typography: { baseSizePx: 0 } }, { format: 1, shapes: { radiusSmPx: 999 } },
      { format: 1, dark: { accent: '#fff' } }, { format: 1, light: { extra: '#FFFFFF' } },
      { format: 1, typography: { headingLetterSpacingEm: 0.01 } },
    ]) expect(validateConfig({ ...clone(), tokens }).valid).toBe(false);
    for (const field of ['eyebrow', 'heading', 'body', 'steps'] as const) {
      const config = clone();
      const content = config.content['home.hero']!.en;
      if (content?.kind !== 'hero') throw new Error('Expected hero fixture');
      if (field === 'steps') content.steps = Array(7).fill('step');
      else content[field] = 'a'.repeat(field === 'body' ? 4001 : field === 'heading' ? 161 : 81);
      expect(validateConfig(config).valid).toBe(false);
    }
    expect(validateConfig({ ...clone(), sections: [] }).valid).toBe(false);
  });

  it('accepts only declared reset leaves including core density', () => {
    for (const path of ['tokens.light.accent', 'tokens.dark.border', 'tokens.typography.font', 'tokens.shapes.radiusMdPx', 'settings.density', 'overrides.order', 'overrides.sections.tasks.visibility', 'overrides.sections.hero.variant']) expect(isResetPath('d', path)).toBe(true);
    for (const path of ['tokens.format', 'tokens.light', 'tokens.light.other', 'content.home.hero', 'settings.heroProduct', 'overrides.sections.catalogue.other', '__proto__']) expect(isResetPath('d', path)).toBe(false);
    expect(isResetPath('default', 'overrides.sections.hero.variant')).toBe(false);
    expect(isResetPath('default', 'settings.density')).toBe(true);
    expect(isResetPath('__proto__', 'settings.density')).toBe(false);
    expect(tokenOverridesSchema.safeParse({ format: 1, light: { accent: null } }).success).toBe(false);
  });
});

describe('JSON and numeric boundary corpus', () => {
  it.each([102399, 102400, 102401])('checks exact input and normalized stored bytes at %i', size => {
    const json = JSON.stringify(DEFAULT_CONFIG);
    const wire = new TextEncoder().encode(json + ' '.repeat(size - json.length));
    expect(parseBoundedJson(wire).valid).toBe(size <= CONFIG_BYTES);
    const value = { body: 'a'.repeat(size - 12) };
    expect(storedJsonBytes(value)).toBe(size);
  });

  it.each([102399, 102400, 102401])('enforces normalized config size at %i', size => {
    const config = clone();
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, question: '', answer: '' }));
    config.content['home.faq'] = { sourceLocale: 'en', en: { kind: 'faq', items: structuredClone(items) }, pl: { kind: 'faq', items: structuredClone(items) } };
    let remaining = size - storedJsonBytes(config);
    for (const slot of [config.content['home.faq'].en, config.content['home.faq'].pl]) {
      if (slot?.kind !== 'faq') throw new Error('Expected FAQ fixture');
      for (const item of slot.items) { const length = Math.min(4000, remaining); item.answer = 'a'.repeat(length); remaining -= length; }
    }
    expect(remaining).toBe(0);
    expect(storedJsonBytes(config)).toBe(size);
    const schemaValidate = new Ajv2020({ strict: false }).compile(z.toJSONSchema(configSchema));
    expect(schemaValidate(config)).toBe(true);
    expect(configSchema.safeParse(config).success).toBe(true);
    expect(parseBoundedJson(encode(config)).valid).toBe(true);
    expect(validateConfig(config).valid).toBe(size <= CONFIG_BYTES);
  });

  it('models PostgreSQL spacing, escapes, Unicode and fixed decimal enums', () => {
    expect(storedJsonBytes({ z: ['Łódź', '\n', '\u0001', '"', '\\', -0.01], a: {} })).toBe(new TextEncoder().encode('{"a": {}, "z": ["Łódź", "\\n", "\\u0001", "\\\"", "\\\\", -0.01]}').length);
    const compact = encode({ items: Array(35000).fill(1) });
    expect(compact.length).toBeLessThan(CONFIG_BYTES);
    expect(storedJsonBytes(JSON.parse(new TextDecoder().decode(compact)))).toBeGreaterThan(CONFIG_BYTES);
    for (const n of [NaN, Infinity, 1e30, 0.2]) expect(storedJsonBytes(n)).toBeNull();
  });

  it('rejects repeated keys, non-plain objects, malformed encoding and excess depth', () => {
    for (const raw of ['{"format":1,"format":1}', '{"x":1,"\\u0078":2}', '{"__proto__":{}}', '{"constructor":{}}', '{"x":"\\ud800"}', '{"x":"\\u0000"}', '\ufeff{}', '{', '{"x":"�"}', '{"format":1e0}', '{"format":1.0}', '{"x":0.2}', '['.repeat(13) + '0' + ']'.repeat(13)]) expect(parseBoundedJson(new TextEncoder().encode(raw)).valid).toBe(false);
    expect(parseBoundedJson(new Uint8Array([0xc3, 0x28])).valid).toBe(false);
    expect(parseBoundedJson(new TextEncoder().encode('{"x":"😀"}')).valid).toBe(true);
    expect(validateConfig(Object.assign(Object.create({ x: 1 }), DEFAULT_CONFIG)).valid).toBe(false);
    expect(validateConfig(JSON.parse('{"__proto__":{},"format":1}')).valid).toBe(false);
  });

  it('bounds envelopes independently and rejects unsafe revisions', () => {
    for (const size of [ENVELOPE_BYTES - 1, ENVELOPE_BYTES, ENVELOPE_BYTES + 1]) expect(parseBoundedJson(new TextEncoder().encode('{}' + ' '.repeat(size - 2)), ENVELOPE_BYTES).valid).toBe(size <= ENVELOPE_BYTES);
    const check = new Ajv2020({ strict: false }).compile(z.toJSONSchema(revisionSchema));
    for (const value of [0, Number.MAX_SAFE_INTEGER, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '9007199254740991']) {
      const expected = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
      expect(revisionSchema.safeParse(value).success).toBe(expected);
      expect(check(value)).toBe(expected);
    }
    const config = JSON.stringify(DEFAULT_CONFIG).padEnd(CONFIG_BYTES);
    const body = `{"expectedRevision":9007199254740991,"config":${config}}`;
    expect(parseBoundedJson(new TextEncoder().encode(body), ENVELOPE_BYTES).valid).toBe(true);
    expect(parseBoundedJson(new TextEncoder().encode(body.padEnd(ENVELOPE_BYTES)), ENVELOPE_BYTES).valid).toBe(true);
  });
});
