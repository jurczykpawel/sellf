/** @see spec/contracts/validator-cli.md */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEFAULT_CONFIG, D_CONFIG, D_TOKENS, PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import { storedJsonBytes } from '@/lib/storefront-templates/json';
import { configSchema, recipeSchema } from '@/lib/storefront-templates/schemas';
import { CORE_SETTINGS, STOREFRONT_TEMPLATES } from '@/lib/storefront-templates/registry';

const directory = mkdtempSync(join(tmpdir(), 'template-check-'));
let counter = 0;
function file(value: unknown): string {
  const path = join(directory, `${counter++}.json`);
  writeFileSync(path, value instanceof Uint8Array || typeof value === 'string' ? value : JSON.stringify(value));
  return path;
}
function run(...args: string[]) {
  const child = spawnSync(process.env.TEMPLATE_TEST_BUN ?? 'bun', ['--no-env-file', 'scripts/check-template.ts', ...args], { encoding: 'utf8' });
  return { status: child.status, stderr: child.stderr, output: child.stdout ? JSON.parse(child.stdout) : null };
}
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('template check command', () => {
  it('accepts default and D config and recipe fixtures with JSON-only stdout', () => {
    for (const config of [DEFAULT_CONFIG, D_CONFIG]) {
      const checked = run('--config', file(config), '--json');
      expect(checked.status, checked.stderr).toBe(0);
      expect(checked.output).toMatchObject({ validatorVersion: 1, valid: true, errors: [] });
    }
    for (const entry of Object.values(STOREFRONT_TEMPLATES)) expect(run('--recipe', file(entry.defaults), '--json').status).toBe(0);
  });

  it('returns exit one and public pointer/code for the invalid corpus', () => {
    const corpus: [unknown, string, string][] = [
      [{ ...D_CONFIG, overridesByTemplate: { d: { order: ['catalogue'] } } }, 'LIMIT', '/overridesByTemplate/d/order'],
      [{ ...D_CONFIG, content: { 'home.hero': { sourceLocale: 'en', en: { kind: 'cta', heading: '', body: '' } } } }, 'SCHEMA', '/content/home.hero'],
      [{ ...DEFAULT_CONFIG, extra: 'private-value' }, 'SCHEMA', ''],
      [{ ...D_CONFIG, settingsByTemplate: { d: { heroProduct: 'invalid' } } }, 'SCHEMA', '/settingsByTemplate/d/heroProduct'],
      [{ ...D_CONFIG, overridesByTemplate: { d: { hidden: ['catalogue'] } } }, 'SCHEMA', '/overridesByTemplate/d/hidden/0'],
      [{ ...D_CONFIG, tokens: { format: 1, light: { accent: 'url(https://example.com)' } } }, 'SCHEMA', '/tokens/light/accent'],
      ['{"format":1,"format":1}', 'SCHEMA', ''],
      ['{"__proto__":{}}', 'SCHEMA', ''],
      ['{"x":"\\ud800"}', 'SCHEMA', ''],
      ['\ufeff{}', 'SCHEMA', ''],
      ['['.repeat(13) + '0' + ']'.repeat(13), 'SCHEMA', ''],
      [new Uint8Array([0xc3, 0x28]), 'SCHEMA', ''],
      [' '.repeat(102401), 'LIMIT', ''],
    ];
    for (const [value, code, path] of corpus) {
      const checked = run('--config', file(value), '--json');
      expect(checked.status).toBe(1);
      expect(checked.output.errors).toContainEqual(expect.objectContaining({ code, path }));
      expect(JSON.stringify(checked.output)).not.toContain('private-value');
    }
    const recipe = STOREFRONT_TEMPLATES.d.defaults;
    expect(run('--recipe', file({ ...recipe, sections: Array(33).fill(recipe.sections[0]) }), '--json').output.errors[0]).toMatchObject({ code: 'LIMIT', path: '/sections', limit: 32 });
    expect(run('--recipe', file({ ...recipe, sections: [{ ...recipe.sections[1], target: 'missing' }] }), '--json').output.errors[0].code).toBe('BINDING');
  });

  it('enforces independent input and stored byte boundaries', () => {
    for (const size of [102399, 102400, 102401]) {
      const padded = JSON.stringify(DEFAULT_CONFIG).padEnd(size);
      expect(run('--config', file(padded), '--json').status).toBe(size <= 102400 ? 0 : 1);
      const config = structuredClone(D_CONFIG);
      const items = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, question: '', answer: '' }));
      config.content['home.faq'] = { sourceLocale: 'en', en: { kind: 'faq', items: structuredClone(items) }, pl: { kind: 'faq', items: structuredClone(items) } };
      let remaining = size - storedJsonBytes(config)!;
      for (const slot of [config.content['home.faq'].en, config.content['home.faq'].pl]) {
        if (slot?.kind !== 'faq') throw new Error('Expected FAQ fixture');
        for (const item of slot.items) { const count = Math.min(4000, remaining); item.answer = 'a'.repeat(count); remaining -= count; }
      }
      expect(storedJsonBytes(config)).toBe(size);
      const checked = run('--config', file(config), '--json');
      expect(checked.status).toBe(size <= 102400 ? 0 : 1);
      if (size > 102400) expect(checked.output.errors[0]).toMatchObject({ code: 'LIMIT', limit: 102400 });
    }
  });

  it('distinguishes unreadable files and usage from validation without echoing inputs', () => {
    for (const args of [['--config', join(directory, 'missing-secret.json')], ['--config'], ['--wat'], ['--config', file(DEFAULT_CONFIG), '--mode', 'other']]) {
      const checked = run(...args, '--json');
      expect(checked.status).toBe(2);
      expect(checked.output).toMatchObject({ validatorVersion: 1, valid: false });
      expect(checked.stderr).not.toContain(directory);
      expect(checked.stderr).not.toContain('secret');
    }
  });

  it('requires publish fixture and checks active bindings without attesting live rights', () => {
    expect(run('--config', file(D_CONFIG), '--mode', 'publish', '--json').output.errors[0].code).toBe('BINDING');
    const valid = run('--config', file(D_CONFIG), '--fixture', file(PUBLIC_FIXTURE), '--mode', 'publish', '--json');
    expect(valid.status).toBe(0);
    expect(valid.output.warnings).toContainEqual(expect.objectContaining({ code: 'ENTITLEMENT' }));
    expect(valid.output.warnings).toContainEqual(expect.objectContaining({ code: 'TRANSLATION_FALLBACK' }));
    const missing = run('--config', file({ ...D_CONFIG, settingsByTemplate: {} }), '--fixture', file(PUBLIC_FIXTURE), '--mode', 'publish', '--json');
    expect(missing.status).toBe(1);
    expect(missing.output.errors).toContainEqual(expect.objectContaining({ code: 'BINDING', path: '/settingsByTemplate/d/heroProduct' }));
    const unavailable = { ...PUBLIC_FIXTURE, products: PUBLIC_FIXTURE.products.map(product => ({ ...product, availability: 'unavailable' })) };
    expect(run('--config', file(D_CONFIG), '--fixture', file(unavailable), '--mode', 'publish', '--json').output.errors[0].code).toBe('UNAVAILABLE_PRODUCT');
    expect(run('--config', file(D_CONFIG), '--fixture', file({ products: [], categories: [] }), '--json').output.warnings).toContainEqual(expect.objectContaining({ code: 'BINDING' }));
  });

  it('prints schemas directly from Zod and exact generated capabilities', () => {
    for (const [name, schema] of [['config', configSchema], ['recipe', recipeSchema]] as const) expect(run('--print-schema', name).output).toEqual(z.toJSONSchema(schema));
    const capabilities = run('--capabilities').output;
    expect(capabilities.coreSettings).toEqual(CORE_SETTINGS);
    expect(capabilities.templates).toEqual(Object.values(STOREFRONT_TEMPLATES));
    expect(capabilities.slots).toEqual({ 'home.hero': 'hero', 'home.tasks': 'heading', 'home.starts': 'heading', 'home.faq': 'faq', 'home.closing': 'cta', 'home.comparison': 'comparison', 'home.catalogue': 'heading' });
    expect(capabilities.schemas.config).toEqual(z.toJSONSchema(configSchema));
    for (const id of ['default', 'd']) {
      const expected = ['settings.density', 'overrides.order', 'overrides.hidden', ...(id === 'd' ? ['hero', 'tasks', 'start', 'catalogue', 'faq', 'closing'] : ['catalogue']).map(section => `overrides.variants.${section}`), ...Object.entries(D_TOKENS).flatMap(([group, value]) => typeof value === 'object' ? Object.keys(value).map(leaf => `tokens.${group}.${leaf}`) : [])];
      expect(capabilities.resetPaths[id].sort()).toEqual(expected.sort());
    }
  });
});
