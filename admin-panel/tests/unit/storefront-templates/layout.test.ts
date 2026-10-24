/** Stored intent and additive layout release gate. */
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import Ajv2020 from 'ajv/dist/2020';
import { configSchema } from '@/lib/storefront-templates/schemas';
import { DEFAULT_CONFIG, D_CONFIG } from '@/lib/storefront-templates/fixtures';
import { STOREFRONT_TEMPLATES, normalizeConfigOrders, validateConfig, validateRecipe } from '@/lib/storefront-templates/registry';
import { offerRecipeSchema, phase2ConfigSchema } from '@/lib/storefront-templates/phase2-contracts';
import { effectiveLayout } from '@/lib/storefront-templates/layout';
import { resolveSelection } from '@/lib/storefront-templates/resolver';
import type { LayoutOverrides } from '@/lib/storefront-templates/section-descriptors';
import type { StorefrontConfig, TemplateRecipe } from '@/lib/storefront-templates/schemas';
import { phase2Recipes } from '../../fixtures/storefront-sections/phase2/contracts';

vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));

it('accepts bounded known subsets and strict section intent in both schema runtimes', () => {
  const json = new Ajv2020({ strict: false }).compile(z.toJSONSchema(configSchema));
  const base = { ...DEFAULT_CONFIG, templateId: 'd', overridesByTemplate: { d: { order: ['hero'], sections: { tasks: { visibility: 'hidden' }, hero: { variant: 'simple' } } } } };
  for (const value of [base, { ...base, overridesByTemplate: { d: { order: [] } } }]) {
    expect(configSchema.safeParse(value).success).toBe(true); expect(json(value)).toBe(true);
  }
  for (const overrides of [
    { hidden: [] }, { variants: {} }, { order: ['hero', 'hero'] }, { order: ['unknown'] }, { order: Array(33).fill('hero') },
    { sections: { catalogue: { visibility: 'hidden' } } }, { sections: { tasks: { variant: 'simple' } } },
    { sections: { hero: { variant: 'compact' } } }, { sections: { missing: {} } }, { sections: { faq: { other: true } } },
    JSON.parse('{"sections":{"__proto__":{}}}'),
  ]) {
    const value = { ...base, overridesByTemplate: { d: overrides } };
    expect(configSchema.safeParse(value).success, JSON.stringify(overrides)).toBe(false);
    expect(json(value), JSON.stringify(overrides)).toBe(false);
  }
});

it('fills missing IDs at their anchors, including hidden defaults and chained placements', () => {
  const entry = structuredClone(STOREFRONT_TEMPLATES.d);
  Object.assign(entry.sectionDescriptors, {
    extra: { hideable: true, defaultVisibility: 'hidden', variants: [], placement: { after: 'catalogue' } },
    follow: { hideable: true, defaultVisibility: 'visible', variants: [], placement: { after: 'extra' } },
  });
  entry.defaults.sections.unshift({ id: 'extra', type: 'faq/1', content: { slot: 'home.faq' } });
  entry.defaults.sections.push({ id: 'follow', type: 'faq/1', content: { slot: 'home.faq' } });
  const layout = effectiveLayout(entry, { order: ['hero', 'catalogue', 'tasks', 'start', 'faq', 'closing'], sections: { extra: { visibility: 'visible' } } });
  expect(layout.order).toEqual(['hero', 'catalogue', 'extra', 'follow', 'tasks', 'start', 'faq', 'closing']);
  expect(layout.sections.find(section => section.id === 'extra')?.visibility).toBe('visible');
  expect(effectiveLayout(entry).sections.find(section => section.id === 'extra')?.visibility).toBe('hidden');
});

it('normalizes authored orders losslessly, including inactive templates, without mutating reads', () => {
  const config = { ...structuredClone(DEFAULT_CONFIG), overridesByTemplate: { d: { order: ['hero'] as ['hero'] } } };
  const before = structuredClone(config);
  const normalized = normalizeConfigOrders(config);
  expect(config).toEqual(before);
  expect(normalized.overridesByTemplate.d?.order).toEqual(['hero', 'tasks', 'start', 'catalogue', 'faq', 'closing']);
  expect(normalizeConfigOrders(normalized)).toEqual(normalized);
  expect(validateConfig(normalized).valid).toBe(true);
});

function permutations<T>(items: T[]): T[][] {
  return items.length ? items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index)).map(rest => [item, ...rest])) : [[]];
}
/** Exhaust layout-dependent checks; exercise selection once per visibility subset. */
function resolveLayoutCase(templateId: StorefrontConfig['templateId'], overrides: LayoutOverrides, checkSelection: boolean, validatedRecipes: Set<string>): TemplateRecipe {
  const layout = effectiveLayout(STOREFRONT_TEMPLATES[templateId], overrides);
  if (!layout.valid) expect(layout.valid, JSON.stringify({ templateId, overrides })).toBe(true);
  // Hidden sections can occupy different stored positions and produce identical recipes.
  // Key the complete output so any changed field still receives real recipe validation.
  const recipeKey = JSON.stringify(layout.recipe);
  if (!validatedRecipes.has(recipeKey)) {
    const validation = validateRecipe(layout.recipe);
    expect(validation.valid, JSON.stringify({ templateId, overrides, validation })).toBe(true);
    validatedRecipes.add(recipeKey);
  }
  if (checkSelection) {
    const selected = resolveSelection({ ...D_CONFIG, templateId, overridesByTemplate: { [templateId]: overrides } }, ['default', 'd', 'storefront-a', 'storefront-b', 'storefront-c']);
    expect(selected.diagnostic, JSON.stringify({ templateId, overrides })).toBeNull();
    expect(selected.recipe).toEqual(layout.recipe);
  }
  return layout.recipe;
}

it('release gate: every previously supported legacy order and visibility subset resolves without UNSUPPORTED', () => {
  const legacy = { d: ['hero', 'tasks', 'start', 'catalogue', 'faq', 'closing'], default: ['catalogue'], 'storefront-a': ['hero', 'tasks', 'comparison', 'start', 'catalogue', 'faq', 'closing'], 'storefront-b': ['hero', 'featured', 'catalogue', 'starter', 'faq', 'closing'], 'storefront-c': ['hero', 'story', 'paths', 'projects', 'start', 'catalogue', 'faq', 'closing'] };
  let visited = 0; let supported = 0;
  const validatedRecipes = new Set<string>();
  for (const templateId of ['d', 'default', 'storefront-a', 'storefront-b', 'storefront-c'] as const) {
    const hideable = templateId === 'storefront-c' ? ['story', 'projects', 'start', 'faq'] : templateId === 'storefront-b' ? ['featured', 'starter', 'faq'] : templateId !== 'default' ? ['tasks', 'start', 'faq'] : [];
    const visibilitySubsets = Array.from({ length: 2 ** hideable.length }, (_, mask) => Object.fromEntries(hideable.map((id, bit) => [id, { visibility: mask & (1 << bit) ? 'hidden' as const : 'visible' as const }])));
    const checkedMasks = new Set<number>();
    for (const order of permutations(legacy[templateId])) for (let mask = 0; mask < visibilitySubsets.length; mask++) {
      visited++;
      const sections = visibilitySubsets[mask];
      // The legacy contract required the D hero first; all 720 orders are enumerated.
      if (templateId !== 'default' && order.filter(id => sections[id]?.visibility !== 'hidden')[0] !== 'hero') continue;
      supported++;
      const recipe = resolveLayoutCase(templateId, { order, sections }, !checkedMasks.has(mask), validatedRecipes);
      checkedMasks.add(mask);
      expect(recipe.sections.map(section => section.id).filter(id => legacy[templateId].includes(id))).toEqual(order.filter(id => sections[id]?.visibility !== 'hidden'));
    }
    expect(checkedMasks.size).toBe(visibilitySubsets.length);
  }
  expect(visited).toBe(696961); expect(supported).toBe(120925);
  expect(validatedRecipes.size).toBe(10325);
}, 30000);

it('release gate: anchored additions preserve every supported legacy layout through the real resolver', () => {
  for (const templateId of ['d', 'default', 'storefront-a', 'storefront-b', 'storefront-c'] as const) {
    const entry = STOREFRONT_TEMPLATES[templateId];
    const original = { defaults: entry.defaults, sectionDescriptors: entry.sectionDescriptors };
    const sections = [...entry.defaults.sections];
    try {
      Object.assign(entry, {
        defaults: { ...entry.defaults, sections: [{ id: 'extra', type: 'faq/1', content: { slot: 'home.faq' } }, ...sections] },
        sectionDescriptors: { ...entry.sectionDescriptors, extra: { hideable: true, defaultVisibility: 'visible', variants: [], placement: { after: 'catalogue' } } },
      });
      const optional = templateId === 'storefront-c' ? ['story', 'projects', 'start', 'faq'] : templateId === 'storefront-b' ? ['featured', 'starter', 'faq'] : templateId !== 'default' ? ['tasks', 'start', 'faq'] : [];
      for (const order of permutations(sections.map(section => section.id))) for (let mask = 0; mask < 2 ** optional.length; mask++) {
        const hidden = optional.filter((_, bit) => mask & (1 << bit));
        const visible = order.filter(id => !hidden.includes(id));
        if (templateId !== 'default' && visible[0] !== 'hero') continue;
        const config = { ...D_CONFIG, templateId, overridesByTemplate: { [templateId]: { order, sections: Object.fromEntries(hidden.map(id => [id, { visibility: 'hidden' }])) } } };
        const resolved = resolveSelection(config, ['default', 'd', 'storefront-a', 'storefront-b', 'storefront-c']);
        expect(resolved.diagnostic, JSON.stringify({ templateId, order, hidden })).toBeNull();
        const ids = resolved.recipe.sections.map(section => section.id);
        expect(ids.filter(id => id !== 'extra')).toEqual(visible);
        expect(ids.indexOf('extra')).toBe(ids.indexOf('catalogue') + 1);
        expect(config.overridesByTemplate[templateId].order).toEqual(order);
      }
    } finally { Object.assign(entry, original); }
  }
}, 180000);

it('reports invalid placements and resolved targets without reordering seller IDs', () => {
  const entry = structuredClone(STOREFRONT_TEMPLATES.d);
  expect(effectiveLayout(entry, { order: ['catalogue', 'hero'] }).valid).toBe(false);
  Object.assign(entry.sectionDescriptors.tasks, { placement: { after: 'missing' } });
  expect(effectiveLayout(entry).valid).toBe(false);
});

it('uses strict descriptor-derived A intent in installed and frozen schemas', () => {
  const value = { ...D_CONFIG, templateId: 'storefront-a', overridesByTemplate: { 'storefront-a': { order: ['hero'], sections: { tasks: { visibility: 'hidden' }, start: { variant: 'compact' } } } } };
  const json = new Ajv2020({ strict: false }).compile(z.toJSONSchema(configSchema));
  expect(json(value)).toBe(true);
  expect(configSchema.safeParse(value).success).toBe(true);
  expect(phase2ConfigSchema.safeParse(value).success).toBe(true);
  expect(resolveSelection(value, ['storefront-a']).diagnostic).toBeNull();
  expect(normalizeConfigOrders(configSchema.parse(value)).overridesByTemplate['storefront-a']?.order).toEqual(['hero', 'tasks', 'comparison', 'start', 'catalogue', 'faq', 'closing']);
  for (const overrides of [{ hidden: [] }, { variants: {} }, { sections: { comparison: { variant: 'featured-grid' } } }, { sections: { catalogue: { visibility: 'hidden' } } }]) {
    const invalid = { ...value, overridesByTemplate: { 'storefront-a': overrides } };
    expect(json(invalid)).toBe(false);
    expect(configSchema.safeParse(invalid).success).toBe(false);
    expect(phase2ConfigSchema.safeParse(invalid).success).toBe(false);
  }
});

it('release gate: every offer order and FAQ subset retains exactly the frozen supported recipes', () => {
  const { sections, ...shell } = phase2Recipes.offer;
  let visited = 0; let supported = 0;
  for (const order of permutations(sections)) for (const faq of [true, false]) {
    visited++;
    const recipe = { ...shell, sections: order.filter(section => faq || section.id !== 'faq') };
    const accepted = offerRecipeSchema.safeParse(recipe).success;
    const expected = recipe.sections[0]?.id === 'hero' && recipe.sections.at(-1)?.id === 'closing';
    expect(accepted, JSON.stringify(recipe)).toBe(expected);
    if (accepted) supported++;
  }
  expect(visited).toBe(12); expect(supported).toBe(4);
});
